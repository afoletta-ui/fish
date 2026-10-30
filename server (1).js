// Sea Drive multiplayer server: serves the game, relays players, owns the accounts, land, leaderboard and chat.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// optional voice-chat relay for players on strict networks: set TURN_URL, TURN_USERNAME, TURN_PASSWORD on Render
const TURN = process.env.TURN_URL ? [{ urls: process.env.TURN_URL.split(',').map(u => u.trim()).filter(Boolean), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_PASSWORD || '' }] : [];
const FILE = path.join(__dirname, 'data.json');
const UR = process.env.UPSTASH_REDIS_REST_URL, UT = process.env.UPSTASH_REDIS_REST_TOKEN;
const COLORS = ['#e8445a', '#2f8ccc', '#3fae5a', '#a85aa8', '#ff8a1e', '#2ee6c8', '#ff6fae', '#9fb4c8'];
const BLOCKS = 12;                      // beachfront blocks, numbered 0-11 left to right
const MASS = [1, 1.5, 3, 6, 12];        // paddleboard, kayak, tinny, boat, yacht
const RAD = [0.9, 1.1, 1.7, 2.3, 3.6];  // collision size of each vessel (metres)
const AX = 0, AZ = -62, AR = 8;        // the boxing ring behind the leaderboard
const inRing = q => Math.abs(q.x - AX) < AR && Math.abs(q.z - AZ) < AR;

let land = {};    // pid -> { pref, n }  who owns land, remembered while they are offline
let board = [];   // top 5 fish by value: [{ n, sp, L, v }]
const owners = {}; // block -> { pid, n, c }  ONLY players who are online right now
const chat = [];   // last 20 chat lines
let accounts = {}; // NAME -> { name, salt, hash, pid, save }  (with Upstash these load one at a time)
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, (e, k) => (e ? no(e) : ok(k.toString('hex')))));
const sha8 = v => crypto.createHash('sha1').update(String(v)).digest('hex').slice(0, 8);

// ---------- saving (Upstash Redis if set up, otherwise data.json) ----------
async function kvGet(k) {
  const r = await fetch(UR + '/get/' + encodeURIComponent(k), { headers: { Authorization: 'Bearer ' + UT } });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
const kvSet = (k, v) => fetch(UR + '/set/' + encodeURIComponent(k), { method: 'POST', headers: { Authorization: 'Bearer ' + UT }, body: JSON.stringify(v) }).catch(() => {});

async function load() {
  try {
    let d;
    if (UR) d = { land: await kvGet('land'), board: await kvGet('board'), owners: await kvGet('owners') };
    else d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (d.land) land = d.land;
    else {
      // older versions saved { blockIndex: {pid,n,c} } - turn that into one block per player
      const old = d.owners || (d.board === undefined ? d : null) || {};
      for (const i of Object.keys(old)) {
        const o = old[i];
        if (o && o.pid && +i >= 0 && +i < BLOCKS && !land[o.pid]) land[o.pid] = { pref: +i, n: o.n };
      }
    }
    if (Array.isArray(d.board)) board = d.board.filter(b => b && b.v > 0).slice(0, 5);
    if (!UR && d.accounts) accounts = d.accounts;
  } catch (e) { /* first run: nothing saved yet */ }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (UR) { kvSet('land', land); kvSet('board', board); }
    else fs.writeFile(FILE, JSON.stringify({ land, board, accounts }), () => {});
  }, 300);
}
// accounts: with Upstash each account is its own key, so it survives Render going to sleep
const acctTimers = {};
function saveAcct(key) {
  if (!UR) return save();
  clearTimeout(acctTimers[key]);
  acctTimers[key] = setTimeout(() => kvSet('acct:' + key, accounts[key]), 1500);
}
async function getAcct(key) {
  if (accounts[key]) return accounts[key];
  if (!UR) return null;
  try { const a = await kvGet('acct:' + key); if (a) accounts[key] = a; return a || null; } catch (e) { return undefined; }
}
const okSave = o => o && typeof o === 'object' && !Array.isArray(o) && JSON.stringify(o).length < 300000;

// ---------- web page ----------
// the game file can be in a "public" folder or right next to server.js - either works
const GAME = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(f => fs.existsSync(f));
if (!GAME) console.error('Could not find index.html - put it in a folder called public, or next to server.js');
const page = () => fs.readFileSync(GAME, 'utf8')
  .replace('<!--MP-->', '<script>window.MP_ON=true;window.ICE_X=' + JSON.stringify(TURN).replace(/</g, '\\u003c') + '</script>');
const srv = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (!GAME) { res.writeHead(500); return res.end('index.html is missing - upload it next to server.js'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page());
});

// ---------- players ----------
const wss = new WebSocketServer({ server: srv });
const players = new Map(); // ws -> player
let nextId = 1;
const cd = new Map();      // cooldowns for rams / punches
const num = v => (Number.isFinite(v) ? v : 0);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const all = o => { for (const w of wss.clients) send(w, o); };
const others = (me, o) => { for (const w of wss.clients) if (w !== me) send(w, o); };
const byId = id => { for (const p of players.values()) if (p.id === id && p.pid) return p; return null; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const cleanName = (n, id) => String(n || '').toUpperCase().replace(/[^A-Z0-9 _.!?-]/g, '').trim().slice(0, 14) || 'PLAYER' + id;
const online = pid => [...players.values()].some(p => p.pid === pid);

// your land only shows while you're online; if someone online took your spot you get the first free one
function placeLand(p) {
  const L = land[p.pid];
  if (!L) return;
  for (const i in owners) if (owners[i].pid === p.pid) return;
  let i = L.pref >= 0 && L.pref < BLOCKS && !owners[L.pref] ? L.pref : -1;
  if (i < 0) for (let k = 0; k < BLOCKS; k++) if (!owners[k]) { i = k; break; }
  if (i < 0) return; // every block is in use by people online right now
  if (i !== L.pref) { L.pref = i; save(); send(p.ws, { t: 'moved', i }); }
  owners[i] = { pid: p.pid, n: p.n, c: p.c };
  all({ t: 'own', i, o: owners[i] });
}
function removeLand(pid) {
  for (const i of Object.keys(owners)) if (owners[i].pid === pid) { delete owners[i]; all({ t: 'own', i: +i, o: null }); }
}

wss.on('connection', ws => {
  const id = nextId++;
  const p = { id, ws, n: 'PLAYER' + id, c: COLORS[id % COLORS.length], x: 0, z: -6, h: 0, w: 1, v: -1, s: 0, st: 0, pid: null };
  players.set(ws, p);

  ws.on('message', async raw => {
    let d; try { d = JSON.parse(raw); } catch (e) { return; }

    if (d.t === 'login') {
      // username + password. A new name makes a new account; an existing name needs its password.
      const now = Date.now();
      if (p.busy) return;
      if (p.lockUntil > now) return send(ws, { t: 'loginres', ok: 0, why: 'TOO MANY TRIES - WAIT 30 SECONDS' });
      const name = String(d.n || '').toUpperCase().replace(/[^A-Z0-9 _.!?-]/g, '').trim().slice(0, 14), pw = String(d.pw || '');
      if (!name) return send(ws, { t: 'loginres', ok: 0, why: 'TYPE A USERNAME FIRST' });
      if (pw.length < 4 || pw.length > 64) return send(ws, { t: 'loginres', ok: 0, why: 'PASSWORD MUST BE AT LEAST 4 CHARACTERS' });
      p.busy = true;
      try {
        let a = await getAcct(name), isNew = false;
        if (a === undefined) return send(ws, { t: 'loginres', ok: 0, why: 'SAVE SERVER BUSY - TRY AGAIN' });
        if (a) {
          if (a.lockUntil > now) return send(ws, { t: 'loginres', ok: 0, why: 'ACCOUNT LOCKED FOR A MINUTE - TOO MANY WRONG PASSWORDS' });
          const h = await scrypt(pw, a.salt);
          if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(a.hash, 'hex'))) {
            p.fails = (p.fails || 0) + 1; if (p.fails >= 5) { p.fails = 0; p.lockUntil = now + 30000; }
            a.fails = (a.fails || 0) + 1; if (a.fails >= 10) { a.fails = 0; a.lockUntil = now + 60000; }
            return send(ws, { t: 'loginres', ok: 0, why: 'WRONG PASSWORD FOR ' + name });
          }
          if (a.fails) a.fails = 0;
        } else {
          isNew = true;
          const salt = crypto.randomBytes(16).toString('hex');
          a = accounts[name] = { name, salt, hash: await scrypt(pw, salt), pid: sha8('acct:' + name), save: okSave(d.seed) ? d.seed : null, made: now };
          // land bought before accounts existed moves to the new account
          const old = d.tok ? sha8(d.tok) : null;
          if (old && land[old] && !land[a.pid]) { land[a.pid] = land[old]; delete land[old]; save(); }
          saveAcct(name);
        }
        // only one session per account: kick the older one
        for (const [w, q] of players) if (q !== p && q.key === name) { send(w, { t: 'kicked' }); q.pid = null; q.key = null; removeLand(a.pid); w.close(); }
        p.key = name; p.n = name; p.pid = a.pid;
        send(ws, { t: 'loginres', ok: 1, save: a.save || null, isNew });
        if (land[p.pid] && land[p.pid].n !== p.n) { land[p.pid].n = p.n; save(); }
        placeLand(p);
        send(ws, { t: 'init', id, pid: p.pid, c: p.c, owners, board, chat, now: Date.now(),
          players: [...players.values()].filter(q => q !== p && q.pid).map(q => ({ id: q.id, n: q.n, c: q.c, x: q.x, z: q.z, h: q.h, w: q.w, v: q.v, st: q.st, r: q.r || 0 })) });
        others(ws, { t: 'join', id, n: p.n, c: p.c });
      } catch (e) { send(ws, { t: 'loginres', ok: 0, why: 'LOGIN ERROR - TRY AGAIN' }); }
      finally { p.busy = false; }
      return;
    }
    if (!p.pid) return;

    if (d.t === 'save') {
      // the player's progress: money, gear, fish book... kept on the server under their account
      if (!p.key || !accounts[p.key] || !okSave(d.s)) return;
      accounts[p.key].save = d.s; saveAcct(p.key);
      return;
    }

    if (d.t === 'pos') {
      p.x = num(d.x); p.z = num(d.z); p.h = num(d.h); p.w = d.w ? 1 : 0;
      const v = Math.trunc(num(d.v)); p.v = v >= -1 && v <= 4 ? v : -1;
      p.s = Math.max(0, Math.min(1, num(d.s))); p.st = Math.trunc(num(d.st)) & 255;
      p.r = Math.max(0, Math.trunc(num(d.r))); p.dk = Array.isArray(d.dk) ? [num(d.dk[0]), num(d.dk[1])] : null;

    } else if (d.t === 'buy') {
      const i = Math.trunc(num(d.i));
      const why = !(i >= 0 && i < BLOCKS) ? 'NO SUCH BLOCK' : owners[i] ? 'SOMEONE ALREADY OWNS THAT BLOCK' : land[p.pid] ? 'YOU ALREADY OWN A BLOCK' : '';
      if (why) return send(ws, { t: 'buyres', i, ok: 0, why });
      land[p.pid] = { pref: i, n: p.n };
      owners[i] = { pid: p.pid, n: p.n, c: p.c };
      save();
      send(ws, { t: 'buyres', i, ok: 1 });
      all({ t: 'own', i, o: owners[i] });

    } else if (d.t === 'ram') {
      // attacker says they hit someone; check it's believable, then work out the damage
      const q = byId(Math.trunc(num(d.id)));
      if (!q || q === p || p.w || p.v < 0 || p.r || (p.st & 8)) return;
      const swim = q.w && (q.st & 16);
      if (q.r || (q.st & 8) || (q.w && !swim) || (!q.w && q.v < 0)) return;
      const k = p.id + '>' + q.id;
      if ((cd.get(k) || 0) > Date.now()) return;
      if (dist(p, q) > RAD[p.v] + (swim ? 0.6 : RAD[q.v]) + 9) return;
      cd.set(k, Date.now() + 1400);
      const sf = Math.max(0, Math.min(1, num(d.s)));
      if (swim) return send(q.ws, { t: 'hit', d: 0.6, by: p.n, x: p.x, z: p.z, swim: 1 }); // run over a swimmer
      // bigger boats hit harder, but even a kayak does real damage
      const toThem = Math.max(0.08, Math.min(0.85, 0.2 * Math.pow(MASS[p.v] / MASS[q.v], 0.7) * (0.4 + 0.6 * sf)));
      const toMe = Math.max(0.03, Math.min(0.5, 0.1 * Math.pow(MASS[q.v] / MASS[p.v], 0.7)));
      send(q.ws, { t: 'hit', d: toThem, by: p.n, x: p.x, z: p.z });
      send(p.ws, { t: 'hit', d: toMe, by: q.n, x: q.x, z: q.z, self: 1 });

    } else if (d.t === 'punch') {
      const q = byId(Math.trunc(num(d.id)));
      if (!q || q === p || !p.w || !q.w) return;
      const k = 'punch' + p.id;
      if ((cd.get(k) || 0) > Date.now() || dist(p, q) > 4) return;
      cd.set(k, Date.now() + 500);
      send(q.ws, { t: 'punched', by: p.n, x: p.x, z: p.z });
      const du = p.duel;
      if (du && du === q.duel && inRing(p) && inRing(q)) {
        // boxing match: every punch in the ring takes 12% health
        du.hp[q.id] = Math.max(0, du.hp[q.id] - 0.12);
        const m = { t: 'duelhp', hp: du.hp }; send(p.ws, m); send(q.ws, m);
        if (du.hp[q.id] <= 0) {
          p.duel = q.duel = null;
          send(p.ws, { t: 'duelend', win: 1, stake: du.stake, n: q.n });
          send(q.ws, { t: 'duelend', win: 0, stake: du.stake, n: p.n });
        }
      }

    } else if (d.t === 'fuel') {
      const q = byId(Math.trunc(num(d.id)));
      if (!q || q === p || dist(p, q) > 16) return;
      send(q.ws, { t: 'gotfuel', by: p.n });

    } else if (d.t === 'chat') {
      const now = Date.now();
      if (now - (p.lastChat || 0) < 600) return;
      p.lastChat = now;
      const m = String(d.m || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      if (!m) return;
      const line = { t: 'chat', id: p.id, n: p.n, c: p.c, m };
      chat.push(line); if (chat.length > 20) chat.shift();
      all(line);

    } else if (d.t === 'catch') {
      // leaderboard is ranked by how much the fish is worth
      const v = num(d.v), L = num(d.L);
      if (!(v > 0 && v < 1e13 && L > 0 && L < 10000)) return;
      if (board.length >= 5 && v <= board[4].v) return;
      board.push({ n: p.n, sp: String(d.sp || 'FISH').toUpperCase().slice(0, 22), L: Math.round(L), v: Math.round(v) });
      board.sort((a, b) => b.v - a.v);
      board = board.slice(0, 5);
      save();
      all({ t: 'board', b: board });

    } else if (d.t === 'bust') {
      // a tuna bust popped up - everyone gets to see it
      const now = Date.now(); if (now - (p.lastBust || 0) < 4000) return; p.lastBust = now;
      others(ws, { t: 'bust', x: num(d.x), z: num(d.z), vx: Math.max(-1, Math.min(1, num(d.vx))), vz: Math.max(-1, Math.min(1, num(d.vz))) });

    } else if (d.t === 'took') {
      // someone hooked a fish, so it disappears for everyone
      others(ws, { t: 'took', k: String(d.k || '').slice(0, 24) });

    } else if (d.t === 'netreq') {
      const q = byId(Math.trunc(num(d.id)));
      if (q && q.r === p.id) send(q.ws, { t: 'netreq', from: p.id, n: p.n, sp: String(d.sp || 'FISH').slice(0, 22), ft: Math.trunc(num(d.ft)) });

    } else if (d.t === 'netres') {
      const q = byId(Math.trunc(num(d.id)));
      if (q) send(q.ws, { t: 'netres', ok: d.ok ? 1 : 0, n: p.n });

    } else if (d.t === 'rtc') {
      // voice chat: pass the connection details between two players (the audio itself goes player to player)
      const q = byId(Math.trunc(num(d.id)));
      if (!q || q === p) return;
      const m = { t: 'rtc', from: p.id };
      if (d.sdp && typeof d.sdp === 'object' && JSON.stringify(d.sdp).length < 20000) m.sdp = { type: String(d.sdp.type), sdp: String(d.sdp.sdp) };
      else if (d.ice && typeof d.ice === 'object' && JSON.stringify(d.ice).length < 2000) m.ice = d.ice;
      else return;
      send(q.ws, m);

    } else if (d.t === 'eskyreq' || d.t === 'steal') {
      // a passenger looks in (or nicks a fish from) the driver's esky
      const q = byId(Math.trunc(num(d.id)));
      if (!q || p.r !== q.id) return;
      if (d.t === 'eskyreq') send(q.ws, { t: 'eskyreq', from: p.id, n: p.n });
      else send(q.ws, { t: 'steal', from: p.id, n: p.n, i: Math.trunc(num(d.i)), L: num(d.L), si: Math.trunc(num(d.si)) });

    } else if (d.t === 'eskyres' || d.t === 'stolen') {
      // the driver's game answers the passenger
      const q = byId(Math.trunc(num(d.id)));
      if (!q || q.r !== p.id) return;
      if (d.t === 'eskyres') send(q.ws, { t: 'eskyres', from: p.id, n: p.n, list: (Array.isArray(d.list) ? d.list : []).slice(0, 50).map(f => ({ L: num(f && f.L), si: Math.trunc(num(f && f.si)), m: num(f && f.m) || 1 })) });
      else send(q.ws, { t: 'stolen', ok: d.ok ? 1 : 0, L: num(d.L), si: Math.trunc(num(d.si)), m: num(d.m) || 1, n: p.n });

    } else if (d.t === 'duel') {
      // boxing challenge with money on the line
      const q = byId(Math.trunc(num(d.id))), stake = Math.max(0, Math.min(1e13, Math.round(num(d.stake))));
      if (!q || q === p || p.duel || q.duel) return send(ws, { t: 'duelno', why: 'THEY ARE BUSY' });
      if (!inRing(p) || !inRing(q)) return send(ws, { t: 'duelno', why: 'YOU BOTH NEED TO BE IN THE RING' });
      p.pend = { to: q.id, stake, at: Date.now() };
      send(q.ws, { t: 'duelreq', from: p.id, n: p.n, stake });

    } else if (d.t === 'duelans') {
      const q = byId(Math.trunc(num(d.id)));
      if (!q || !q.pend || q.pend.to !== p.id || Date.now() - q.pend.at > 30000) return;
      const stake = q.pend.stake; q.pend = null;
      if (!d.ok) return send(q.ws, { t: 'duelno', why: p.n + ' SAID NO' });
      if (q.duel || p.duel) return;
      const du = { stake, hp: { [q.id]: 1, [p.id]: 1 } }; q.duel = p.duel = du;
      send(q.ws, { t: 'duelgo', vs: p.id, n: p.n, stake });
      send(p.ws, { t: 'duelgo', vs: q.id, n: q.n, stake });

    } else if (d.t === 'die') {
      // boat exploded: they only lose that boat (the game handles it), everyone sees the explosion
      others(ws, { t: 'boom', x: p.x, z: p.z });
    }
  });

  ws.on('close', () => {
    players.delete(ws);
    others(ws, { t: 'leave', id });
    if (p.pid && !online(p.pid)) removeLand(p.pid); // land disappears when you log off
    if (p.duel) { for (const q of players.values()) if (q.duel === p.duel) { q.duel = null; send(q.ws, { t: 'duelend', win: -1, n: p.n }); } }
  });
});

const r2 = v => Math.round(v * 100) / 100;
setInterval(() => {
  if (players.size < 2) return;
  const snap = [...players.values()].filter(p => p.pid).map(p => [p.id, r2(p.x), r2(p.z), r2(p.h), p.w, p.v, p.st, p.r || 0, p.dk ? r2(p.dk[0]) : 0, p.dk ? r2(p.dk[1]) : 0, p.dk ? 1 : 0]);
  for (const w of wss.clients) send(w, { t: 'snap', p: snap });
}, 100);
setInterval(() => { for (const w of wss.clients) if (w.readyState === 1) w.ping(); }, 30000); // keep free hosts from dropping idle sockets
// the server's clock is the game clock: time of day and tides are worked out from it, so everyone matches
setInterval(() => all({ t: 'clock', now: Date.now() }), 30000);
setInterval(() => { const now = Date.now(); for (const [k, v] of cd) if (v < now) cd.delete(k); }, 60000);

load().then(() => srv.listen(PORT, () => console.log('Sea Drive running on port ' + PORT)));

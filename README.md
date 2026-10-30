# Sea Drive multiplayer (free setup)

What's in here
- public/index.html : the game (same as the one in Claude, plus the online bits)
- server.js         : tiny Node server. Serves the game, shows other players, owns the land blocks
- package.json      : one dependency (ws)

The Claude page can't connect to your server, so people play from YOUR server's web address instead.

## 1. Try it on your own computer (2 minutes)
1. Install Node.js (nodejs.org, the LTS version).
2. Open a terminal in this folder and run:
       npm install
       npm start
3. Open http://localhost:3000 in two browser tabs. You'll see each other.
   Friends on the same wifi can use http://YOUR-COMPUTER-IP:3000

## 2. Put it online for free (Render.com)
1. Make a free GitHub account, create a new repository, and upload everything in this folder
   (github.com > New repository > "uploading an existing file"). Don't upload node_modules.
2. Make a free account at render.com and click New > Web Service > connect that repository.
3. Use these settings:
       Runtime: Node
       Build command: npm install
       Start command: npm start
       Instance type: Free
4. Click Deploy. In a minute or two you get an address like https://sea-drive.onrender.com
   Send that link to your friends. That's it.

Free tier notes
- It goes to sleep after about 15 minutes with nobody on it. The next visitor waits ~1 minute for it to wake.
- Render's free disk is wiped when it sleeps or redeploys, so land blocks would be forgotten.
  Fix (also free): keep the land in Upstash Redis.
  1. Make a free database at upstash.com (Redis).
  2. Copy its REST URL and REST token.
  3. In Render > your service > Environment, add:
         UPSTASH_REDIS_REST_URL   = (the REST URL)
         UPSTASH_REDIS_REST_TOKEN = (the REST token)
  4. Redeploy. Land ownership now survives sleeping.

## How it works (so you know what to expect)
ACCOUNTS
- Everyone logs in with a username and password. A new name makes a new account. Logging in again with the
  same name and password (on any device) brings back all progress: money, zones, vessel, rods, line, sounder,
  bait, esky, fish book, level, trophies and daily-reward streak.
- Passwords are never stored, only a scrambled hash (scrypt). 5 wrong tries = 30 s wait; 10 on one account
  locks it for a minute. Logging in somewhere else kicks the older session.
- With Upstash set up, each account is saved as its own key ("acct:NAME"), so nothing is lost when Render sleeps.
  WITHOUT Upstash, Render's free disk is wiped when it sleeps - so set up Upstash or accounts will reset.
- Progress is still worked out in each player's browser and sent to the server, so a very tech-savvy player
  could edit their own save. Fine for friends.

ZONES AND FISH (each zone's fish is worth about 6x the last)
   1  THE SHALLOWS        0 - 500 m      FLATHEAD
   2  SNAPPER REEF      500 - 1000 m     SNAPPER              unlock $25,000
   3  KINGFISH PINNACLE 1000 - 2000 m    KINGFISH             unlock $150,000
   4  QUEENFISH FLATS   2000 - 3000 m    QUEENFISH            unlock $900,000
   5  COBIA CANYON      3000 - 4000 m    COBIA                unlock $5.4 million
   6  MACKEREL ALLEY    4000 - 5000 m    SPANISH MACKEREL     unlock $32 million
   7  SHARK TRENCH      5000 - 6000 m    TIGER SHARK          unlock $190 million
   8  THE LOST REEF     6000 - 7000 m    EXTINCT CORAL TROUT  unlock $1.2 billion
   9  PREHISTORIC DEEP  7000 - 8000 m    DINOSAUR FISH        unlock $7 billion
  10  THE ABYSS         8000 - 9000 m    GIANT SQUID          unlock $42 billion
  11  KRAKEN'S MAW      9000 - 10000 m   THE KRAKEN           unlock $250 billion
  Tuna busts still pop up anywhere.

FISHING IS HARDER
- Fish swim around their spot. Casting at an empty patch of water almost never works - land the lure right
  on a fish. Without a sounder, watch for surface swirls in the top view.
- There is one rod per zone (11 rods, up to the KRAKEN SLAYER). A fish from a zone above your rod is almost
  impossible to land. The right rod still makes you fight hard: the Kraken needs about 8 taps a second for
  close to a minute, even with the best rod and line. The FISH bar on the right shows how tired it is.
- Line strength matters too (8 lines, up to 130 kg Kraken Cable): weak line snaps on big fish.
- The sounder only updates every 1.2-1.8 s, so marks are where the fish WAS - lead your cast. Each sounder
  only sees fish up to a certain zone; Giant Squid and the Kraken never show clearly, at best a flickering "?".

EXTRAS
- Levels and XP (bar along the bottom), with cash rewards on level-up.
- 25 trophies, a fish book with every species (silhouettes until you catch one), rarity on every catch
  (COMMON to MYTHIC), zone title cards, darker and stranger water the further out you go, rain and
  thunderstorms (same weather for everyone), boss fights for the Giant Squid and Kraken.
- Prices went up a lot: vessels, bait, jerry cans, fuel and land are 10x more (land is $2.5 million),
  but fish are worth far more too.

NEW IN THIS VERSION
- Same fish for everyone: fish positions run off the server clock, tuna busts are shared, and a fish someone
  hooks disappears for everyone.
- Cast, then you're straight into reeling in and waiting for the bite (like the original). Reaction times are
  600 ms for small fish, down to 300 ms for monsters; the Kraken is 290 ms.
- Tuna roam the deep as well as busts, but only bite METAL lures, and metal lures catch nothing else.
- The Kraken cruises at about 12 kn and shows on the MK4 sounder for about 3 seconds every so often.
- Drag button during a fight: LOCKED reels faster but piles on line tension and can tow a paddleboard or kayak.
- Netting: when the fish reaches you, tap while it's in the green. A mate on your boat gets a bigger net window.
- Better rod: guides, cork grip, reel, bending blank and your hands cranking it.
- Trolling: TROLL button on any boat. The lure drags 28 m behind while someone drives; hook up and reel.
- Passengers: walk up to a tinny, boat or yacht and tap BOARD. Seats: tinny 1, boat 3, yacht 6.
  EXPLORE BOAT lets you walk the deck (the driver only when stopped; passengers any time).
- Health bar. Sleep in the bed in your house to heal (time keeps running).
- Strong current days push you around - buy an ANCHOR ($25,000) and drop it.
- Big wave days can sink your boat (small boats most). Swim in at 7 kn and salvage the boat in the gear shop
  (25% of its price). Sharks attack swimmers past 20 m: tap within 400 ms or you wake up in your house.
- Rock wall 70 m out to sea, left of the start. Walk out on it and fish; it's always surrounded by fish.
- Boxing arena behind the leaderboard. Stand in the ring, tap CHALLENGE and pick the bet. Each punch takes 12%;
  the loser pays the bet and wakes up in their bed (or on the beach).
- Any vessel can ram any other, and you can run over swimmers.
- The rusty bolt button (top right) switches between every rod and vessel you own.
- Leaderboard ranks fish by value. Chat bubbles fade after 10 seconds.

LATEST CHANGES
- No more teleporting to the market. A big FISH MARKET sign stands on the beach; follow the footpath behind
  the houses to the market building and walk through the door to sell fish and use the gear shop.
- Jetty shop: a small jetty with a repair hut on the beach, right of the start. Pull your boat up to it (or walk
  to the hut) for repairs (60% of the boat's price for a full repair), boat insurance (30% of the price, one
  claim) and fuel. Boats no longer repair themselves for free.
- If someone destroys your boat you go back to the start and lose ONLY that boat (insurance saves it).
  Money, land, gear, fish and everything else stay. Buy the boat again in the gear shop.
- Esky upgrades in the gear shop: 3 fish to start, then 5 ($10,000), 10 ($75,000), 25 ($500,000), 50 ($5 million).
  Players from before keep their 5-fish esky.
- Daily rewards removed. Tap outside the rusty bolt menu (or press Escape) to close it.
- Sharper picture: on most computer screens each game pixel is now exactly 3 (or 6) screen pixels.

ESKY ON THE BOAT
- Tinny, boat and yacht have an esky on the deck. Tap EXPLORE BOAT, walk up to it and tap OPEN ESKY.
- Passengers can open the driver's esky and STEAL fish, then jump off and sell them at the market.
  The driver gets a "THIEF!" alert. Keep an eye on who you pick up!
- Picking people up: stop close to someone on the beach, jetty, rock wall or in the water - they tap BOARD.

VOICE CHAT
- Proximity voice: people sound louder the closer they are and fade out by 60 m. Everyone on the same boat
  hears each other clearly. A green speaker icon shows over people who are talking.
- Mic button (top right): tap to switch between HOLD V (push to talk - hold V or hold the button),
  OPEN MIC and OFF. Your browser asks for microphone permission the first time.
- Audio goes straight between players (WebRTC); the server only introduces them, so it costs nothing extra.
  Works best with up to about 8 people talking. On some school/work wifi the connection can be blocked.
- If a friend on strict wifi or phone data still can't hear/be heard, add a free TURN relay (for example from
  metered.ca or Cloudflare Calls). In Render > Environment add:
      TURN_URL       = turn:your-relay-address:3478   (several can be comma separated)
      TURN_USERNAME  = (from the relay provider)
      TURN_PASSWORD  = (from the relay provider)
  then redeploy. Voice only uses the relay when a direct connection fails.

FISH SHOWING THEMSELVES
- Each zone's fish jump out of the water around you, sharks cruise past with their fins out, and giant
  squid and Kraken tentacles rise out of the water. The zone title card says what that zone's fish are worth.
- Boats show red and green navigation lights and a white mast light at night.

STILL THE SAME
- One beachfront block per player (shows while you're online), ramming, endurance, fuel and jerry cans,
  punching (F), chat (T), day/night, tides, baits, size limits, sound (speaker button).
- Death still loses everything except your fish book, level and trophies.

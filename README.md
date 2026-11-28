# Chipfall: Veyra Rift

A three-faction isometric MMORPG for Android and the browser. Every faction, character, item, place and piece of artwork is original.

Three banners fight over the mining world of Veyra:

- **Aurex Concord** (amber), based at Halcyon Spire.
- **Vessari Covenant** (violet), based at Choir Hollow.
- **Kreth Ironhold** (cyan), based at Anvil Deep.

Each faction fields three roles: Assault, Guardian and Engineer.

**What you do**

- **Explore the world.** Walk one shared isometric map with other players and labelled NPC pilots. Tap monsters to fight them and loot what they drop, and mine ore crystals by hand. Party up with up to four pilots of your own faction, and chat on the World, Faction and Party channels.
- **Earn while away.** Your pilot keeps hunting, mining or training while you're offline, capped at 8 hours.
- **Run daily dungeons.** Four solo dungeons reset at 6:00 AM Asia/Manila.
- **Trade.** Use the cross-faction marketplace or trade directly with another pilot.
- **Fight Chip Wars on the map.** Your faction defends its own Command Chip and attacks the enemy chips. Rankings are kept for current-war, weekly and all-time.

---

## Architecture

```
 Browser / Android (Capacitor) ──WebSocket /ws──►  Cloudflare Worker ──► Durable Object "veyra" (GameDO)
                                                   (serves client/dist)     • whole game in one place
                                                                            • built-in SQLite storage
                                                                            • 10 Hz world loop while players are online
                                                                            • alarms for scheduled wars when nobody is
```

- **`server/src/game.ts`** is the authoritative game core. It doesn't depend on any particular transport or database. It answers RPCs, pushes events and runs the war and dungeon loops.
  - Storage is pluggable. `db-do.ts` uses Durable Object SQLite on Cloudflare. `db-node.ts` uses `node:sqlite` locally. Every reward, trade and claim is a single SQLite transaction.
  - `server/src/world/world.ts` is the open world: movement with A* pathfinding, monster AI, combat, loot, parties, chat, mining, and war fighters placed on the map. It sends 5 snapshots per second to each player, covering what's within 22 tiles.
  - Idle rewards, dungeons, the market and trades, the Chip War engine and rankings work the same as before.
- **Hosts:**
  - `server/src/worker.ts` runs on Cloudflare Workers.
  - `server/src/node.ts` is a local Node server (WebSocket via `ws`), used for LAN and phone testing and for the automated tests.
- **`shared/`** holds the content, the map generator (deterministic, so clients build the same map with no download) and the protocol.
- **`client/`** is React, TypeScript and Vite. The world is drawn on a canvas (`client/src/world/render.ts`) with a heads-up display (HUD) layered on top. Capacitor wraps it as an Android app.

**Wire protocol:** one JSON message per WebSocket frame.

- Client to server: `{t:'auth',token}`, `{t:'rpc',id,m,p}`, `{t:'ping'}`.
- Server to client: `{t:'hello'}`, `{t:'res',id,ok,data|error}`, `{t:'ev',e,d}`.

---

## Requirements

- **Node.js 22.13 or newer.**
- **For Cloudflare:** a Cloudflare account. The free Workers plan is enough.
- **For the APK:** Android Studio (it bundles JDK 21) and an Android SDK (API 35), plus `adb`.

## 1. Play locally in two browser sessions

```bash
npm install
npm run db:reset      # local SQLite database with seed data
npm run build:web
npm run server        # http://localhost:3000
```

Open http://localhost:3000 in two independent sessions, for example a normal window and a private window, and sign in with two different accounts:

| Username | Password | Pilot | Faction and role |
|---|---|---|---|
| `aurex_pilot` | `chipfall` | Solenne | Aurex Concord, Assault, level 6 |
| `kreth_pilot` | `chipfall` | Tarrok | Kreth Ironhold, Guardian, level 6 |
| `vessari_pilot` | `chipfall` | Ilsevel | Vessari Covenant, Engineer, level 6 |

All three are developer accounts, so they can launch test wars and use the test clock. **New pilot** creates an ordinary level-1 account. To have two players see each other walking around, use two pilots of the **same faction**. They start at the same base.

**Hot reload:** run `npm run server` in one terminal and `npm run dev:web` in another, then open http://localhost:5173.

## 2. Run it on Cloudflare (always on, free tier)

**Test the Cloudflare build locally:**

```bash
npm run dev:cf        # wrangler dev → http://localhost:8787 (real Workers runtime, local Durable Object)
```

**Put it online with Git, like the existing MMORPG ONLINE project:**

1. In the Cloudflare dashboard, open **Workers & Pages → Create → Import a repository** and pick **dutcom16-ux/mmorpg**.
2. Name the project **chipfall**. This must match `"name"` in `wrangler.jsonc`.
3. Set the production branch to **`chipfall`**. That branch holds this game; `main` keeps your other game.
4. Keep the deploy command `npx wrangler deploy`. Wrangler builds the web client itself, through `build.command` in `wrangler.jsonc`.
5. Deploy. You get `https://chipfall.<your-subdomain>.workers.dev`. Every push to the `chipfall` branch redeploys.

**Or deploy from your computer:** run `npx wrangler login`, then `npm run deploy`.

Settings live in `wrangler.jsonc` under `vars`:

- `DEV_TOOLS`
- `SCHEDULED_WARS`
- `WAR_INTERVAL_MIN`
- `WAR_DURATION_MIN`
- `TEST_WAR_SEC`
- `WAR_TARGET_PER_FACTION`

**Set `DEV_TOOLS` to `"0"` before inviting the public.** The test account passwords are in this README.

**What fits the free plan:**

- The whole world runs in one Durable Object.
- Snapshots go from server to client, and those messages are free.
- Players only send a message when they tap.
- With nobody online, the server sleeps and wakes about once an hour for scheduled wars.

## 3. Android APK

```bash
npm run android:add   # first time only
npm run apk:debug     # → dist-apk/chipfall-debug.apk
adb install -r dist-apk/chipfall-debug.apk
```

Open the app and tap **Change server** on the sign-in screen. Enter one of these addresses:

- **Cloudflare:** `https://chipfall.<your-subdomain>.workers.dev`
- **Android emulator with the local server:** `http://10.0.2.2:3000`
- **Phone on the same Wi-Fi:** `http://<your PC's Wi-Fi IP>:3000`. The server prints this address when it starts. You may need to allow port 3000 through your firewall. On Windows, run this in an admin PowerShell:
  `New-NetFirewallRule -DisplayName "Chipfall 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`

To build an APK with a default address already set, use `VITE_SERVER_URL=https://… npm run apk:debug`. In PowerShell: `$env:VITE_SERVER_URL="https://…"; npm run apk:debug`.

## 4. Test war and dungeon reset

- **Test war:** in both sessions, go to **War → Queue for the next war**. Then open the World tab, tap your pilot frame in the top left, and tap **Launch 2-minute test war**. Anyone who didn't queue can tap **Join war** on the war banner.
  - Tap an enemy base to march on it.
  - Tap your own base to defend it.
  - Tap an ally to follow them.
  - Tap an enemy to focus your attacks on them.
- **Dungeon reset:** tap the pilot frame to open the developer tools, then tap **Jump to 5:59 AM Manila**. Start a dungeon, then tap **+1 hour**. The run counts toward the previous day, and all four dungeons reopen for the new day. Tap **Real time** when you're done.

---

## How to play

| Action | How |
|---|---|
| Walk | Tap the ground. Pilots path around rocks and rift chasms. |
| Fight | Tap a monster. You walk into range and attack automatically. Your role ability is the round button in the bottom right. |
| Mine | Tap a glowing ore crystal. Mining takes 3 seconds; the crystal regrows in 45 seconds. |
| Dungeons | Use the big **Dungeons** button, or walk into the portal at your base. |
| Market | Use the Market tab, or the terminal at your base. |
| Party / trade | Tap another pilot. |
| Chat | Tap the chat box in the bottom left. |
| Pilot details | Tap the pilot frame in the top left. It also shows idle rewards, developer tools and the war schedule. |

- **Monsters by zone.** Monsters get stronger toward the plaza in the centre:
  - Rift Skitters (level 1–3) near the bases.
  - Glass Stalkers (level 3–6) further out.
  - Ironback Crawlers (level 6–9) in the outer reaches.
  - Prism Wraiths (level 9–12) around the central plaza.
  - The elite **Rift Colossus** (level 14) guards the plaza itself and respawns every 3 minutes.
- **Base safety.** Monsters never enter a base's safe ring.
- **Abilities in the world:**
  - Overcharge Strike: the next hit deals 3× damage.
  - Bulwark: allies nearby take −50% damage for 5 s, and monsters nearby switch their attacks to you.
  - Nanite Surge: heals allies nearby for 30%.
  - Engineers also heal the most hurt ally each time they attack.
- **Parties.** Members within 20 tiles split EXP and Gold, with +15% for each extra member. Item drops rotate between members.
- **Knocked out.** Your pilot reactivates at your base after 6 seconds. You lose nothing.
- **Chip Wars on the map.** Fighters walk the roads between bases and battle at the base they are attacking. The war rules are unchanged: first chip destroyed wins, same-tick ties go to chip damage, and if time runs out the most objective damage wins. The War tab still has orders, rankings and recaps.

The dungeon, marketplace, idle, war and ranking rules are documented in [docs/RULES.md](docs/RULES.md).

## Automated tests

```bash
npm test               # acceptance + world + war-engine tests (Node host, real WebSockets)
npm run test:world     # open world only
TEST_URL=http://127.0.0.1:8787 node --import tsx --test server/test/acceptance.test.ts   # against `npm run dev:cf`
npm run typecheck
```

When `TEST_URL` is set, the tests run against an external server instead of starting their own. The crash/restart test is skipped in that mode, because it needs a local process to kill. Before each test file, use a fresh `wrangler dev --persist-to <new dir>`, since the tests expect freshly seeded accounts.

## Project layout

```
server/src/   game.ts (core), world/world.ts, worker.ts (Cloudflare), node.ts (local), db*.ts, characters.ts, idle.ts,
              dungeons.ts, market.ts, trades.ts, rankings.ts, war/engine.ts, war/manager.ts, seed.ts, worldBots.ts
server/test/  acceptance.test.ts, world.test.ts, engine.test.ts, harness.ts
shared/       content.ts, map.ts, dungeonSim.ts, protocol.ts, time.ts, rng.ts
client/src/   App.tsx, net.ts, world/render.ts, screens/ (World, Dungeons, Inventory, Market, War, Login, Home = pilot sheet)
wrangler.jsonc, capacitor.config.json, scripts/
```

## Troubleshooting

- **`No such built-in module: node:sqlite`:** use Node 22.13 or newer. This only affects the local server.
- **The app can't connect:**
  - Check the server address and the firewall.
  - A Cloudflare deploy URL must be `https://`.
  - On Android, cleartext HTTP is only enabled so you can reach a local dev server.
- **Reset local data:** `npm run db:reset`.
- **Reset the Cloudflare data:** change the Durable Object name `'veyra'` in `server/src/worker.ts` to a new name, then redeploy. The old data is left behind, unused.

# Chipfall: Veyra Rift

An idle MMORPG for Android and the browser, inspired by three-faction rivalry and chip wars. All factions, characters, items, places and artwork are original.

Three banners fight over the mining world of Veyra:

- **Aurex Concord** (amber): hardlight engineers. Base: Halcyon Spire.
- **Vessari Covenant** (violet): a psionic crystal choir. Base: Choir Hollow.
- **Kreth Ironhold** (cyan): cybernetic miner clans. Base: Anvil Deep.

Each faction can play three roles:

| Role | Ability |
|------|---------|
| Assault | Overcharge Strike: the next hit deals 3× damage. |
| Guardian | Bulwark: allies and your home chip take −50% damage. |
| Engineer | Nanite Surge: heals the squad 30%. |

The core loop is a short cycle:

1. Send your pilot hunting or mining while you're away.
2. Come back, claim the rewards and sell ore to another player.
3. Run a daily dungeon for a weapon and equip it.
4. Join your faction's Chip War.

---

## Architecture

```
 Android app (Capacitor WebView) ─┐                      ┌─ SQLite (data/chipfall.db)
                                  ├─ Socket.IO (ws) ──► Node.js game server ─┤
 Browser (same React build) ──────┘                      └─ server clock + test-clock offset
```

- **`server/`**: the authoritative Node.js + TypeScript server. It runs Socket.IO and SQLite through Node's built-in `node:sqlite`, so there's no native module to compile. Every timer, combat tick, trade, reward and ranking is computed here. Clients only send intents.
  - `idle.ts` computes offline rewards from server timestamps, capped at 8 h per absence. Claims are idempotent through a claim id.
  - `dungeons.ts` replays a deterministic simulation from (seed, stats, ability ticks), so a run survives lock screens, device switches and restarts. The victory, the reward and the daily clear are written in one transaction, keyed by (pilot, dungeon, day).
  - `market.ts` and `trades.ts` handle escrowed listings, single-transaction settlement and versioned direct trades.
  - `war/engine.ts` is the Chip War simulation. Its state is JSON, with the RNG inside, and is snapshotted every tick. `war/manager.ts` handles scheduling, resolution and rewards (exactly once).
  - `rankings.ts` builds the current-war, weekly and all-time boards. Only human pilots are stored there.
- **`shared/`** holds the content and formulas used by both sides: factions, roles, items, dungeons, MVP formula and the Asia/Manila reset math.
- **`client/`** is the React + TypeScript + Vite UI. It's portrait-first, with bottom navigation (Home, Inventory, Market, War) and original SVG art.
- **Capacitor** wraps `client/dist` into an Android app. The server address is set on the login screen.

---

## Requirements

- **Node.js 22.13 or newer** (Node 22 LTS or Node 24). `node:sqlite` needs 22.13+.
- For the APK: **Android Studio** (it bundles JDK 21) with an Android SDK (API 35) installed, plus `adb` on your PATH (Android Studio → SDK Manager → SDK Tools → Platform-Tools).

## 1. Start the server and play in two browser sessions

```bash
npm install
npm run db:reset        # creates data/chipfall.db with seed data and test accounts
npm run build:web       # builds the client into client/dist (the server serves it)
npm run server          # http://localhost:3000
```

Open **http://localhost:3000** in two independent sessions, for example a normal window plus a private/incognito window, or two browser profiles. Sign in with different test accounts:

| Username | Password | Pilot | Faction / role |
|---|---|---|---|
| `aurex_pilot` | `chipfall` | Solenne | Aurex Concord, Assault, level 6 |
| `kreth_pilot` | `chipfall` | Tarrok | Kreth Ironhold, Guardian, level 6 |
| `vessari_pilot` | `chipfall` | Ilsevel | Vessari Covenant, Engineer, level 6 |

All three are developer accounts, so they can see the test-war and test-clock controls. New accounts made with **New pilot** start at level 1 and are not developers.

**Hot reload while developing:** run `npm run server` in one terminal and `npm run dev:web` in another, then open http://localhost:5173. The Vite page connects to the game server on port 3000.

Server options, given as arguments after `--` or as environment variables:

```bash
npm run server -- --port=3000 --db=data/chipfall.db
# PowerShell:  $env:WAR_INTERVAL_MIN=30; npm run server
# bash:        WAR_INTERVAL_MIN=30 npm run server
```

| Variable | Default | Meaning |
|---|---|---|
| `WAR_INTERVAL_MIN` | 60 | Minutes between scheduled wars (aligned to the clock). |
| `WAR_DURATION_MIN` | 15 | Scheduled war length. |
| `TEST_WAR_SEC` | 120 | Length of the developer test war. |
| `WAR_TARGET_PER_FACTION` | 6 | Combatants per faction, after NPC backfill. |
| `SCHEDULED_WARS` | 1 | Set to `0` to turn off scheduled wars. |
| `DEV_TOOLS` | 1 | Set to `0` to hide the test war and test clock on a public server. |

## 2. Build a debug APK (client packaged inside)

```bash
npm run android:add     # first time only: builds the web client, creates android/, enables HTTP to your dev server
npm run apk:debug       # rebuilds the client, syncs it into android/, runs Gradle
```

The APK is written to **`dist-apk/chipfall-debug.apk`**. Gradle's own copy is at `android/app/build/outputs/apk/debug/app-debug.apk`.

If you'd rather use Android Studio: run `npm run android:sync`, then `npm run android:open`, then *Build → Build App Bundle(s)/APK(s) → Build APK(s)*.

The web assets are bundled inside the APK, so only the game server needs to be reachable.

## 3. Install the APK and point it at your server

```bash
adb devices                                   # your emulator or phone should be listed
adb install -r dist-apk/chipfall-debug.apk
```

Open **Chipfall** and tap **Change server** on the sign-in screen:

- **Android emulator:** use `http://10.0.2.2:3000`. This is the default inside the app, and `10.0.2.2` is the emulator's alias for your computer.
- **Physical phone on the same Wi-Fi:** use `http://<your computer's Wi-Fi IP>:3000`, for example `http://192.168.1.23:3000`. The server prints this address at startup ("Phone on same Wi-Fi: …"). You can also find it with `ipconfig` on Windows or `ip addr` / `ifconfig` on macOS/Linux.
  - Allow port 3000 through your computer's firewall. On Windows, in an admin PowerShell:
    `New-NetFirewallRule -DisplayName "Chipfall 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`
  - Check from the phone's browser that `http://<IP>:3000/health` returns `{"ok":true,…}`.

The address is saved on the device. To bake a default into the build instead, set `VITE_SERVER_URL` when building:

```bash
# bash
VITE_SERVER_URL=http://192.168.1.23:3000 npm run apk:debug
# PowerShell
$env:VITE_SERVER_URL="http://192.168.1.23:3000"; npm run apk:debug
```

Android and browser players share everything (characters, marketplace, dungeon progress, wars, rankings) because they all talk to the same server and database. You can sign in to the same account on the phone and in a browser at the same time.

## 4. Start a short test war and simulate the dungeon reset

**Test war (developer accounts):**

1. Both players open **War** and tap **Queue for the next war**. Queued players are counted before NPC backfill.
2. One of them launches the war: **Home → Developer tools → Launch 2-minute test war**, or **War → Launch 2-minute test war (developer)**.
3. Players who didn't queue can still join mid-war from the War tab. This is the late-entrant case: one NPC on that faction stands down at its next safe moment.
4. To finish early: **Home → Developer tools → End current war**. The war resolves on the next tick using the time-expiry rules.

**Dungeon reset with the test clock:** the server keeps an offset on top of real time and saves it in the database. Every timer uses it: idle rewards, dungeon days, war schedule.

1. **Home → Developer tools → Jump to 5:59 AM Manila.** The server clock moves to 05:59 Asia/Manila on the morning of the next reset.
2. Open **Dungeons** and start one. It is assigned to the day it started.
3. Tap **+1 hour**. The run finishes after 06:00. Its reward counts as the previous day's clear, and all four dungeons show as available for the new day.
4. Tap **Real time** to remove the offset.

---

## Automated tests

```bash
npm test             # end-to-end acceptance suite (section 9): real server process + socket.io-client
npm run test:engine  # Chip War rule tests: tie-breaks, kill credit, assists, MVP falloff, safe NPC retirement
npm run typecheck
npm run balance      # dungeon win-rate table per role/level
```

`npm test` starts the server on a random port with a temporary database. It covers:

- **Trading:** buying and selling, a race for the last item, and a direct trade edited after one confirmation.
- **First upgrade:** reachable within five minutes.
- **Dungeons:** all four dungeons, equipping drops, spending dungeon gold, reconnecting after victory, and defeat then retry.
- **Daily reset:** crossing 6:00 AM Manila, including a run that straddles the reset.
- **Wars:** NPC backfill, a late entrant with safe bot retirement, one NPC kill plus one human kill, and an order that keeps running while disconnected.
- **Results:** identical results and rankings on both clients, war rewards paid once, and bonus-zone access.
- **Crash recovery:** a hard-kill restart in the middle of a claim, a war and a dungeon, with the interrupted claim retried exactly once.

See **[docs/TESTING.md](docs/TESTING.md)** for the manual checklist, including the physical Android steps.

---

## Game rules reference

- **Idle:** Hunting gives EXP, Gold Coins, Alloy Scrap and occasional gear. Mining gives ore and materials. Training raises a combat skill (+3% ATK/HP per level). Rewards come from server timestamps, are capped at 8 hours per absence, and a **While you were away** summary appears on return. The first upgrade (+0→+1) costs 60 Gold + 3 Alloy Scrap, which is reachable after about two minutes of hunting.
- **Dungeons:** there is one rewarded clear per dungeon per day. A defeat doesn't use it.
  - Training Grounds is available immediately.
  - Foundry and Vault unlock at level 2. Gold Mine unlocks at level 3.
  - Each daily period starts at **06:00 Asia/Manila**, and a run belongs to the period in which it started.
  - Only one active run is allowed per pilot. Dungeon kills never count toward Chip War stats.
- **Market:** a 5% fee, paid by the seller, with a minimum of 1 Gold. Listed items are held in escrow until they sell or you cancel. Every purchase settles in a single SQLite transaction. Direct trades have no fee, and any edit clears both approvals.
- **Chip Wars:**
  - Bases are 10 s apart, and respawns take 8 s. Humans and NPCs use the same rules.
  - The first faction to destroy an enemy chip wins.
  - If chips fall on the same tick, the tie goes to total chip damage dealt during the war. If that's also equal, the war is a draw.
  - If time runs out, the faction with the most chip damage wins. A tie at the top is a draw.
  - The winners get two hours in **Victor's Lode**: double ore, plus Prism Crystal.
- **Rankings:** Most Kills counts enemy *human* kills in Chip Wars. NPC kills, deaths, assists, best streak, healing (actual HP restored), defense and chip damage are tracked separately. Every board has current-war, weekly (from Monday 06:00 Manila) and all-time views, with a faction filter and your own rank. Top Killer is left unawarded if nobody defeated a human.
- **War MVP formula** (also shown in the app):
  ```
  MVP = 10 × K* + 3 × NPC kills + 4 × assists + damage ÷ 100 + chip damage ÷ 40 + healing ÷ 80 + defense ÷ 80
  K* = human kills, where repeat kills of the same opponent in one war count 1, ½, ¼, then 0.1 each.
  Defense = damage dealt to enemies at your own base + damage your Bulwark prevents.
  ```
- **NPC pilots** are named `NPC Callsign-NN`, carry an NPC badge, and are left out of every human leaderboard and award. Each faction is backfilled to 6 combatants, counting only the humans in that battle. NPCs retire at a respawn or after 3 s out of combat, never mid-duel. If more than 6 humans join, all of them play.

## Project layout

```
server/src/        index.ts (HTTP + Socket.IO + RPC), db.ts, clock.ts, characters.ts, idle.ts, dungeons.ts,
                   market.ts, trades.ts, rankings.ts, worldBots.ts, seed.ts, war/engine.ts, war/manager.ts
server/test/       acceptance.test.ts, engine.test.ts, harness.ts
shared/            content.ts, dungeonSim.ts, time.ts, protocol.ts, rng.ts
client/            index.html, vite.config.ts, src/ (App, screens/, art/, net.ts, ui.tsx, styles.css)
scripts/           android-setup.mjs, build-apk.mjs, balance.ts
capacitor.config.json
```

## Troubleshooting

- **`No such built-in module: node:sqlite`**: upgrade Node to 22.13+ or 24. The `ExperimentalWarning: SQLite…` message is harmless.
- **The app says it can't reach the server:**
  - Check the address: the emulator uses `10.0.2.2`, a phone uses your PC's Wi-Fi IP.
  - Check that the server is running and that the firewall allows port 3000.
  - Check that the phone is on the same network, not mobile data.
  - The APK allows plain HTTP to your dev server because `scripts/android-setup.mjs` sets `usesCleartextTraffic`. If you recreate `android/`, run `npm run android:add` again.
- **Reset everything:** stop the server, then run `npm run db:reset`.

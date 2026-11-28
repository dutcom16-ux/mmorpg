# Game rules reference

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

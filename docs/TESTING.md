# Acceptance testing

## Open world (manual check)

1. Sign in as `aurex_pilot` in one session. In a second session, create a new **Aurex** pilot so both start at Halcyon Spire.
2. **Shared view:** tap the ground in one session. The other session sees that pilot walk there.
3. **Fight:** tap a Rift Skitter. Your pilot walks into range and auto-attacks, and a loot toast appears when it dies.
4. **Party:** tap the other pilot and choose **Invite to party**, then accept in the other session. Kill a monster near each other. Both get a "(party share)" toast with the same EXP and Gold.
5. **Chat:** messages on World reach everyone. Faction and Party messages stay private.
6. **Mining:** tap a glowing ore crystal. After 3 seconds the ore lands in your Inventory, and the crystal goes dark.
7. **Chip War on the map:** launch a test war and tap **Join war**. Your pilot rallies at the base. Tap an enemy base and your pilot marches there along the road.

`npm test` automates every check below against a real server process, using the same WebSocket protocol as the apps. This page explains how to repeat the checks by hand, including the parts that need a real phone.

**Setup for every scenario:**

1. Run `npm run db:reset`, `npm run build:web` and `npm run server`.
2. Player A uses the APK (emulator or phone) and signs in as `aurex_pilot`.
3. Player B uses a desktop browser at `http://localhost:3000` and signs in as `kreth_pilot`.
4. When a third session is needed, use an incognito window with `vessari_pilot`.

## Trading

1. **A:** tap the pilot frame (top left of the World tab). Choose *Mining*, then under Developer tools tap *+1 hour*, then *Claim rewards*. Inventory → Ore now shows Lumen Ore.
2. **A:** Market → *Sell* → Lumen Ore, quantity 10, unit price 5 → *List item*. Inventory drops by 10, because the ore is held in escrow.
3. **B:** Market → search "lumen" → tap Solenne's listing → quantity 4. Before you confirm, the sheet shows: You pay 20, Fee 1, Seller receives 19. Tap *Buy for 20 Gold*.
4. **Check:**
   - B's gold is −20 and B has +4 Lumen.
   - A gets a toast and +19 gold.
   - Market → *History* lists the sale on both clients.
5. **Race for the last item:** A lists 1 Lumen. B and the third session open the buy sheet, then tap *Buy* at the same moment. One succeeds. The other sees "Sorry — that listing just sold out", and their gold doesn't change.
6. **Edited direct trade:**
   - A: Market → *Trades* → start a trade with `Tarrok` → *Change my offer* → add 5 Lumen → *Save offer*.
   - B: offer 30 gold.
   - A: *Approve this exact offer*.
   - B: change the offer to 25. Both sides now show *Not approved*, with the note "…both confirmations were cleared".
   - Both approve again. The trade completes at 25 gold.

## Dungeons

1. **A:** World → *Dungeons*. Each card shows its recommended level, duration, drops and clear status. The Gold Mine card shows its payout (550 at level 6).
2. Clear **Training Grounds** and tap the ability button at least once. Then clear **Weapon Foundry**, **Armored Vault** and **Gold Mine**. *+1 hour* finishes a run instantly.
3. On the Foundry and Vault results, compare the drop, then tap *Equip*. Inventory shows the new weapon and armor.
4. Spend the Gold Mine coins on a market listing.
5. **Defeat → retry:**
   - Create a new pilot and clear Training Grounds, which takes you to level 3.
   - Enter Gold Mine. You lose to the mech, or you can tap *Retreat*.
   - The card still says *Clear available*, and you can enter again.
6. **No double pay:** close the app right after a victory, then reopen it. The same result screen appears, and the gold is unchanged. Entering the cleared dungeon is refused.

## Morning reset (test clock)

1. Pilot frame → Developer tools → *Jump to 5:59 AM Manila*. All four of A's cards still say *Cleared today*.
2. With a pilot that hasn't cleared it, enter Training Grounds and tap *+1 hour*. The result says "Counted as the ⟨previous day⟩ daily clear", and Training Grounds is available again for the new day.
3. A's four dungeons are all available again. Equipment and gold are unchanged.
4. Tap *Real time* when you're done.

## Chip Wars

1. A and B: War → *Queue for the next war*. A: *Launch 2-minute test war*. The chip bars show "1 pilot, 5 NPC" for Aurex and Kreth, and "0 pilots, 6 NPC" for Vessari.
2. Late entrant: the third session joins the war. Their faction's NPC count drops by one within a few seconds. The feed reads "… retired after disengaging" or "… retired at respawn".
3. A: *Attack Kreth*. B: *Defend home*. Fights happen at Anvil Deep. The feed shows kills marked *(NPC)* or *(PILOT)*.
4. After the war, the recap shows Top Killer, Best Defender, War MVP, your stats and MVP breakdown, and your rewards. War → *Rankings* → *Most Kills* lists only human pilots. The rankings tests use the dev-only `dev.war.setHp` RPC to stage exactly one NPC kill and one human kill.

## Android lifecycle (physical phone)

1. During a war on the phone, choose *Attack ⟨enemy⟩*, then lock the phone for 20–30 s.
2. In the browser session, watch your pilot's dot travel and fight on the War map. The feed keeps updating.
3. Unlock the phone. The app reconnects on its own, shows the authoritative position, HP and order, and continues.
4. When the war ends, the phone and the browser show the same winner and the same rankings.
5. Repeat with a dungeon run: start a run on the phone, lock it, then sign in to the same account in the browser. The browser shows the run still going, or its result.

## Persistence

1. Note gold, inventory, Market → History, dungeon statuses and rankings on two accounts.
2. Stop the server with Ctrl+C, or kill the process, then run `npm run server` again. Both clients reconnect by themselves, and every value is identical.
3. **Interrupted claim:**
   - Turn on airplane mode on the phone.
   - Tap *Claim rewards*. The request can't reach the server, and the claim id is saved on the device.
   - Turn off airplane mode. The app retries the same claim id on reconnect, so the balance increases only once.
   - The automated test also hard-kills the server in the middle of a claim and verifies the same thing.

**Developer tools:** tap the pilot frame in the top left of the World tab. They include the test war, the test clock, +1 hour and +8 hours.

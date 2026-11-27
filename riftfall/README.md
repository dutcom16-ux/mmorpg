# Riftfall: Three Nations

A browser MMO-style war game inspired by the three-faction concept of RF Online. It is one self-contained `index.html` with no build step, made for phones (touch controls) and desktops (keyboard).

## The game

Three nations hold bases on the rim of the planet Veyra:

- **Ferros Union**: small engineers with carbines, sentry drones and a summonable battle mech.
- **Aether Covenant**: force casters with Flame Nova, Mend and Starfall.
- **Chrome Hegemony**: cyborgs with no force at all, only Rocket Barrage, Iron Wall and Siege Mode.

The Rift mine sits at the centre of the map, guarded by each nation's Heartcore.

- **Hunting.** Monsters get stronger the closer you go to the Rift: Dune Mites, Spinehogs, Voltwings, Rift Hounds, Stone Behemoths, and the Hollow Warden boss.
- **Heartcore sieges.** Every 2.5 minutes the Heartcore shields drop for 2 minutes. AI soldiers from all three nations march on the Rift, and forward war gates let you respawn close to the fight. The nation with the healthiest Heartcore wins the Rift: +15% XP, a tougher Heartcore next time, and the sole right to mine lumen.
- **Mining and gear.** Mine iron in the fields and lumen in the Rift. At your base terminal you can forge Mk I to Mk V gear and inscribe glyphs from +1 to +7. A failed inscription at +3 or higher can shatter the item back to +0.
- **War points** come from sieges and from defeating enemy soldiers, and buy shards and supplies.
- **Bounties**, auto-hunt, recall and auto-save (in the browser's localStorage).

## Controls

| Phone | Keyboard |
| --- | --- |
| Drag on the left half to move | WASD / arrow keys |
| Red button: attack nearest enemy, or tap an enemy | Space |
| Three skill buttons | 1, 2, 3 |
| Red flask / blue flask | Q / E |
| Yellow button: mine or open the terminal | F |
| AUTO: auto-hunt nearby monsters | R |
| Tap the target frame to switch targets | Tab |
| Menu button | M |

## Deploy

It's a static site: Vercel serves `index.html` from the repository root with no build settings.

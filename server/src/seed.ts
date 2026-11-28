// Seed data: three test accounts (one per faction) and a pool of clearly-labelled NPC pilots.
import { FACTION_IDS, NPC_CALLSIGNS, ROLE_IDS, type FactionId, type RoleId } from '../../shared/content';
import { addStack, createCharacter, insertAccount, prepareAccount } from './characters';
import { get, run, tx } from './db';
import { log } from './config';

export const TEST_ACCOUNTS: Array<{ username: string; password: string; name: string; faction: FactionId; role: RoleId }> = [
  { username: 'aurex_pilot', password: 'chipfall', name: 'Solenne', faction: 'aurex', role: 'assault' },
  { username: 'kreth_pilot', password: 'chipfall', name: 'Tarrok', faction: 'kreth', role: 'guardian' },
  { username: 'vessari_pilot', password: 'chipfall', name: 'Ilsevel', faction: 'vessari', role: 'engineer' },
];

export async function seedIfEmpty() {
  if (get('SELECT 1 FROM accounts LIMIT 1')) return false;
  const prepared: Array<Awaited<ReturnType<typeof prepareAccount>>> = [];
  for (const a of TEST_ACCOUNTS) prepared.push(await prepareAccount(a.username, a.password));
  tx(() => {
    for (const [i, a] of TEST_ACCOUNTS.entries()) {
      const acc = insertAccount(prepared[i], true);
      const id = createCharacter({ accountId: acc, name: a.name, faction: a.faction, role: a.role });
      // Mid-game starting point so every dungeon can be tested right away.
      run('UPDATE characters SET level = 6, gold = 600 WHERE id = ?', id);
      run('UPDATE items SET upgrade = 2 WHERE owner_id = ? AND stack = 0', id);
      addStack(id, 'o_lumen', 30);
      addStack(id, 'm_scrap', 12);
      addStack(id, 'm_circuit', 2);
    }
    let n = 0;
    for (const f of FACTION_IDS) {
      for (let i = 0; i < 8; i++) {
        const call = NPC_CALLSIGNS[(n * 5 + 3) % NPC_CALLSIGNS.length];
        const id = createCharacter({
          accountId: null,
          name: `NPC ${call}-${String(++n).padStart(2, '0')}`,
          faction: f,
          role: ROLE_IDS[i % 3],
          isBot: true,
        });
        run('UPDATE characters SET level = ?, gold = 200 WHERE id = ?', 3 + (i % 5), id);
        run('UPDATE idle_sessions SET activity = ? WHERE character_id = ?', i % 2 ? 'hunt' : 'mine', id);
      }
    }
  });
  log('Seeded test accounts:', TEST_ACCOUNTS.map((a) => `${a.username}/${a.password}`).join(', '));
  return true;
}

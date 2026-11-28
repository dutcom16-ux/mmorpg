// Temporary population: NPC pilots hunt and mine in the world and post some of their ore
// on the market, so a small player base still sees activity. All NPCs are named "NPC …".
import { ITEMS, type FactionId, type IdleActivity } from '../../shared/content';
import { stackQty } from './characters';
import { clock } from './clock';
import { all, get, run } from './db';
import { claimIdle } from './idle';
import { createListing } from './market';

let rngState = 12345;
function rand() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

export function worldBotsTick() {
  const bots = all<{ id: number; name: string; faction: FactionId }>('SELECT id, name, faction FROM characters WHERE is_bot = 1');
  if (!bots.length) return;
  // A couple of bots switch activity.
  for (let i = 0; i < 2; i++) {
    const b = bots[Math.floor(rand() * bots.length)];
    const act: IdleActivity = rand() < 0.55 ? 'mine' : 'hunt';
    try {
      claimIdle(b.id, `bot:${b.id}:${clock.now()}:${i}`);
      run('UPDATE idle_sessions SET activity = ?, zone = ? WHERE character_id = ?', act, 'quarry', b.id);
    } catch {
      /* ignore */
    }
  }
  // Keep a handful of NPC ore listings on the market.
  const open = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM listings l JOIN characters c ON c.id = l.seller_id WHERE c.is_bot = 1 AND l.status = 'active'",
  )!.n;
  if (open < 5) {
    const b = bots[Math.floor(rand() * bots.length)];
    try {
      claimIdle(b.id, `botsell:${b.id}:${clock.now()}`);
      const tpl = rand() < 0.7 ? 'o_lumen' : 'o_cobaltine';
      const have = stackQty(b.id, tpl);
      const qty = Math.min(have, 5 + Math.floor(rand() * 15));
      if (qty > 0) {
        const price = Math.max(1, Math.round(ITEMS[tpl].value * (0.9 + rand() * 0.3)));
        createListing(b.id, { templateId: tpl, qty, unitPrice: price });
      }
    } catch {
      /* ignore */
    }
  }
}

export function worldSummary(onlineCharIds: Set<number>) {
  const rows = all<{ id: number; faction: FactionId; is_bot: number; activity: IdleActivity }>(
    'SELECT c.id, c.faction, c.is_bot, s.activity FROM characters c JOIN idle_sessions s ON s.character_id = c.id',
  );
  const out: Record<string, { humansOnline: number; npcs: number; hunt: number; mine: number; train: number }> = {};
  for (const f of ['aurex', 'vessari', 'kreth']) out[f] = { humansOnline: 0, npcs: 0, hunt: 0, mine: 0, train: 0 };
  for (const r of rows) {
    const active = r.is_bot || onlineCharIds.has(r.id);
    if (!active) continue;
    const o = out[r.faction];
    if (r.is_bot) o.npcs++;
    else o.humansOnline++;
    o[r.activity]++;
  }
  return out;
}

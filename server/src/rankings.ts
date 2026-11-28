// Leaderboards. Only human pilots are stored in war_stats, so NPCs never appear here.
import { FACTION_IDS, type FactionId } from '../../shared/content';
import type { RankBoard, RankRow, RankScope, RankingView, WarPlayerStats } from '../../shared/protocol';
import { manilaString, weeklyPeriod } from '../../shared/time';
import { clock } from './clock';
import { all, get } from './db';
import type { WarManager } from './war/manager';

const COLUMN: Record<RankBoard, { sql: string; pick: (p: WarPlayerStats) => number }> = {
  kills: { sql: 'SUM(kills_human)', pick: (p) => p.killsHuman },
  mvp: { sql: 'ROUND(SUM(mvp), 1)', pick: (p) => p.mvp },
  npcKills: { sql: 'SUM(kills_npc)', pick: (p) => p.killsNpc },
  assists: { sql: 'SUM(assists)', pick: (p) => p.assists },
  healing: { sql: 'SUM(healing)', pick: (p) => p.healing },
  defense: { sql: 'SUM(defense)', pick: (p) => p.defense },
  chipDamage: { sql: 'SUM(chip_damage)', pick: (p) => p.chipDamage },
  bestStreak: { sql: 'MAX(best_streak)', pick: (p) => p.bestStreak },
  deaths: { sql: 'SUM(deaths)', pick: (p) => p.deaths },
};

export function rankings(wars: WarManager, board: RankBoard, scope: RankScope, faction: FactionId | 'all', meId: number | null): RankingView {
  const col = COLUMN[board] ?? COLUMN.kills;
  const fac = faction === 'all' || !FACTION_IDS.includes(faction) ? 'all' : faction;
  let raw: Array<{ charId: number; name: string; faction: FactionId; role: any; value: number }> = [];
  let periodLabel = '';

  if (scope === 'current') {
    let players: WarPlayerStats[] = [];
    if (wars.engine && wars.row) {
      players = wars.engine.humanStats();
      periodLabel = `War #${wars.row.id} (live)`;
    } else {
      const last = get<{ id: number }>("SELECT id FROM wars WHERE status = 'resolved' ORDER BY id DESC LIMIT 1");
      const res = last ? wars.result(last.id) : null;
      players = res?.players ?? [];
      periodLabel = last ? `War #${last.id} (last war)` : 'No wars yet';
    }
    raw = players.map((p) => ({ charId: p.charId, name: p.name, faction: p.faction, role: p.role, value: col.pick(p) }));
  } else {
    const since = scope === 'weekly' ? weeklyPeriod(clock.now()).start : 0;
    periodLabel = scope === 'weekly' ? `Week from ${manilaString(since).slice(0, 16)} (Manila)` : 'All time';
    raw = all<any>(
      `SELECT s.character_id AS charId, c.name AS name, c.faction AS faction, c.role AS role, ${col.sql} AS value
       FROM war_stats s JOIN characters c ON c.id = s.character_id
       WHERE s.ended_at >= ? GROUP BY s.character_id`,
      since,
    );
  }
  if (fac !== 'all') raw = raw.filter((r) => r.faction === fac);
  raw.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const rows: RankRow[] = [];
  let prev: number | null = null;
  let rank = 0;
  raw.forEach((r, i) => {
    if (prev === null || r.value !== prev) rank = i + 1;
    prev = r.value;
    rows.push({ rank, charId: r.charId, name: r.name, faction: r.faction, role: r.role, value: Number(r.value) || 0 });
  });
  // Rows with a zero score are shown in the current-war view (every participant), but unranked elsewhere.
  const visible = scope === 'current' ? rows : rows.filter((r) => r.value > 0);
  const me = meId ? (visible.find((r) => r.charId === meId) ?? null) : null;
  return { board, scope, faction: fac, rows: visible.slice(0, 50), me, periodLabel };
}

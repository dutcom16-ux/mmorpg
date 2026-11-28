// Idle activities. Rewards are computed only from server timestamps:
// reward window = [last_claim_at, now], capped at 8 hours per absence.
// Claims are idempotent: retrying the same claimId returns the stored result.
import {
  ARMORS,
  BONUS_ZONE_ID,
  ITEMS,
  MINING_ZONES,
  OFFLINE_CAP_MS,
  ROLE_WEAPONS,
  idleRates,
  type IdleActivity,
} from '../../shared/content';
import type { IdlePreview } from '../../shared/protocol';
import { hashString, mulberry32 } from '../../shared/rng';
import { addGear, addGold, addStack, getChar, grantExp, grantTrainXp } from './characters';
import { clock } from './clock';
import { fail, get, run, tx } from './db';

interface IdleRow {
  character_id: number;
  activity: IdleActivity;
  zone: string;
  last_claim_at: number;
  carry_json: string;
}

export function idleSession(charId: number): IdleRow {
  const s = get<IdleRow>('SELECT * FROM idle_sessions WHERE character_id = ?', charId);
  if (!s) fail('No idle session.');
  return s;
}

export function bonusAccess(faction: string): { grantedAt: number; expiresAt: number } | null {
  const r = get<{ granted_at: number; expires_at: number }>(
    'SELECT granted_at, expires_at FROM zone_access WHERE faction = ? AND zone = ?',
    faction,
    BONUS_ZONE_ID,
  );
  return r ? { grantedAt: r.granted_at, expiresAt: r.expires_at } : null;
}

interface Computed {
  preview: IdlePreview;
  carry: Record<string, number>;
}

function compute(charId: number, now: number): Computed {
  const s = idleSession(charId);
  const c = getChar(charId);
  const carry: Record<string, number> = JSON.parse(s.carry_json || '{}');
  const elapsed = Math.max(0, now - s.last_claim_at);
  const cappedMs = Math.min(elapsed, OFFLINE_CAP_MS);
  const from = s.last_claim_at;
  const to = from + cappedMs;

  // Split the window into bonus-zone time (while the faction had access) and normal time.
  const segments: Array<{ ms: number; zone: string }> = [];
  if (s.activity === 'mine' && s.zone === BONUS_ZONE_ID) {
    const acc = bonusAccess(c.faction);
    const bStart = acc ? Math.max(from, acc.grantedAt) : to;
    const bEnd = acc ? Math.min(to, acc.expiresAt) : to;
    const bonusMs = Math.max(0, bEnd - bStart);
    if (bonusMs > 0) segments.push({ ms: bonusMs, zone: BONUS_ZONE_ID });
    if (cappedMs - bonusMs > 0) segments.push({ ms: cappedMs - bonusMs, zone: 'quarry' });
  } else {
    segments.push({ ms: cappedMs, zone: s.zone });
  }

  const acc: Record<string, number> = { ...carry };
  const add = (k: string, v: number) => (acc[k] = (acc[k] ?? 0) + v);
  for (const seg of segments) {
    const min = seg.ms / 60000;
    const r = idleRates(s.activity, c.level, seg.zone);
    add('exp', r.exp * min);
    add('gold', r.gold * min);
    add('trainXp', r.trainXp * min);
    add('gear', r.gearDrop * min);
    for (const [tpl, rate] of Object.entries(r.items)) add(`i:${tpl}`, rate * min);
  }
  const out: Record<string, number> = {};
  const newCarry: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) {
    out[k] = Math.floor(v + 1e-9);
    newCarry[k] = v - out[k];
  }
  const items: Record<string, number> = {};
  for (const [k, v] of Object.entries(out)) if (k.startsWith('i:') && v > 0) items[k.slice(2)] = v;

  // Gear drops are seeded by character and window start, so previews match claims.
  const gear: string[] = [];
  const rng = mulberry32(hashString(`${charId}:${s.last_claim_at}`));
  for (let i = 0; i < (out.gear ?? 0); i++) {
    gear.push(rng() < 0.5 ? ROLE_WEAPONS[c.role].common : ARMORS.common);
  }

  return {
    preview: {
      elapsedMs: elapsed,
      cappedMs,
      capped: elapsed > OFFLINE_CAP_MS,
      exp: out.exp ?? 0,
      gold: out.gold ?? 0,
      trainXp: out.trainXp ?? 0,
      items,
      gear,
    },
    carry: newCarry,
  };
}

export function previewIdle(charId: number): IdlePreview {
  return compute(charId, clock.now()).preview;
}

export interface ClaimResult extends IdlePreview {
  claimId: string;
  levelUps: number;
  trainLevelUps: number;
  duplicate: boolean;
}

/** Pays out accrued idle rewards. Safe to retry with the same claimId. */
export function claimIdle(charId: number, claimId: string): ClaimResult {
  if (!claimId || typeof claimId !== 'string' || claimId.length > 64) fail('Missing claim id.');
  return tx(() => {
    const prior = get<{ character_id: number; result_json: string }>('SELECT * FROM idle_claims WHERE claim_id = ?', claimId);
    if (prior) {
      if (prior.character_id !== charId) fail('Claim id already used.');
      return { ...JSON.parse(prior.result_json), duplicate: true } as ClaimResult;
    }
    const now = clock.now();
    const { preview, carry } = compute(charId, now);
    addGold(charId, preview.gold);
    const levelUps = grantExp(charId, preview.exp);
    const trainLevelUps = grantTrainXp(charId, preview.trainXp);
    for (const [tpl, q] of Object.entries(preview.items)) addStack(charId, tpl, q);
    for (const g of preview.gear) addGear(charId, g);
    const s = idleSession(charId);
    let zone = s.zone;
    if (zone === BONUS_ZONE_ID) {
      const acc = bonusAccess(getChar(charId).faction);
      if (!acc || acc.expiresAt <= now) zone = 'quarry';
    }
    run('UPDATE idle_sessions SET last_claim_at = ?, carry_json = ?, zone = ? WHERE character_id = ?', now, JSON.stringify(carry), zone, charId);
    const result: ClaimResult = { ...preview, claimId, levelUps, trainLevelUps, duplicate: false };
    run('INSERT INTO idle_claims(claim_id, character_id, result_json, created_at) VALUES(?,?,?,?)', claimId, charId, JSON.stringify(result), now);
    return result;
  });
}

export function setActivity(charId: number, activity: IdleActivity, zone: string, claimId: string) {
  if (!['hunt', 'mine', 'train'].includes(activity)) fail('Unknown activity.');
  const z = activity === 'mine' ? zone || 'quarry' : 'quarry';
  if (!MINING_ZONES[z]) fail('Unknown zone.');
  return tx(() => {
    if (z === BONUS_ZONE_ID) {
      const acc = bonusAccess(getChar(charId).faction);
      if (!acc || acc.expiresAt <= clock.now()) fail('Your faction has no access to Victor’s Lode right now. Win a Chip War to open it.');
    }
    const claimed = claimIdle(charId, claimId);
    run('UPDATE idle_sessions SET activity = ?, zone = ? WHERE character_id = ?', activity, z, charId);
    return claimed;
  });
}

export function describeRewards(p: IdlePreview): string {
  const parts: string[] = [];
  if (p.exp) parts.push(`${p.exp} EXP`);
  if (p.gold) parts.push(`${p.gold} Gold`);
  if (p.trainXp) parts.push(`${p.trainXp} training XP`);
  for (const [t, q] of Object.entries(p.items)) parts.push(`${q} ${ITEMS[t]?.name ?? t}`);
  for (const g of p.gear) parts.push(ITEMS[g]?.name ?? g);
  return parts.join(', ') || 'nothing yet';
}

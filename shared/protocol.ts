// Messages exchanged between client and server.
// Clients call `socket.emit('rpc', method, params, ack)`; the ack receives an RpcResult.
// The server pushes 'player', 'dungeon', 'war', 'trade', 'market', 'toast' and 'world' events.
import type { CombatStats, DungeonId, FactionId, GearStats, IdleActivity, OrderKind, RoleId } from './content';
import type { DungeonSimState } from './dungeonSim';

export type RpcResult<T = any> = { ok: true; data: T } | { ok: false; error: string };

export interface ItemView {
  id: number;
  templateId: string;
  qty: number;
  upgrade: number;
  lock: null | 'listed';
  equipped: boolean;
  stats: GearStats;
}

export interface IdlePreview {
  elapsedMs: number;
  cappedMs: number;
  capped: boolean;
  exp: number;
  gold: number;
  trainXp: number;
  items: Record<string, number>;
  gear: string[];
}

export interface DungeonStatus {
  id: DungeonId;
  unlocked: boolean;
  cleared: boolean;
  available: boolean;
  payout: number | null;
}

export interface PlayerView {
  serverNow: number;
  character: {
    id: number;
    name: string;
    faction: FactionId;
    role: RoleId;
    level: number;
    exp: number;
    expToNext: number;
    gold: number;
    trainLevel: number;
    trainXp: number;
    trainXpToNext: number;
    stats: CombatStats;
    weaponId: number | null;
    armorId: number | null;
    isDev: boolean;
  };
  inventory: ItemView[];
  idle: {
    activity: IdleActivity;
    zone: string;
    lastClaimAt: number;
    pending: IdlePreview;
    returnSummary: IdlePreview | null; // shown once after an absence
  };
  dungeons: {
    periodKey: string;
    nextResetAt: number;
    list: DungeonStatus[];
    activeRunId: number | null;
  };
  bonusZone: { expiresAt: number } | null;
  war: { joinedWarId: number | null; unseenResultWarId: number | null };
  clockOffsetMs: number;
}

export interface DungeonRunView {
  runId: number;
  dungeonId: DungeonId;
  periodKey: string;
  startedAt: number;
  tickMs: number;
  state: DungeonSimState;
  finalized: boolean;
  reward: DungeonReward | null;
  role: RoleId;
}

export interface DungeonReward {
  rewarded: boolean; // false when the period's clear had already been used
  periodKey: string;
  exp: number;
  gold: number;
  items: Array<{ templateId: string; qty: number }>;
  gearItemId: number | null;
  gearTemplateId: string | null;
  levelUps: number;
}

export interface CombatantView {
  id: string;
  name: string;
  faction: FactionId;
  role: RoleId;
  isBot: boolean;
  charId: number | null;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnIn: number;
  loc: FactionId | null; // null while travelling
  from: FactionId | null;
  dest: FactionId | null;
  arriveIn: number;
  order: { kind: OrderKind; target?: string };
  abilityReadyIn: number;
  retiring: boolean;
  kills: number;
  deaths: number;
}

export interface WarFeedEntry {
  tick: number;
  kind: 'kill' | 'chip' | 'join' | 'retire' | 'info' | 'end';
  text: string;
}

export interface WarView {
  id: number;
  kind: 'scheduled' | 'test';
  startsAt: number;
  endsAt: number;
  tick: number;
  status: 'active' | 'resolved';
  chips: Record<FactionId, { hp: number; maxHp: number; destroyed: boolean }>;
  participation: Record<FactionId, { humans: number; npcs: number }>;
  orderCounts: Record<FactionId, Record<OrderKind, number>>;
  combatants: CombatantView[];
  feed: WarFeedEntry[];
  target: number;
}

export interface WarScheduleView {
  serverNow: number;
  active: WarView | null;
  nextStartAt: number;
  durationMin: number;
  intervalMin: number;
  lastResultWarId: number | null;
}

export interface WarPlayerStats {
  charId: number;
  name: string;
  faction: FactionId;
  role: RoleId;
  killsHuman: number;
  killsNpc: number;
  deaths: number;
  assists: number;
  bestStreak: number;
  healing: number;
  damage: number;
  chipDamage: number;
  defense: number;
  mvp: number;
  mvpBreakdown: Record<string, number>;
}

export interface WarResultView {
  warId: number;
  kind: 'scheduled' | 'test';
  startedAt: number;
  endedAt: number;
  winner: FactionId | null;
  reason: string;
  chips: Record<FactionId, { hp: number; maxHp: number; destroyed: boolean }>;
  chipDamageByFaction: Record<FactionId, number>;
  participation: Record<FactionId, { humans: number; npcs: number }>;
  awards: { topKiller: AwardView | null; bestDefender: AwardView | null; mvp: AwardView | null };
  players: WarPlayerStats[];
  rewards: Record<number, { gold: number; exp: number }>;
  feed: WarFeedEntry[];
}

export interface AwardView {
  charId: number;
  name: string;
  faction: FactionId;
  value: number;
}

export type RankBoard = 'kills' | 'mvp' | 'npcKills' | 'assists' | 'healing' | 'defense' | 'chipDamage' | 'bestStreak' | 'deaths';
export type RankScope = 'current' | 'weekly' | 'alltime';

export interface RankRow {
  rank: number;
  charId: number;
  name: string;
  faction: FactionId;
  role: RoleId;
  value: number;
}

export interface RankingView {
  board: RankBoard;
  scope: RankScope;
  faction: FactionId | 'all';
  rows: RankRow[];
  me: RankRow | null;
  periodLabel: string;
}

export interface ListingView {
  id: number;
  sellerId: number;
  sellerName: string;
  sellerFaction: FactionId;
  sellerIsBot: boolean;
  templateId: string;
  itemId: number | null;
  upgrade: number;
  qtyLeft: number;
  qtyTotal: number;
  unitPrice: number;
  createdAt: number;
  stats: GearStats;
}

export interface TradeOffer {
  gold: number;
  items: Array<{ itemId: number; qty: number }>;
}

export interface TradeView {
  id: number;
  version: number;
  status: 'open' | 'completed' | 'cancelled';
  a: { charId: number; name: string; faction: FactionId; offer: TradeOffer; confirmed: boolean };
  b: { charId: number; name: string; faction: FactionId; offer: TradeOffer; confirmed: boolean };
  itemInfo: Record<number, { templateId: string; upgrade: number }>;
  updatedAt: number;
  note: string | null;
}

export interface HistoryRow {
  id: number;
  kind: 'market' | 'trade';
  sellerName: string;
  buyerName: string;
  sellerId: number;
  buyerId: number;
  templateId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  total: number;
  fee: number;
  net: number;
  createdAt: number;
}

export const MARKET_FEE_RATE = 0.05;
export function marketFee(total: number): number {
  return total <= 0 ? 0 : Math.max(1, Math.ceil(total * MARKET_FEE_RATE));
}

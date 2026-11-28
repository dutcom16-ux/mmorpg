// Storage layer. The game logic talks to SQLite through run/get/all/tx; the actual engine is
// pluggable: node:sqlite for the local Node server and tests (db-node.ts), or a Cloudflare
// Durable Object's built-in SQLite (db-do.ts) in production.
export type Row = Record<string, any>;

export interface SqlBackend {
  exec(sql: string): void;
  run(sql: string, params: any[]): { changes: number; id: number };
  get(sql: string, params: any[]): Row | undefined;
  all(sql: string, params: any[]): Row[];
  /** Run fn atomically; throwing rolls everything back. Never called re-entrantly. */
  tx<T>(fn: () => T): T;
  close?(): void;
}

let backend: SqlBackend;
let txDepth = 0;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_dev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY,
  account_id INTEGER UNIQUE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  faction TEXT NOT NULL,
  role TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  exp INTEGER NOT NULL DEFAULT 0,
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  train_level INTEGER NOT NULL DEFAULT 0,
  train_xp INTEGER NOT NULL DEFAULT 0,
  weapon_item_id INTEGER,
  armor_item_id INTEGER,
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_war_seen INTEGER NOT NULL DEFAULT 0,
  world_x REAL,
  world_y REAL
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  template_id TEXT NOT NULL,
  stack INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty >= 0),
  upgrade INTEGER NOT NULL DEFAULT 0,
  lock TEXT,
  lock_ref INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_owner ON items(owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS items_stack ON items(owner_id, template_id) WHERE stack = 1;

CREATE TABLE IF NOT EXISTS idle_sessions (
  character_id INTEGER PRIMARY KEY,
  activity TEXT NOT NULL,
  zone TEXT NOT NULL,
  last_claim_at INTEGER NOT NULL,
  carry_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS idle_claims (
  claim_id TEXT PRIMARY KEY,
  character_id INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dungeon_runs (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL,
  dungeon_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  stats_json TEXT NOT NULL,
  level_at_start INTEGER NOT NULL,
  ability_ticks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  ended_at INTEGER,
  result_json TEXT,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS dungeon_one_active ON dungeon_runs(character_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS dungeon_clears (
  character_id INTEGER NOT NULL,
  dungeon_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  run_id INTEGER NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, dungeon_id, period_key)
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL,
  template_id TEXT NOT NULL,
  item_id INTEGER,
  upgrade INTEGER NOT NULL DEFAULT 0,
  qty_total INTEGER NOT NULL,
  qty_left INTEGER NOT NULL CHECK (qty_left >= 0),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_status ON listings(status, template_id);

CREATE TABLE IF NOT EXISTS trade_history (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id INTEGER,
  seller_id INTEGER NOT NULL,
  buyer_id INTEGER NOT NULL,
  template_id TEXT,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  net INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY,
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  a_offer TEXT NOT NULL,
  b_offer TEXT NOT NULL,
  a_ok INTEGER NOT NULL DEFAULT 0,
  b_ok INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wars (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  winner TEXT,
  reason TEXT,
  state_json TEXT,
  result_json TEXT,
  resolved_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS wars_slot ON wars(kind, starts_at);

CREATE TABLE IF NOT EXISTS war_stats (
  war_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  faction TEXT NOT NULL,
  role TEXT NOT NULL,
  kills_human INTEGER NOT NULL,
  kills_npc INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  best_streak INTEGER NOT NULL,
  healing INTEGER NOT NULL,
  damage INTEGER NOT NULL,
  chip_damage INTEGER NOT NULL,
  defense INTEGER NOT NULL,
  mvp REAL NOT NULL,
  mvp_json TEXT NOT NULL,
  ended_at INTEGER NOT NULL,
  PRIMARY KEY (war_id, character_id)
);

CREATE TABLE IF NOT EXISTS war_rewards (
  war_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  gold INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (war_id, character_id)
);

CREATE TABLE IF NOT EXISTS war_queue (
  character_id INTEGER PRIMARY KEY,
  queued_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS zone_access (
  faction TEXT NOT NULL,
  zone TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  war_id INTEGER NOT NULL,
  PRIMARY KEY (faction, zone)
);
`;

/** Installs a storage backend and creates/migrates the schema. */
export function useBackend(b: SqlBackend) {
  backend = b;
  txDepth = 0;
  for (const stmt of SCHEMA.split(';')) {
    if (stmt.trim()) backend.exec(stmt);
  }
  // Columns added after the first release (ignored when they already exist).
  for (const [table, col, decl] of [
    ['characters', 'world_x', 'REAL'],
    ['characters', 'world_y', 'REAL'],
  ]) {
    try {
      backend.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
    } catch {
      /* already there */
    }
  }
}

export function closeDb() {
  backend?.close?.();
}

export function run(sql: string, ...params: any[]) {
  return backend.run(sql, params);
}
export function get<T = Row>(sql: string, ...params: any[]): T | undefined {
  return backend.get(sql, params) as T | undefined;
}
export function all<T = Row>(sql: string, ...params: any[]): T[] {
  return backend.all(sql, params) as T[];
}
export function exec(sql: string) {
  backend.exec(sql);
}

/** Run `fn` inside one SQLite transaction. Nested calls join the outer transaction. */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  txDepth++;
  try {
    return backend.tx(fn);
  } finally {
    txDepth--;
  }
}

export function getMeta(key: string): string | undefined {
  return get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value;
}
export function setMeta(key: string, value: string) {
  run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

/** Thrown for player-facing validation errors; the message is shown in the client. */
export class GameError extends Error {}
export function fail(msg: string): never {
  throw new GameError(msg);
}

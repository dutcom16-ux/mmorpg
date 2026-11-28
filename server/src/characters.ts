import {
  FACTION_IDS,
  ITEMS,
  MAX_LEVEL,
  ROLE_IDS,
  STARTER_ARMOR,
  STARTER_WEAPON,
  STARTING_GOLD,
  STARTING_ITEMS,
  UPGRADE_MAX,
  characterStats,
  expToNext,
  itemStats,
  trainXpToNext,
  upgradeCost,
  type CombatStats,
  type FactionId,
  type RoleId,
} from '../../shared/content';
import type { ItemView } from '../../shared/protocol';
import { clock } from './clock';
import { all, fail, get, run, tx, type Row } from './db';

export interface CharRow {
  id: number;
  account_id: number | null;
  name: string;
  faction: FactionId;
  role: RoleId;
  level: number;
  exp: number;
  gold: number;
  train_level: number;
  train_xp: number;
  weapon_item_id: number | null;
  armor_item_id: number | null;
  is_bot: number;
  created_at: number;
  last_seen_at: number;
  last_war_seen: number;
  world_x: number | null;
  world_y: number | null;
}

export interface ItemRow {
  id: number;
  owner_id: number;
  template_id: string;
  stack: number;
  qty: number;
  upgrade: number;
  lock: string | null;
  lock_ref: number | null;
  created_at: number;
}

// ---------------------------------------------------------------- accounts
// Passwords are stored as salted PBKDF2-SHA-256 (Web Crypto, available in Node and Workers).

const PBKDF2_ROUNDS = 60_000;

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ROUNDS },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (x) => x.toString(16).padStart(2, '0')).join('');
}

function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function checkNewAccount(username: string, password: string): string {
  const name = String(username ?? '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) fail('Username must be 3–20 letters, numbers or _.');
  if (String(password ?? '').length < 4) fail('Password must be at least 4 characters.');
  if (get('SELECT id FROM accounts WHERE username = ?', name)) fail('That username is taken.');
  return name;
}

/** Hashes outside any transaction (async), returns what insertAccount needs. */
export async function prepareAccount(username: string, password: string) {
  const name = checkNewAccount(username, password);
  const salt = randomHex(16);
  return { name, salt, hash: await hashPassword(String(password), salt) };
}

export function insertAccount(a: { name: string; salt: string; hash: string }, isDev = false): number {
  if (get('SELECT id FROM accounts WHERE username = ?', a.name)) fail('That username is taken.');
  return run('INSERT INTO accounts(username, pass_hash, salt, is_dev, created_at) VALUES(?,?,?,?,?)', a.name, a.hash, a.salt, isDev ? 1 : 0, clock.now()).id;
}

export async function verifyLogin(username: string, password: string): Promise<Row> {
  const acc = get('SELECT * FROM accounts WHERE username = ?', String(username ?? '').trim());
  if (!acc) fail('Unknown username or wrong password.');
  const h = await hashPassword(String(password ?? ''), acc.salt);
  if (!sameHex(h, acc.pass_hash)) fail('Unknown username or wrong password.');
  return acc;
}

export function createSession(accountId: number): string {
  const token = randomHex(24);
  run('INSERT INTO sessions(token, account_id, created_at) VALUES(?,?,?)', token, accountId, clock.now());
  return token;
}

export function accountForToken(token: string | undefined): Row | undefined {
  if (!token || typeof token !== 'string') return undefined;
  return get('SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = ?', token);
}

// -------------------------------------------------------------- characters

export function createCharacter(opts: {
  accountId: number | null;
  name: string;
  faction: FactionId;
  role: RoleId;
  isBot?: boolean;
  level?: number;
}): number {
  const name = opts.name.trim();
  if (!opts.isBot && !/^[A-Za-z0-9_ -]{3,16}$/.test(name)) fail('Pilot name must be 3–16 characters.');
  if (!FACTION_IDS.includes(opts.faction)) fail('Pick a faction.');
  if (!ROLE_IDS.includes(opts.role)) fail('Pick a role.');
  if (get('SELECT id FROM characters WHERE name = ?', name)) fail('That pilot name is taken.');
  const now = clock.now();
  return tx(() => {
    const id = run(
      `INSERT INTO characters(account_id, name, faction, role, level, gold, is_bot, created_at, last_seen_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      opts.accountId,
      name,
      opts.faction,
      opts.role,
      opts.level ?? 1,
      STARTING_GOLD,
      opts.isBot ? 1 : 0,
      now,
      now,
    ).id;
    const w = addGear(id, STARTER_WEAPON[opts.role]);
    const a = addGear(id, STARTER_ARMOR);
    run('UPDATE characters SET weapon_item_id = ?, armor_item_id = ? WHERE id = ?', w, a, id);
    for (const [tpl, q] of STARTING_ITEMS) addStack(id, tpl, q);
    run(
      'INSERT INTO idle_sessions(character_id, activity, zone, last_claim_at) VALUES(?,?,?,?)',
      id,
      opts.isBot ? 'mine' : 'hunt',
      'quarry',
      now,
    );
    return id;
  });
}

export function getChar(id: number): CharRow {
  const c = get<CharRow>('SELECT * FROM characters WHERE id = ?', id);
  if (!c) fail('Character not found.');
  return c;
}

export function charForAccount(accountId: number): CharRow | undefined {
  return get<CharRow>('SELECT * FROM characters WHERE account_id = ?', accountId);
}

export function findCharByName(name: string): CharRow | undefined {
  return get<CharRow>('SELECT * FROM characters WHERE name = ? AND is_bot = 0', String(name ?? '').trim());
}

export function charStats(c: CharRow): CombatStats {
  const w = c.weapon_item_id ? get<ItemRow>('SELECT * FROM items WHERE id = ?', c.weapon_item_id) : undefined;
  const a = c.armor_item_id ? get<ItemRow>('SELECT * FROM items WHERE id = ?', c.armor_item_id) : undefined;
  return characterStats(
    c.role,
    c.level,
    c.train_level,
    w ? { templateId: w.template_id, upgrade: w.upgrade } : null,
    a ? { templateId: a.template_id, upgrade: a.upgrade } : null,
  );
}

// ---------------------------------------------------------------- inventory

export function addStack(ownerId: number, templateId: string, qty: number) {
  if (qty <= 0) return;
  if (!ITEMS[templateId]?.stack) throw new Error(`not stackable: ${templateId}`);
  run(
    `INSERT INTO items(owner_id, template_id, stack, qty, created_at) VALUES(?,?,1,?,?)
     ON CONFLICT(owner_id, template_id) WHERE stack = 1 DO UPDATE SET qty = qty + excluded.qty`,
    ownerId,
    templateId,
    qty,
    clock.now(),
  );
}

export function stackQty(ownerId: number, templateId: string): number {
  return get<{ qty: number }>('SELECT qty FROM items WHERE owner_id = ? AND template_id = ? AND stack = 1', ownerId, templateId)?.qty ?? 0;
}

export function removeStack(ownerId: number, templateId: string, qty: number) {
  if (qty <= 0) return;
  const r = run(
    'UPDATE items SET qty = qty - ? WHERE owner_id = ? AND template_id = ? AND stack = 1 AND qty >= ?',
    qty,
    ownerId,
    templateId,
    qty,
  );
  if (r.changes !== 1) fail(`Not enough ${ITEMS[templateId]?.name ?? templateId}.`);
}

export function addGear(ownerId: number, templateId: string, upgrade = 0): number {
  const t = ITEMS[templateId];
  if (!t || t.stack) throw new Error(`not gear: ${templateId}`);
  return run('INSERT INTO items(owner_id, template_id, stack, qty, upgrade, created_at) VALUES(?,?,0,1,?,?)', ownerId, templateId, upgrade, clock.now()).id;
}

export function addGold(charId: number, amount: number) {
  if (amount === 0) return;
  const r = run('UPDATE characters SET gold = gold + ? WHERE id = ? AND gold + ? >= 0', amount, charId, amount);
  if (r.changes !== 1) fail('Not enough Gold Coins.');
}

/** Adds EXP and applies level-ups. Returns the number of levels gained. */
export function grantExp(charId: number, exp: number): number {
  if (exp <= 0) return 0;
  const c = getChar(charId);
  let level = c.level;
  let xp = c.exp + exp;
  let ups = 0;
  while (level < MAX_LEVEL && xp >= expToNext(level)) {
    xp -= expToNext(level);
    level++;
    ups++;
  }
  run('UPDATE characters SET level = ?, exp = ? WHERE id = ?', level, xp, charId);
  return ups;
}

export function grantTrainXp(charId: number, amount: number): number {
  if (amount <= 0) return 0;
  const c = getChar(charId);
  let lvl = c.train_level;
  let xp = c.train_xp + amount;
  let ups = 0;
  while (xp >= trainXpToNext(lvl) && lvl < 50) {
    xp -= trainXpToNext(lvl);
    lvl++;
    ups++;
  }
  run('UPDATE characters SET train_level = ?, train_xp = ? WHERE id = ?', lvl, xp, charId);
  return ups;
}

export function inventory(charId: number): ItemView[] {
  const c = getChar(charId);
  const rows = all<ItemRow>('SELECT * FROM items WHERE owner_id = ? AND qty > 0 ORDER BY stack, template_id, upgrade DESC, id', charId);
  return rows.map((r) => ({
    id: r.id,
    templateId: r.template_id,
    qty: r.qty,
    upgrade: r.upgrade,
    lock: (r.lock as 'listed' | null) ?? null,
    equipped: r.id === c.weapon_item_id || r.id === c.armor_item_id,
    stats: itemStats(r.template_id, r.upgrade),
  }));
}

export function ownedGear(charId: number, itemId: number): ItemRow {
  const it = get<ItemRow>('SELECT * FROM items WHERE id = ? AND owner_id = ? AND stack = 0 AND qty = 1', itemId, charId);
  if (!it) fail('You do not own that item.');
  return it;
}

export function isEquipped(c: CharRow, itemId: number) {
  return c.weapon_item_id === itemId || c.armor_item_id === itemId;
}

export function equip(charId: number, itemId: number) {
  return tx(() => {
    const c = getChar(charId);
    const it = ownedGear(charId, itemId);
    if (it.lock) fail('That item is listed on the market. Cancel the listing to equip it.');
    const t = ITEMS[it.template_id];
    if (t.kind === 'weapon') {
      if (t.role !== c.role) fail(`Only ${t.role} pilots can use ${t.name}.`);
      run('UPDATE characters SET weapon_item_id = ? WHERE id = ?', itemId, charId);
    } else if (t.kind === 'armor') {
      run('UPDATE characters SET armor_item_id = ? WHERE id = ?', itemId, charId);
    } else fail('That item cannot be equipped.');
  });
}

export function upgradeItem(charId: number, itemId: number) {
  return tx(() => {
    const it = ownedGear(charId, itemId);
    if (it.lock) fail('That item is listed on the market.');
    if (it.upgrade >= UPGRADE_MAX) fail('Already at maximum upgrade.');
    const cost = upgradeCost(it.upgrade);
    const c = getChar(charId);
    if (c.gold < cost.gold) fail(`Upgrade needs ${cost.gold} Gold Coins.`);
    for (const [tpl, q] of cost.materials) {
      if (stackQty(charId, tpl) < q) fail(`Upgrade needs ${q} ${ITEMS[tpl].name}.`);
    }
    addGold(charId, -cost.gold);
    for (const [tpl, q] of cost.materials) removeStack(charId, tpl, q);
    run('UPDATE items SET upgrade = upgrade + 1 WHERE id = ?', itemId);
    return { itemId, upgrade: it.upgrade + 1, cost };
  });
}

export function touchSeen(charId: number) {
  run('UPDATE characters SET last_seen_at = ? WHERE id = ?', clock.now(), charId);
}

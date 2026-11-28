// Direct player-to-player trades. Each change to either offer bumps the version and clears
// BOTH confirmations. A confirmation names the version it approves, so a player can only
// approve the exact offer they saw. When both approve the same version, settlement runs
// in one transaction and re-validates every item and coin.
import { ITEMS } from '../../shared/content';
import type { TradeOffer, TradeView } from '../../shared/protocol';
import { addGold, addStack, findCharByName, getChar, isEquipped, removeStack, stackQty, type ItemRow } from './characters';
import { clock } from './clock';
import { GameError, all, fail, get, run, tx } from './db';

interface TradeRow {
  id: number;
  a_id: number;
  b_id: number;
  a_offer: string;
  b_offer: string;
  a_ok: number;
  b_ok: number;
  version: number;
  status: 'open' | 'completed' | 'cancelled';
  note: string | null;
  created_at: number;
  updated_at: number;
}

const EMPTY: TradeOffer = { gold: 0, items: [] };

function getTrade(id: number): TradeRow {
  const t = get<TradeRow>('SELECT * FROM trades WHERE id = ?', id);
  if (!t) fail('Trade not found.');
  return t;
}

function side(t: TradeRow, charId: number): 'a' | 'b' {
  if (t.a_id === charId) return 'a';
  if (t.b_id === charId) return 'b';
  fail('Not your trade.');
}

export function tradeView(id: number): TradeView {
  const t = getTrade(id);
  const a = getChar(t.a_id);
  const b = getChar(t.b_id);
  const ao: TradeOffer = JSON.parse(t.a_offer);
  const bo: TradeOffer = JSON.parse(t.b_offer);
  const ids = [...ao.items, ...bo.items].map((i) => i.itemId);
  const itemInfo: TradeView['itemInfo'] = {};
  for (const iid of ids) {
    const r = get<ItemRow>('SELECT * FROM items WHERE id = ?', iid);
    if (r) itemInfo[iid] = { templateId: r.template_id, upgrade: r.upgrade };
  }
  return {
    id: t.id,
    version: t.version,
    status: t.status,
    a: { charId: a.id, name: a.name, faction: a.faction, offer: ao, confirmed: !!t.a_ok },
    b: { charId: b.id, name: b.name, faction: b.faction, offer: bo, confirmed: !!t.b_ok },
    itemInfo,
    updatedAt: t.updated_at,
    note: t.note,
  };
}

export function openTrade(charId: number, otherName: string): TradeView {
  const other = findCharByName(otherName);
  if (!other) fail(`No pilot named “${otherName}”.`);
  if (other.id === charId) fail('You cannot trade with yourself.');
  const existing = get<{ id: number }>(
    "SELECT id FROM trades WHERE status = 'open' AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?))",
    charId,
    other.id,
    other.id,
    charId,
  );
  if (existing) return tradeView(existing.id);
  const now = clock.now();
  const id = run(
    "INSERT INTO trades(a_id, b_id, a_offer, b_offer, status, created_at, updated_at) VALUES(?,?,?,?, 'open', ?, ?)",
    charId,
    other.id,
    JSON.stringify(EMPTY),
    JSON.stringify(EMPTY),
    now,
    now,
  ).id;
  return tradeView(id);
}

function normalizeOffer(charId: number, offer: TradeOffer): TradeOffer {
  const gold = Math.floor(Number(offer?.gold ?? 0));
  if (!Number.isFinite(gold) || gold < 0) fail('Gold must be zero or more.');
  const items: TradeOffer['items'] = [];
  const seen = new Set<number>();
  for (const raw of offer?.items ?? []) {
    const itemId = Math.floor(Number(raw.itemId));
    const qty = Math.floor(Number(raw.qty));
    if (seen.has(itemId)) fail('Each item can appear once in an offer.');
    seen.add(itemId);
    if (!(qty >= 1)) fail('Item quantity must be at least 1.');
    items.push({ itemId, qty });
  }
  if (items.length > 12) fail('At most 12 items per offer.');
  validateOffer(charId, { gold, items });
  return { gold, items };
}

function validateOffer(charId: number, offer: TradeOffer) {
  const c = getChar(charId);
  if (c.gold < offer.gold) fail(`${c.name} does not have ${offer.gold} Gold Coins.`);
  for (const { itemId, qty } of offer.items) {
    const it = get<ItemRow>('SELECT * FROM items WHERE id = ? AND owner_id = ?', itemId, charId);
    if (!it || it.qty <= 0) fail(`${c.name} no longer has one of the offered items.`);
    if (it.lock) fail(`${ITEMS[it.template_id].name} is listed on the market and cannot be traded.`);
    if (isEquipped(c, it.id)) fail(`Unequip ${ITEMS[it.template_id].name} before trading it.`);
    if (it.stack) {
      if (stackQty(charId, it.template_id) < qty) fail(`${c.name} does not have ${qty} ${ITEMS[it.template_id].name}.`);
    } else if (qty !== 1) fail('Gear quantity must be 1.');
  }
}

export function updateOffer(charId: number, tradeId: number, offer: TradeOffer): TradeView {
  return tx(() => {
    const t = getTrade(tradeId);
    if (t.status !== 'open') fail('That trade is closed.');
    const s = side(t, charId);
    const clean = normalizeOffer(charId, offer);
    const who = getChar(charId).name;
    const hadConfirm = t.a_ok || t.b_ok;
    run(
      `UPDATE trades SET ${s}_offer = ?, a_ok = 0, b_ok = 0, version = version + 1, updated_at = ?, note = ? WHERE id = ?`,
      JSON.stringify(clean),
      clock.now(),
      hadConfirm ? `${who} changed their offer — both confirmations were cleared.` : `${who} updated their offer.`,
      tradeId,
    );
    return tradeView(tradeId);
  });
}

export function confirmTrade(charId: number, tradeId: number, version: number): TradeView {
  return tx(() => {
    const t = getTrade(tradeId);
    if (t.status !== 'open') fail('That trade is closed.');
    const s = side(t, charId);
    if (Number(version) !== t.version) fail('The offer changed. Review it and confirm again.');
    run(`UPDATE trades SET ${s}_ok = 1, updated_at = ?, note = ? WHERE id = ?`, clock.now(), `${getChar(charId).name} confirmed.`, tradeId);
    const t2 = getTrade(tradeId);
    if (t2.a_ok && t2.b_ok) {
      try {
        validateOffer(t2.a_id, JSON.parse(t2.a_offer));
        validateOffer(t2.b_id, JSON.parse(t2.b_offer));
      } catch (e) {
        if (!(e instanceof GameError)) throw e;
        run(
          'UPDATE trades SET a_ok = 0, b_ok = 0, version = version + 1, updated_at = ?, note = ? WHERE id = ?',
          clock.now(),
          `Could not settle: ${e.message} Confirmations were cleared.`,
          tradeId,
        );
        return tradeView(tradeId);
      }
      settle(t2);
    }
    return tradeView(tradeId);
  });
}

function settle(t: TradeRow) {
  const ao: TradeOffer = JSON.parse(t.a_offer);
  const bo: TradeOffer = JSON.parse(t.b_offer);
  const now = clock.now();
  const a = getChar(t.a_id);
  const b = getChar(t.b_id);
  const move = (from: number, to: number, offer: TradeOffer, fromName: string, toName: string) => {
    if (offer.gold > 0) {
      addGold(from, -offer.gold);
      addGold(to, offer.gold);
    }
    for (const { itemId, qty } of offer.items) {
      const it = get<ItemRow>('SELECT * FROM items WHERE id = ?', itemId)!;
      if (it.stack) {
        removeStack(from, it.template_id, qty);
        addStack(to, it.template_id, qty);
      } else {
        const m = run('UPDATE items SET owner_id = ? WHERE id = ? AND owner_id = ? AND lock IS NULL', to, itemId, from);
        if (m.changes !== 1) fail('An offered item is no longer available.');
      }
      run(
        `INSERT INTO trade_history(kind, ref_id, seller_id, buyer_id, template_id, description, qty, unit_price, total, fee, net, created_at)
         VALUES('trade', ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
        t.id,
        from,
        to,
        it.template_id,
        `Direct trade: ${ITEMS[it.template_id].name}${it.upgrade ? ` +${it.upgrade}` : ''} ×${qty} — ${fromName} → ${toName}`,
        qty,
        now,
      );
    }
    if (offer.gold > 0) {
      run(
        `INSERT INTO trade_history(kind, ref_id, seller_id, buyer_id, template_id, description, qty, unit_price, total, fee, net, created_at)
         VALUES('trade', ?, ?, ?, NULL, ?, 1, ?, ?, 0, ?, ?)`,
        t.id,
        from,
        to,
        `Direct trade: ${offer.gold} Gold Coins — ${fromName} → ${toName}`,
        offer.gold,
        offer.gold,
        offer.gold,
        now,
      );
    }
  };
  move(t.a_id, t.b_id, ao, a.name, b.name);
  move(t.b_id, t.a_id, bo, b.name, a.name);
  run("UPDATE trades SET status = 'completed', updated_at = ?, note = 'Trade complete.' WHERE id = ? AND status = 'open'", now, t.id);
}

export function cancelTrade(charId: number, tradeId: number): TradeView {
  const t = getTrade(tradeId);
  side(t, charId);
  if (t.status !== 'open') fail('That trade is closed.');
  run("UPDATE trades SET status = 'cancelled', updated_at = ?, note = ? WHERE id = ?", clock.now(), `${getChar(charId).name} cancelled the trade.`, tradeId);
  return tradeView(tradeId);
}

export function myTrades(charId: number): TradeView[] {
  return all<{ id: number }>(
    "SELECT id FROM trades WHERE (a_id = ? OR b_id = ?) AND (status = 'open' OR updated_at > ?) ORDER BY updated_at DESC LIMIT 20",
    charId,
    charId,
    clock.now() - 3_600_000,
  ).map((r) => tradeView(r.id));
}

export function tradeParties(tradeId: number): [number, number] {
  const t = getTrade(tradeId);
  return [t.a_id, t.b_id];
}

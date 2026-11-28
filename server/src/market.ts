// Shared cross-faction marketplace. Listed items sit in escrow inside the listing:
// stackables are removed from the seller's bag, gear is locked so it cannot be equipped,
// upgraded, traded or listed twice. Purchases settle in a single transaction.
import { ITEMS, itemStats } from '../../shared/content';
import { marketFee, type HistoryRow, type ListingView } from '../../shared/protocol';
import { addGold, addStack, getChar, isEquipped, ownedGear, removeStack, stackQty } from './characters';
import { clock } from './clock';
import { all, fail, get, run, tx } from './db';

interface ListingRow {
  id: number;
  seller_id: number;
  template_id: string;
  item_id: number | null;
  upgrade: number;
  qty_total: number;
  qty_left: number;
  unit_price: number;
  status: string;
  created_at: number;
}

function toView(r: ListingRow & { seller_name: string; seller_faction: any; seller_bot: number }): ListingView {
  return {
    id: r.id,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    sellerFaction: r.seller_faction,
    sellerIsBot: !!r.seller_bot,
    templateId: r.template_id,
    itemId: r.item_id,
    upgrade: r.upgrade,
    qtyLeft: r.qty_left,
    qtyTotal: r.qty_total,
    unitPrice: r.unit_price,
    createdAt: r.created_at,
    stats: itemStats(r.template_id, r.upgrade),
  };
}

const LISTING_SELECT = `SELECT l.*, c.name AS seller_name, c.faction AS seller_faction, c.is_bot AS seller_bot
  FROM listings l JOIN characters c ON c.id = l.seller_id`;

export function searchListings(p: { q?: string; kind?: string; sort?: string; limit?: number }): ListingView[] {
  const q = String(p.q ?? '').trim().toLowerCase();
  const kind = String(p.kind ?? 'all');
  const rows = all<any>(`${LISTING_SELECT} WHERE l.status = 'active' AND l.qty_left > 0 ORDER BY l.id DESC LIMIT 400`);
  let out = rows.map(toView).filter((l) => {
    const t = ITEMS[l.templateId];
    if (!t) return false;
    if (kind !== 'all' && t.kind !== kind) return false;
    if (q && !t.name.toLowerCase().includes(q) && !l.sellerName.toLowerCase().includes(q)) return false;
    return true;
  });
  if (p.sort === 'price') out.sort((a, b) => a.unitPrice - b.unitPrice || a.id - b.id);
  out = out.slice(0, Math.min(200, p.limit ?? 100));
  return out;
}

export function myListings(charId: number): ListingView[] {
  return all<any>(`${LISTING_SELECT} WHERE l.seller_id = ? AND l.status = 'active' ORDER BY l.id DESC`, charId).map(toView);
}

export function createListing(charId: number, p: { itemId?: number; templateId?: string; qty?: number; unitPrice: number }): ListingView {
  const unitPrice = Math.floor(Number(p.unitPrice));
  if (!Number.isFinite(unitPrice) || unitPrice < 1 || unitPrice > 10_000_000) fail('Set a unit price of at least 1 Gold Coin.');
  return tx(() => {
    const c = getChar(charId);
    const open = get<{ n: number }>("SELECT COUNT(*) AS n FROM listings WHERE seller_id = ? AND status = 'active'", charId)!.n;
    if (open >= 20) fail('You can have at most 20 active listings.');
    const now = clock.now();
    let id: number;
    if (p.itemId) {
      const it = ownedGear(charId, Number(p.itemId));
      if (it.lock) fail('That item is already listed.');
      if (isEquipped(c, it.id)) fail('Unequip that item before listing it.');
      id = run(
        `INSERT INTO listings(seller_id, template_id, item_id, upgrade, qty_total, qty_left, unit_price, status, created_at)
         VALUES(?,?,?,?,1,1,?, 'active', ?)`,
        charId,
        it.template_id,
        it.id,
        it.upgrade,
        unitPrice,
        now,
      ).id;
      const lock = run("UPDATE items SET lock = 'listed', lock_ref = ? WHERE id = ? AND lock IS NULL", id, it.id);
      if (lock.changes !== 1) fail('That item is already listed.');
    } else {
      const tpl = String(p.templateId ?? '');
      if (!ITEMS[tpl]?.stack) fail('Pick an item to list.');
      const qty = Math.floor(Number(p.qty));
      if (!Number.isFinite(qty) || qty < 1) fail('Quantity must be at least 1.');
      if (stackQty(charId, tpl) < qty) fail(`You only have ${stackQty(charId, tpl)} ${ITEMS[tpl].name}.`);
      removeStack(charId, tpl, qty);
      id = run(
        `INSERT INTO listings(seller_id, template_id, item_id, upgrade, qty_total, qty_left, unit_price, status, created_at)
         VALUES(?,?,NULL,0,?,?,?, 'active', ?)`,
        charId,
        tpl,
        qty,
        qty,
        unitPrice,
        now,
      ).id;
    }
    return toView(get<any>(`${LISTING_SELECT} WHERE l.id = ?`, id));
  });
}

export function cancelListing(charId: number, listingId: number) {
  return tx(() => {
    const l = get<ListingRow>('SELECT * FROM listings WHERE id = ?', listingId);
    if (!l || l.seller_id !== charId) fail('Listing not found.');
    if (l.status !== 'active') fail('That listing is no longer active.');
    run("UPDATE listings SET status = 'cancelled' WHERE id = ? AND status = 'active'", listingId);
    if (l.item_id) {
      run('UPDATE items SET lock = NULL, lock_ref = NULL WHERE id = ? AND lock_ref = ?', l.item_id, listingId);
    } else if (l.qty_left > 0) {
      addStack(charId, l.template_id, l.qty_left);
    }
    return { listingId, returned: l.qty_left };
  });
}

export interface BuyResult {
  listingId: number;
  templateId: string;
  qty: number;
  unitPrice: number;
  total: number;
  fee: number;
  sellerNet: number;
  sellerId: number;
  itemId: number | null;
  buyerGold: number;
}

export function buyListing(buyerId: number, listingId: number, qtyIn: number, expectedUnitPrice?: number): BuyResult {
  return tx(() => {
    const l = get<ListingRow>('SELECT * FROM listings WHERE id = ?', listingId);
    if (!l) fail('Listing not found.');
    if (l.status !== 'active' || l.qty_left <= 0) fail('Sorry — that listing just sold out.');
    if (l.seller_id === buyerId) fail('You cannot buy your own listing.');
    if (expectedUnitPrice !== undefined && expectedUnitPrice !== l.unit_price) fail('The price changed. Please review again.');
    const qty = l.item_id ? 1 : Math.floor(Number(qtyIn));
    if (!Number.isFinite(qty) || qty < 1) fail('Quantity must be at least 1.');
    if (qty > l.qty_left) fail(`Only ${l.qty_left} left in this listing.`);
    const total = qty * l.unit_price;
    const fee = marketFee(total);
    const net = total - fee;
    const buyer = getChar(buyerId);
    if (buyer.gold < total) fail(`You need ${total} Gold Coins (you have ${buyer.gold}).`);

    // Conditional updates: if anything changed underneath us, the whole transaction rolls back.
    const take = run(
      "UPDATE listings SET qty_left = qty_left - ?, status = CASE WHEN qty_left - ? = 0 THEN 'sold' ELSE status END WHERE id = ? AND status = 'active' AND qty_left >= ?",
      qty,
      qty,
      listingId,
      qty,
    );
    if (take.changes !== 1) fail('Sorry — that listing just sold out.');
    addGold(buyerId, -total);
    addGold(l.seller_id, net);
    if (l.item_id) {
      const moved = run(
        'UPDATE items SET owner_id = ?, lock = NULL, lock_ref = NULL WHERE id = ? AND owner_id = ? AND lock_ref = ?',
        buyerId,
        l.item_id,
        l.seller_id,
        listingId,
      );
      if (moved.changes !== 1) throw new Error('escrowed item missing');
    } else {
      addStack(buyerId, l.template_id, qty);
    }
    const seller = getChar(l.seller_id);
    const t = ITEMS[l.template_id];
    run(
      `INSERT INTO trade_history(kind, ref_id, seller_id, buyer_id, template_id, description, qty, unit_price, total, fee, net, created_at)
       VALUES('market', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      listingId,
      l.seller_id,
      buyerId,
      l.template_id,
      `${t.name}${l.upgrade ? ` +${l.upgrade}` : ''} ×${qty} — ${seller.name} → ${buyer.name}`,
      qty,
      l.unit_price,
      total,
      fee,
      net,
      clock.now(),
    );
    return {
      listingId,
      templateId: l.template_id,
      qty,
      unitPrice: l.unit_price,
      total,
      fee,
      sellerNet: net,
      sellerId: l.seller_id,
      itemId: l.item_id,
      buyerGold: buyer.gold - total,
    };
  });
}

export function tradeHistory(charId: number | null, limit = 50): HistoryRow[] {
  const rows = charId
    ? all<any>(
        `SELECT h.*, s.name AS seller_name, b.name AS buyer_name FROM trade_history h
         JOIN characters s ON s.id = h.seller_id JOIN characters b ON b.id = h.buyer_id
         WHERE h.seller_id = ? OR h.buyer_id = ? ORDER BY h.id DESC LIMIT ?`,
        charId,
        charId,
        limit,
      )
    : all<any>(
        `SELECT h.*, s.name AS seller_name, b.name AS buyer_name FROM trade_history h
         JOIN characters s ON s.id = h.seller_id JOIN characters b ON b.id = h.buyer_id
         ORDER BY h.id DESC LIMIT ?`,
        limit,
      );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    sellerName: r.seller_name,
    buyerName: r.buyer_name,
    sellerId: r.seller_id,
    buyerId: r.buyer_id,
    templateId: r.template_id,
    description: r.description,
    qty: r.qty,
    unitPrice: r.unit_price,
    total: r.total,
    fee: r.fee,
    net: r.net,
    createdAt: r.created_at,
  }));
}

export function priceGuide(templateId: string) {
  const recent = all<{ unit_price: number }>(
    "SELECT unit_price FROM trade_history WHERE template_id = ? AND kind = 'market' ORDER BY id DESC LIMIT 10",
    templateId,
  );
  const avg = recent.length ? Math.round(recent.reduce((a, r) => a + r.unit_price, 0) / recent.length) : null;
  const lowest = get<{ p: number }>("SELECT MIN(unit_price) AS p FROM listings WHERE template_id = ? AND status = 'active'", templateId)?.p ?? null;
  return { suggested: ITEMS[templateId]?.value ?? 1, recentAvg: avg, lowestListed: lowest };
}

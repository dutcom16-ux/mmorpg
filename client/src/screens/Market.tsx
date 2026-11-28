import { useEffect, useMemo, useState } from 'react';
import { FACTIONS, ITEMS, type ItemKind } from '../../../shared/content';
import { marketFee, type HistoryRow, type ItemView, type ListingView, type TradeOffer, type TradeView } from '../../../shared/protocol';
import { FactionEmblem, ItemIcon } from '../art/Art';
import { act, rpc, useStore } from '../net';
import { Gold, ItemName, Panel, Sheet, Stepper } from '../ui';

type Tab = 'browse' | 'sell' | 'mine' | 'history' | 'trades';

export function Market({ preset, clearPreset }: { preset: ItemView | null; clearPreset: () => void }) {
  const [tab, setTab] = useState<Tab>(preset ? 'sell' : 'browse');
  useEffect(() => {
    if (preset) setTab('sell');
  }, [preset]);
  const trades = useStore((s) => s.trades);
  const openTrades = trades.filter((t) => t.status === 'open').length;
  return (
    <div className="screen market">
      <h2 className="screen-title">Market</h2>
      <div className="tabs" role="tablist">
        {(
          [
            ['browse', 'Browse'],
            ['sell', 'Sell'],
            ['mine', 'My listings'],
            ['history', 'History'],
            ['trades', openTrades ? `Trades (${openTrades})` : 'Trades'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'browse' && <Browse />}
      {tab === 'sell' && <Sell preset={preset} done={() => { clearPreset(); setTab('mine'); }} />}
      {tab === 'mine' && <MyListings />}
      {tab === 'history' && <History />}
      {tab === 'trades' && <Trades />}
    </div>
  );
}

function SellerTag({ l }: { l: ListingView }) {
  return (
    <span className="seller">
      <FactionEmblem faction={l.sellerFaction} size={16} />
      {l.sellerName}
      {l.sellerIsBot && <span className="badge npc">NPC</span>}
    </span>
  );
}

function Browse() {
  const me = useStore((s) => s.player)!;
  const rev = useStore((s) => s.marketRev);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | ItemKind>('all');
  const [sort, setSort] = useState<'new' | 'price'>('new');
  const [rows, setRows] = useState<ListingView[] | null>(null);
  const [buying, setBuying] = useState<ListingView | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      rpc<ListingView[]>('market.search', { q, kind, sort }).then((r) => live && setRows(r)).catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, kind, sort, rev]);

  return (
    <>
      <div className="search">
        <input placeholder="Search items or sellers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the market" />
      </div>
      <div className="chip-row">
        {(['all', 'weapon', 'armor', 'ore', 'material'] as const).map((k) => (
          <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {k === 'all' ? 'Everything' : k[0].toUpperCase() + k.slice(1) + (k === 'ore' ? '' : 's')}
          </button>
        ))}
        <button className="chip" onClick={() => setSort(sort === 'new' ? 'price' : 'new')}>
          {sort === 'new' ? 'Newest first' : 'Cheapest first'}
        </button>
      </div>
      {rows === null ? (
        <p className="muted">Loading listings…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No listings match. Try another search, or list something yourself.</p>
      ) : (
        <ul className="listings">
          {rows.map((l) => (
            <li key={l.id}>
              <button className="listing" onClick={() => setBuying(l)} disabled={l.sellerId === me.character.id}>
                <ItemIcon templateId={l.templateId} size={44} />
                <div className="listing-main">
                  <ItemName templateId={l.templateId} upgrade={l.upgrade} />
                  <SellerTag l={l} />
                </div>
                <div className="listing-price">
                  <Gold n={l.unitPrice} />
                  <span className="muted small">{l.itemId ? 'each' : `each, ${l.qtyLeft} left`}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {buying && <BuySheet l={buying} onClose={() => setBuying(null)} />}
    </>
  );
}

function BuySheet({ l, onClose }: { l: ListingView; onClose: () => void }) {
  const me = useStore((s) => s.player)!;
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);
  const total = n * l.unitPrice;
  const fee = marketFee(total);
  const short = me.character.gold < total;
  const buy = async () => {
    setBusy(true);
    const r = await act('market.buy', { listingId: l.id, qty: n, unitPrice: l.unitPrice }, `Bought ${n} ${ITEMS[l.templateId].name}.`);
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Sheet title={`Buy ${ITEMS[l.templateId].name}`} onClose={onClose}>
      <div className="compare-head">
        <ItemIcon templateId={l.templateId} size={52} />
        <div>
          <ItemName templateId={l.templateId} upgrade={l.upgrade} />
          <p className="muted small">{ITEMS[l.templateId].desc}</p>
          <SellerTag l={l} />
        </div>
      </div>
      {!l.itemId && <Stepper value={n} max={l.qtyLeft} onChange={setN} />}
      <dl className="receipt">
        <div>
          <dt>You pay</dt>
          <dd>
            <Gold n={total} />
          </dd>
        </div>
        <div>
          <dt>Market fee (5%, paid by seller)</dt>
          <dd>
            <Gold n={fee} />
          </dd>
        </div>
        <div>
          <dt>Seller receives</dt>
          <dd>
            <Gold n={total - fee} />
          </dd>
        </div>
        <div>
          <dt>Your balance after</dt>
          <dd>
            <Gold n={Math.max(0, me.character.gold - total)} />
          </dd>
        </div>
      </dl>
      {short && <p className="warn">You need {total - me.character.gold} more Gold Coins.</p>}
      <button className="btn btn-primary btn-big" disabled={busy || short} onClick={buy}>
        {busy ? 'Buying…' : `Buy for ${total.toLocaleString()} Gold`}
      </button>
    </Sheet>
  );
}

function Sell({ preset, done }: { preset: ItemView | null; done: () => void }) {
  const p = useStore((s) => s.player)!;
  const sellable = p.inventory.filter((i) => !i.equipped && !i.lock && i.qty > 0);
  const [itemId, setItemId] = useState<number | null>(preset?.id ?? sellable[0]?.id ?? null);
  const item = sellable.find((i) => i.id === itemId) ?? null;
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState<number>(item ? ITEMS[item.templateId].value : 1);
  const [guide, setGuide] = useState<{ suggested: number; recentAvg: number | null; lowestListed: number | null } | null>(null);

  useEffect(() => {
    if (preset) setItemId(preset.id);
  }, [preset]);
  useEffect(() => {
    if (!item) return;
    setQty(ITEMS[item.templateId].stack ? Math.min(item.qty, 10) : 1);
    setPrice(ITEMS[item.templateId].value);
    rpc('market.price', { templateId: item.templateId }).then(setGuide).catch(() => setGuide(null));
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sellable.length) return <p className="muted">Nothing to sell yet. Mine ore, or unequip gear you no longer use.</p>;
  const total = qty * price;
  const fee = marketFee(total);
  const list = async () => {
    if (!item) return;
    const stack = ITEMS[item.templateId].stack;
    const r = await act('market.list', stack ? { templateId: item.templateId, qty, unitPrice: price } : { itemId: item.id, unitPrice: price }, 'Listed. Your item is held in escrow until it sells or you cancel.');
    if (r) done();
  };

  return (
    <Panel className="sell">
      <label className="field">
        <span>Item</span>
        <select value={itemId ?? ''} onChange={(e) => setItemId(Number(e.target.value))}>
          {sellable.map((i) => (
            <option key={i.id} value={i.id}>
              {ITEMS[i.templateId].name}
              {i.upgrade ? ` +${i.upgrade}` : ''}
              {ITEMS[i.templateId].stack ? ` (have ${i.qty})` : ''}
            </option>
          ))}
        </select>
      </label>
      {item && ITEMS[item.templateId].stack && (
        <div className="field">
          <span>Quantity</span>
          <Stepper value={qty} max={item.qty} onChange={setQty} />
        </div>
      )}
      <label className="field">
        <span>Unit price (Gold Coins)</span>
        <input inputMode="numeric" value={price} onChange={(e) => setPrice(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
      </label>
      {guide && (
        <p className="muted small">
          Suggested {guide.suggested}
          {guide.recentAvg !== null ? `, recent sales average ${guide.recentAvg}` : ''}
          {guide.lowestListed !== null ? `, lowest listed ${guide.lowestListed}` : ''}.
        </p>
      )}
      <dl className="receipt">
        <div>
          <dt>Buyer pays</dt>
          <dd>
            <Gold n={total} />
          </dd>
        </div>
        <div>
          <dt>Market fee (5%)</dt>
          <dd>
            <Gold n={fee} />
          </dd>
        </div>
        <div>
          <dt>You receive</dt>
          <dd>
            <Gold n={total - fee} />
          </dd>
        </div>
      </dl>
      <button className="btn btn-primary btn-big" onClick={list} disabled={!item}>
        List item
      </button>
    </Panel>
  );
}

function MyListings() {
  const rev = useStore((s) => s.marketRev);
  const [rows, setRows] = useState<ListingView[]>([]);
  useEffect(() => {
    rpc<ListingView[]>('market.mine').then(setRows).catch(() => {});
  }, [rev]);
  if (!rows.length) return <p className="muted">You have no active listings.</p>;
  return (
    <ul className="listings">
      {rows.map((l) => (
        <li key={l.id} className="listing static">
          <ItemIcon templateId={l.templateId} size={44} />
          <div className="listing-main">
            <ItemName templateId={l.templateId} upgrade={l.upgrade} />
            <span className="muted small">
              {l.qtyLeft} of {l.qtyTotal} left at <Gold n={l.unitPrice} /> each
            </span>
          </div>
          <button className="btn btn-ghost" onClick={() => act('market.cancel', { listingId: l.id }, 'Listing cancelled. Items returned to your bag.')}>
            Cancel
          </button>
        </li>
      ))}
    </ul>
  );
}

function History() {
  const me = useStore((s) => s.player)!;
  const rev = useStore((s) => s.marketRev);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  useEffect(() => {
    rpc<HistoryRow[]>('market.history', { scope }).then(setRows).catch(() => {});
  }, [scope, rev, me.character.gold]);
  return (
    <>
      <div className="seg">
        <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>
          My trades
        </button>
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
          Whole market
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No trades yet.</p>
      ) : (
        <ul className="history">
          {rows.map((h) => {
            const sold = h.sellerId === me.character.id;
            const bought = h.buyerId === me.character.id;
            return (
              <li key={h.id}>
                <span>{h.description}</span>
                <span className="muted small">
                  {new Date(h.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {h.kind === 'market' && (sold ? `, you received ${h.net} (fee ${h.fee})` : bought ? `, you paid ${h.total}` : `, ${h.total} Gold`)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ------------------------------------------------------------------ trades

function Trades() {
  const trades = useStore((s) => s.trades);
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const t = trades.find((x) => x.id === openId);
  return (
    <>
      <Panel>
        <b>Trade directly with a pilot</b>
        <p className="muted small">Swap items and Gold Coins. Both of you must approve the exact same offer; any change clears both approvals.</p>
        <div className="inline-form">
          <input placeholder="Pilot name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Pilot name" />
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={async () => {
              const r = await act<TradeView>('trade.open', { name });
              if (r) {
                setOpenId(r.id);
                setName('');
              }
            }}
          >
            Start trade
          </button>
        </div>
      </Panel>
      {trades.length === 0 && <p className="muted">No trades in the last hour.</p>}
      <ul className="trade-list">
        {trades.map((x) => (
          <li key={x.id}>
            <button className="listing" onClick={() => setOpenId(x.id)}>
              <div className="listing-main">
                <b>
                  {x.a.name} and {x.b.name}
                </b>
                <span className="muted small">{x.status === 'open' ? x.note ?? 'Open' : x.status === 'completed' ? 'Completed' : 'Cancelled'}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {t && <TradeSheet t={t} onClose={() => setOpenId(null)} />}
    </>
  );
}

function OfferList({ offer, info }: { offer: TradeOffer; info: TradeView['itemInfo'] }) {
  if (!offer.gold && !offer.items.length) return <p className="muted small">Nothing offered yet.</p>;
  return (
    <ul className="offer">
      {offer.gold > 0 && (
        <li>
          <Gold n={offer.gold} />
        </li>
      )}
      {offer.items.map((i) => (
        <li key={i.itemId}>
          {i.qty}× {info[i.itemId] ? <ItemName templateId={info[i.itemId].templateId} upgrade={info[i.itemId].upgrade} /> : 'item'}
        </li>
      ))}
    </ul>
  );
}

function TradeSheet({ t, onClose }: { t: TradeView; onClose: () => void }) {
  const p = useStore((s) => s.player)!;
  const mine = t.a.charId === p.character.id ? t.a : t.b;
  const theirs = t.a.charId === p.character.id ? t.b : t.a;
  const [editing, setEditing] = useState(false);
  const [gold, setGold] = useState(mine.offer.gold);
  const [items, setItems] = useState<Record<number, number>>(() => Object.fromEntries(mine.offer.items.map((i) => [i.itemId, i.qty])));
  const tradable = useMemo(() => p.inventory.filter((i) => !i.equipped && !i.lock), [p.inventory]);

  const save = async () => {
    const offer: TradeOffer = { gold, items: Object.entries(items).filter(([, q]) => q > 0).map(([id, q]) => ({ itemId: Number(id), qty: q })) };
    const r = await act('trade.offer', { tradeId: t.id, offer });
    if (r) setEditing(false);
  };

  return (
    <Sheet title={`Trade with ${theirs.name}`} onClose={onClose}>
      {t.note && <p className="note">{t.note}</p>}
      <div className="trade-cols">
        <div className={`trade-side ${mine.confirmed ? 'ok' : ''}`}>
          <h4>You give</h4>
          <OfferList offer={mine.offer} info={t.itemInfo} />
          <span className="small">{mine.confirmed ? 'You approved' : 'Not approved'}</span>
        </div>
        <div className={`trade-side ${theirs.confirmed ? 'ok' : ''}`}>
          <h4>
            <FactionEmblem faction={theirs.faction} size={16} /> {theirs.name} gives
          </h4>
          <OfferList offer={theirs.offer} info={t.itemInfo} />
          <span className="small">{theirs.confirmed ? `${theirs.name} approved` : 'Not approved'}</span>
        </div>
      </div>
      {t.status !== 'open' ? (
        <p className={t.status === 'completed' ? 'good' : 'muted'}>{t.status === 'completed' ? 'Trade complete. Items and coins have moved.' : 'This trade was cancelled.'}</p>
      ) : editing ? (
        <div className="offer-edit">
          <label className="field">
            <span>Gold Coins (you have {p.character.gold})</span>
            <input inputMode="numeric" value={gold} onChange={(e) => setGold(Math.max(0, Math.min(p.character.gold, Math.floor(Number(e.target.value)) || 0)))} />
          </label>
          <ul className="pick-items">
            {tradable.map((i) => {
              const stack = ITEMS[i.templateId].stack;
              const q = items[i.id] ?? 0;
              return (
                <li key={i.id}>
                  <ItemIcon templateId={i.templateId} size={32} />
                  <ItemName templateId={i.templateId} upgrade={i.upgrade} />
                  {stack ? (
                    <input className="qty-input" inputMode="numeric" value={q} aria-label="Quantity" onChange={(e) => setItems({ ...items, [i.id]: Math.max(0, Math.min(i.qty, Math.floor(Number(e.target.value)) || 0)) })} />
                  ) : (
                    <input type="checkbox" checked={q > 0} aria-label="Include" onChange={(e) => setItems({ ...items, [i.id]: e.target.checked ? 1 : 0 })} />
                  )}
                </li>
              );
            })}
          </ul>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={save}>
              Save offer
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button className="btn btn-primary" disabled={mine.confirmed} onClick={() => act('trade.confirm', { tradeId: t.id, version: t.version })}>
            {mine.confirmed ? 'Waiting for the other pilot' : 'Approve this exact offer'}
          </button>
          <button className="btn" onClick={() => setEditing(true)}>
            Change my offer
          </button>
          <button className="btn btn-ghost" onClick={() => act('trade.cancel', { tradeId: t.id })}>
            Cancel trade
          </button>
        </div>
      )}
      <p className="muted small">Offer version {t.version}. {FACTIONS[theirs.faction].name}.</p>
    </Sheet>
  );
}

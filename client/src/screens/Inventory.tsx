import { useState } from 'react';
import { ITEMS, ROLES, UPGRADE_MAX, itemStats, upgradeCost } from '../../../shared/content';
import type { ItemView, PlayerView } from '../../../shared/protocol';
import { ItemIcon } from '../art/Art';
import { act, useStore } from '../net';
import { Gold, ItemName, Panel, Sheet, StatDelta } from '../ui';

export function Inventory({ sell }: { sell: (item: ItemView) => void }) {
  const p = useStore((s) => s.player)!;
  const [open, setOpen] = useState<number | null>(null);
  const c = p.character;
  const weapon = p.inventory.find((i) => i.id === c.weaponId);
  const armor = p.inventory.find((i) => i.id === c.armorId);
  const gear = p.inventory.filter((i) => !ITEMS[i.templateId].stack && !i.equipped);
  const ore = p.inventory.filter((i) => ITEMS[i.templateId].kind === 'ore');
  const mats = p.inventory.filter((i) => ITEMS[i.templateId].kind === 'material');
  const item = open ? p.inventory.find((i) => i.id === open) : null;

  return (
    <div className="screen inventory">
      <h2 className="screen-title">Inventory</h2>
      <div className="equipped">
        {[weapon, armor].map((it, idx) =>
          it ? (
            <button key={it.id} className="slot" onClick={() => setOpen(it.id)}>
              <ItemIcon templateId={it.templateId} size={52} />
              <span className="slot-label">{idx === 0 ? 'Weapon' : 'Armor'}</span>
              <ItemName templateId={it.templateId} upgrade={it.upgrade} />
              <span className="muted small">{statLine(it)}</span>
            </button>
          ) : (
            <div key={idx} className="slot empty">
              {idx === 0 ? 'No weapon' : 'No armor'}
            </div>
          ),
        )}
      </div>
      {weapon && <UpgradeBox item={weapon} player={p} />}

      <Section title="Gear in bag" items={gear} empty="Dungeon drops and hunting finds land here." onOpen={setOpen} />
      <Section title="Ore" items={ore} empty="Go mining to dig ore you can sell." onOpen={setOpen} />
      <Section title="Materials" items={mats} empty="Hunting and dungeons give upgrade materials." onOpen={setOpen} />

      {item && (
        <Sheet title={ITEMS[item.templateId].name} onClose={() => setOpen(null)}>
          <ItemDetail item={item} player={p} onSell={() => { setOpen(null); sell(item); }} />
        </Sheet>
      )}
    </div>
  );
}

function statLine(it: ItemView) {
  const s = it.stats;
  return [s.atk && `ATK ${s.atk}`, s.def && `DEF ${s.def}`, s.hp && `HP ${s.hp}`].filter(Boolean).join(', ');
}

function Section({ title, items, empty, onOpen }: { title: string; items: ItemView[]; empty: string; onOpen: (id: number) => void }) {
  return (
    <Panel className="bag">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="item-grid">
          {items.map((it) => (
            <li key={it.id}>
              <button className="item-tile" onClick={() => onOpen(it.id)}>
                <ItemIcon templateId={it.templateId} size={44} />
                <span className="item-tile-name">
                  <ItemName templateId={it.templateId} upgrade={it.upgrade} />
                </span>
                {ITEMS[it.templateId].stack && <span className="qty">×{it.qty}</span>}
                {it.lock && <span className="badge">Listed</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function UpgradeBox({ item, player }: { item: ItemView; player: PlayerView }) {
  if (item.upgrade >= UPGRADE_MAX) return null;
  const cost = upgradeCost(item.upgrade);
  const have = (t: string) => player.inventory.filter((i) => i.templateId === t).reduce((s, i) => s + i.qty, 0);
  const affordable = player.character.gold >= cost.gold && cost.materials.every(([t, q]) => have(t) >= q);
  const next = itemStats(item.templateId, item.upgrade + 1);
  return (
    <Panel className="upgrade">
      <div className="upgrade-head">
        <b>
          Upgrade to +{item.upgrade + 1}
        </b>
        <span className="muted small">
          ATK {item.stats.atk} to {next.atk}
          {next.def ? `, DEF ${item.stats.def} to ${next.def}` : ''}
          {next.hp ? `, HP ${item.stats.hp} to ${next.hp}` : ''}
        </span>
      </div>
      <ul className="cost">
        <li className={player.character.gold >= cost.gold ? '' : 'short'}>
          <Gold n={cost.gold} />
        </li>
        {cost.materials.map(([t, q]) => (
          <li key={t} className={have(t) >= q ? '' : 'short'}>
            {q}× <ItemName templateId={t} /> <span className="muted">(have {have(t)})</span>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" disabled={!affordable || !!item.lock} onClick={() => act('gear.upgrade', { itemId: item.id }, `${ITEMS[item.templateId].name} is now +${item.upgrade + 1}.`)}>
        Upgrade
      </button>
    </Panel>
  );
}

function ItemDetail({ item, player, onSell }: { item: ItemView; player: PlayerView; onSell: () => void }) {
  const t = ITEMS[item.templateId];
  const c = player.character;
  const isGear = !t.stack;
  const slotId = t.kind === 'weapon' ? c.weaponId : c.armorId;
  const current = player.inventory.find((i) => i.id === slotId);
  const cur = current ? current.stats : { atk: 0, def: 0, hp: 0 };
  const wrongRole = t.kind === 'weapon' && t.role !== c.role;
  return (
    <div className="item-detail">
      <div className="compare-head">
        <ItemIcon templateId={item.templateId} size={56} />
        <div>
          <ItemName templateId={item.templateId} upgrade={item.upgrade} />
          <p className="muted small">{t.desc}</p>
          {t.kind === 'weapon' && <p className="small">For {ROLES[t.role!].name} pilots.</p>}
          {t.stack && <p className="small">You have {item.qty}.</p>}
        </div>
      </div>
      {isGear && !item.equipped && current && !wrongRole && (
        <>
          <p className="small muted">
            Compared with your <ItemName templateId={current.templateId} upgrade={current.upgrade} />:
          </p>
          <div className="deltas">
            <StatDelta label="ATK" now={cur.atk} next={item.stats.atk} />
            <StatDelta label="DEF" now={cur.def} next={item.stats.def} />
            <StatDelta label="HP" now={cur.hp} next={item.stats.hp} />
          </div>
        </>
      )}
      {item.lock && <p className="warn">Listed on the market. Cancel the listing to equip, upgrade or trade it.</p>}
      <div className="btn-row">
        {isGear && !item.equipped && !wrongRole && (
          <button className="btn btn-primary" disabled={!!item.lock} onClick={() => act('gear.equip', { itemId: item.id }, `Equipped ${t.name}.`)}>
            Equip
          </button>
        )}
        {isGear && item.upgrade < UPGRADE_MAX && !item.equipped && (
          <button className="btn" disabled={!!item.lock} onClick={() => act('gear.upgrade', { itemId: item.id }, `${t.name} upgraded.`)}>
            Upgrade (<Gold n={upgradeCost(item.upgrade).gold} />)
          </button>
        )}
        {!item.equipped && !item.lock && (
          <button className="btn" onClick={onSell}>
            Sell on market
          </button>
        )}
      </div>
      {item.equipped && <p className="muted small">Equipped. Unequip by equipping another item in this slot.</p>}
    </div>
  );
}

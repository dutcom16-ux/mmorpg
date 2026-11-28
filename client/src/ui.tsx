import { useEffect, useState, type ReactNode } from 'react';
import { ITEMS, rarityColor } from '../../shared/content';
import { CoinIcon } from './art/Art';
import { serverNow } from './net';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Local wall-clock time of a server timestamp, in the player's own time zone. */
export function fmtLocal(t: number, withDay = true): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!withDay) return time;
  const today = new Date(serverNow());
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(serverNow() + 86_400_000).toDateString() === d.toDateString();
  if (sameDay) return `today ${time}`;
  if (tomorrow) return `tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}

export function Gold({ n, big }: { n: number; big?: boolean }) {
  return (
    <span className={big ? 'gold gold-big' : 'gold'}>
      <CoinIcon size={big ? 20 : 15} /> {n.toLocaleString()}
    </span>
  );
}

export function Bar({ value, max, tone = 'accent', label }: { value: number; max: number; tone?: 'accent' | 'hp' | 'enemy' | 'gold'; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`bar bar-${tone}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
      {label && <span className="bar-label">{label}</span>}
    </div>
  );
}

export function Panel({ children, className = '', tone }: { children: ReactNode; className?: string; tone?: 'accent' | 'quiet' }) {
  return <section className={`panel ${tone ? `panel-${tone}` : ''} ${className}`}>{children}</section>;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ItemName({ templateId, upgrade = 0 }: { templateId: string; upgrade?: number }) {
  const t = ITEMS[templateId];
  return (
    <span style={{ color: rarityColor(t?.rarity ?? 'common') }}>
      {t?.name ?? templateId}
      {upgrade ? ` +${upgrade}` : ''}
    </span>
  );
}

export function StatDelta({ label, now, next }: { label: string; now: number; next: number }) {
  const d = next - now;
  return (
    <div className="stat-delta">
      <span>{label}</span>
      <b>{next}</b>
      {d !== 0 && <em className={d > 0 ? 'up' : 'down'}>{d > 0 ? `+${d}` : d}</em>}
    </div>
  );
}

export function Stepper({ value, min = 1, max, onChange }: { value: number; min?: number; max: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.floor(v) || min));
  return (
    <div className="stepper">
      <button className="btn btn-ghost" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label="Less">
        −
      </button>
      <input inputMode="numeric" value={value} onChange={(e) => onChange(clamp(Number(e.target.value)))} aria-label="Quantity" />
      <button className="btn btn-ghost" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label="More">
        +
      </button>
      <button className="btn btn-ghost" onClick={() => onChange(max)} disabled={value >= max}>
        Max
      </button>
    </div>
  );
}

export function rewardLines(r: { exp?: number; gold?: number; trainXp?: number; items?: Record<string, number> | Array<{ templateId: string; qty: number }>; gear?: string[] }): Array<{ key: string; node: ReactNode }> {
  const out: Array<{ key: string; node: ReactNode }> = [];
  if (r.exp) out.push({ key: 'exp', node: <>+{r.exp} EXP</> });
  if (r.gold) out.push({ key: 'gold', node: <Gold n={r.gold} /> });
  if (r.trainXp) out.push({ key: 'tx', node: <>+{r.trainXp} training XP</> });
  const items = Array.isArray(r.items) ? r.items.map((i) => [i.templateId, i.qty] as const) : Object.entries(r.items ?? {});
  for (const [t, q] of items) out.push({ key: `i${t}`, node: <>{q}× <ItemName templateId={t} /></> });
  for (const [i, g] of (r.gear ?? []).entries()) out.push({ key: `g${i}`, node: <ItemName templateId={g} /> });
  return out;
}

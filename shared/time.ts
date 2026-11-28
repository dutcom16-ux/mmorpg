// Daily and weekly periods anchored to 6:00 AM in Asia/Manila.

export const RESET_TIME_ZONE = 'Asia/Manila';
export const RESET_HOUR = 6;
const DAY_MS = 86_400_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Offset (ms) of `tz` from UTC at instant `t`. Asia/Manila is +8h with no DST. */
export function tzOffsetMs(t: number, tz = RESET_TIME_ZONE): number {
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(t))) parts[p.type] = p.value;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

export interface Period {
  key: string; // YYYY-MM-DD of the Manila date on which the period began at 06:00
  start: number; // epoch ms
  next: number; // epoch ms of the next reset
}

/** The daily dungeon period containing instant `t`. */
export function dailyPeriod(t: number): Period {
  const off = tzOffsetMs(t);
  const shifted = new Date(t + off - RESET_HOUR * 3_600_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const start = Date.UTC(y, m, d) + RESET_HOUR * 3_600_000 - off;
  return { key, start, next: start + DAY_MS };
}

/** Weekly ranking period: starts Monday 06:00 Asia/Manila. */
export function weeklyPeriod(t: number): Period {
  const day = dailyPeriod(t);
  const off = tzOffsetMs(t);
  const localStart = new Date(day.start + off);
  const dow = (localStart.getUTCDay() + 6) % 7; // Monday = 0
  const start = day.start - dow * DAY_MS;
  const sd = new Date(start + off);
  const key = `W${sd.getUTCFullYear()}-${String(sd.getUTCMonth() + 1).padStart(2, '0')}-${String(sd.getUTCDate()).padStart(2, '0')}`;
  return { key, start, next: start + 7 * DAY_MS };
}

/** Human-readable Manila wall-clock time, for logs and tests. */
export function manilaString(t: number): string {
  const off = tzOffsetMs(t);
  const d = new Date(t + off);
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} Asia/Manila`;
}

/** Epoch ms for a Manila wall-clock time, e.g. manilaTime(2026, 11, 28, 5, 58). Month is 1-based. */
export function manilaTime(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  return guess - tzOffsetMs(guess);
}

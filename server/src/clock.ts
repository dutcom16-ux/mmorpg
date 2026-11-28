// Server clock with a developer-controlled offset (the "test clock").
// All game timers read time from here, so advancing the clock moves resets, idle timers,
// dungeon runs and wars together. The offset is stored in SQLite and survives restarts.
import { getMeta, setMeta } from './db';

let offsetMs = 0;
const listeners: Array<() => void> = [];

export const clock = {
  load() {
    offsetMs = Number(getMeta('clock_offset_ms') ?? 0) || 0;
  },
  now(): number {
    return Date.now() + offsetMs;
  },
  offset(): number {
    return offsetMs;
  },
  setOffset(ms: number) {
    offsetMs = Math.round(ms);
    setMeta('clock_offset_ms', String(offsetMs));
    for (const l of listeners) l();
  },
  advance(ms: number) {
    clock.setOffset(offsetMs + ms);
  },
  setNow(t: number) {
    clock.setOffset(t - Date.now());
  },
  onChange(fn: () => void) {
    listeners.push(fn);
  },
};

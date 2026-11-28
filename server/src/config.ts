import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function arg(name: string): string | undefined {
  const pre = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : undefined;
}

export const config = {
  port: Number(arg('port') ?? num('PORT', 3000)),
  host: arg('host') ?? process.env.HOST ?? '0.0.0.0',
  dbPath: path.resolve(ROOT, arg('db') ?? process.env.DB_PATH ?? 'data/chipfall.db'),
  clientDist: path.resolve(ROOT, process.env.CLIENT_DIST ?? 'client/dist'),
  // Developer tools (test war, test clock) are on unless explicitly disabled.
  devTools: (arg('dev') ?? process.env.DEV_TOOLS ?? '1') !== '0',
  scheduledWars: (process.env.SCHEDULED_WARS ?? '1') !== '0',
  warIntervalMin: Math.max(5, num('WAR_INTERVAL_MIN', 60)),
  warDurationMin: num('WAR_DURATION_MIN', 15),
  testWarSec: num('TEST_WAR_SEC', 120),
  warTargetPerFaction: num('WAR_TARGET_PER_FACTION', 6),
  quiet: process.env.QUIET === '1' || process.argv.includes('--quiet'),
};

export function log(...args: unknown[]) {
  if (!config.quiet) console.log(new Date().toISOString().slice(11, 19), ...args);
}

// Runtime configuration. Hosts call configure() with their environment (process.env on Node,
// the Worker's env bindings on Cloudflare).
export const config = {
  devTools: true,
  scheduledWars: true,
  warIntervalMin: 60,
  warDurationMin: 15,
  testWarSec: 120,
  warTargetPerFaction: 6,
  quiet: false,
};

export function configure(env: Record<string, unknown>) {
  const str = (k: string) => (env[k] === undefined || env[k] === null || env[k] === '' ? undefined : String(env[k]));
  const num = (k: string, d: number) => {
    const v = str(k);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  config.devTools = (str('DEV_TOOLS') ?? '1') !== '0';
  config.scheduledWars = (str('SCHEDULED_WARS') ?? '1') !== '0';
  config.warIntervalMin = Math.max(5, num('WAR_INTERVAL_MIN', 60));
  config.warDurationMin = Math.max(1, num('WAR_DURATION_MIN', 15));
  config.testWarSec = num('TEST_WAR_SEC', 120);
  config.warTargetPerFaction = num('WAR_TARGET_PER_FACTION', 6);
  config.quiet = str('QUIET') === '1';
}

export function log(...args: unknown[]) {
  if (!config.quiet) console.log(new Date().toISOString().slice(11, 19), ...args);
}

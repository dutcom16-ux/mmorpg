// The shared world of Veyra. Generated deterministically from a fixed seed, so the server and
// every client build exactly the same map without sending it over the network.
import { FACTION_IDS, type FactionId } from './content';
import { mulberry32 } from './rng';

export const MAP_W = 64;
export const MAP_H = 64;

export const Tile = { Ground: 0, Rock: 1, Chasm: 2, Road: 3, Base: 4, Crystal: 5, Structure: 6 } as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export type Biome = 0 | 1 | 2 | 3; // aurex, vessari, kreth, rift
export const BIOME_OF: Record<FactionId, Biome> = { aurex: 0, vessari: 1, kreth: 2 };

export type MonsterType = 'skitter' | 'stalker' | 'crawler' | 'wraith' | 'colossus';

export interface SpawnPoint {
  id: number;
  x: number;
  y: number;
  type: MonsterType;
  level: number;
}

export interface OreNode {
  id: number;
  x: number;
  y: number;
  template: 'o_lumen' | 'o_cobaltine';
}

export interface WorldMap {
  w: number;
  h: number;
  tiles: Uint8Array;
  biome: Uint8Array;
  variant: Uint8Array; // 0..3 per-tile shade variation
  bases: Record<FactionId, { x: number; y: number }>;
  spawnPoints: Record<FactionId, { x: number; y: number }>;
  portals: Record<FactionId, { x: number; y: number }>;
  terminals: Record<FactionId, { x: number; y: number }>;
  plaza: { x: number; y: number };
  monsters: SpawnPoint[];
  ores: OreNode[];
}

export const SAFE_RADIUS = 7.5;
export const BASE_RADIUS = 5.5;

const BASES: Record<FactionId, { x: number; y: number }> = {
  kreth: { x: 32, y: 9 },
  aurex: { x: 10, y: 52 },
  vessari: { x: 54, y: 52 },
};
const PLAZA = { x: 32, y: 37 };

function valueNoise(seed: number) {
  const rnd = mulberry32(seed);
  const G = 16;
  const grid = Array.from({ length: (G + 1) * (G + 1) }, () => rnd());
  const at = (i: number, j: number) => grid[(j % (G + 1)) * (G + 1) + (i % (G + 1))];
  return (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

let cached: WorldMap | null = null;

export function worldMap(): WorldMap {
  if (cached) return cached;
  const W = MAP_W;
  const H = MAP_H;
  const tiles = new Uint8Array(W * H);
  const biome = new Uint8Array(W * H);
  const variant = new Uint8Array(W * H);
  const rnd = mulberry32(20261128);
  const noise = valueNoise(7);
  const noise2 = valueNoise(99);
  const idx = (x: number, y: number) => y * W + x;
  const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

  // Biomes and base terrain.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best: FactionId = 'aurex';
      let bd = 1e9;
      for (const f of FACTION_IDS) {
        const d = dist(x, y, BASES[f].x, BASES[f].y);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      biome[idx(x, y)] = bd < 19 ? BIOME_OF[best] : 3;
      variant[idx(x, y)] = Math.floor(rnd() * 4);
      const n = noise(x * 0.19, y * 0.19);
      const n2 = noise2(x * 0.3, y * 0.3);
      let t: Tile = Tile.Ground;
      if (n > 0.7) t = Tile.Rock;
      else if (n2 > 0.8 && bd > 12) t = Tile.Crystal;
      else if (rnd() < 0.025) t = Tile.Rock;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) t = Tile.Rock;
      tiles[idx(x, y)] = t;
    }
  }

  // Rift chasms: two glowing cracks across the middle band.
  for (let x = 4; x < W - 4; x++) {
    for (const [cy, amp, ph] of [
      [27, 3, 0.0],
      [45, 2.5, 1.7],
    ] as const) {
      const yy = cy + Math.sin(x * 0.21 + ph) * amp;
      for (let y = Math.floor(yy - 0.8); y <= Math.ceil(yy + 0.8); y++) {
        if (y > 0 && y < H - 1 && Math.abs(y - yy) < 0.9) tiles[idx(x, y)] = Tile.Chasm;
      }
    }
  }

  const paint = (cx: number, cy: number, r: number, t: Tile) => {
    for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(H - 2, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(W - 2, Math.ceil(cx + r)); x++) {
        if (dist(x, y, cx, cy) <= r) tiles[idx(x, y)] = t;
      }
    }
  };
  const road = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const n = Math.ceil(dist(a.x, a.y, b.x, b.y) * 2);
    for (let i = 0; i <= n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n;
      const y = a.y + ((b.y - a.y) * i) / n;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const tx = Math.round(x + ox * 0.6);
          const ty = Math.round(y + oy * 0.6);
          if (tx > 0 && ty > 0 && tx < W - 1 && ty < H - 1 && tiles[idx(tx, ty)] !== Tile.Base) tiles[idx(tx, ty)] = Tile.Road;
        }
      }
    }
  };

  for (const f of FACTION_IDS) paint(BASES[f].x, BASES[f].y, SAFE_RADIUS, Tile.Ground);
  paint(PLAZA.x, PLAZA.y, 4.5, Tile.Ground);
  road(BASES.aurex, BASES.vessari);
  road(BASES.aurex, BASES.kreth);
  road(BASES.vessari, BASES.kreth);
  for (const f of FACTION_IDS) road(BASES[f], PLAZA);
  for (const f of FACTION_IDS) paint(BASES[f].x, BASES[f].y, BASE_RADIUS, Tile.Base);
  paint(PLAZA.x, PLAZA.y, 2.5, Tile.Road);

  // Base structures: the command chip at the centre; a dungeon gate and a market terminal.
  const portals = {} as WorldMap['portals'];
  const terminals = {} as WorldMap['terminals'];
  const spawnPoints = {} as WorldMap['spawnPoints'];
  for (const f of FACTION_IDS) {
    const b = BASES[f];
    tiles[idx(b.x, b.y)] = Tile.Structure;
    const toPlaza = Math.atan2(PLAZA.y - b.y, PLAZA.x - b.x);
    const p = { x: Math.round(b.x + Math.cos(toPlaza + 1.6) * 3.5), y: Math.round(b.y + Math.sin(toPlaza + 1.6) * 3.5) };
    const t = { x: Math.round(b.x + Math.cos(toPlaza - 1.6) * 3.5), y: Math.round(b.y + Math.sin(toPlaza - 1.6) * 3.5) };
    tiles[idx(p.x, p.y)] = Tile.Structure;
    tiles[idx(t.x, t.y)] = Tile.Structure;
    portals[f] = p;
    terminals[f] = t;
    spawnPoints[f] = { x: b.x + Math.cos(toPlaza) * 2.6, y: b.y + Math.sin(toPlaza) * 2.6 };
  }

  // Reachability from the bases.
  const reach = new Uint8Array(W * H);
  const q: number[] = [];
  for (const f of FACTION_IDS) {
    const s = idx(Math.round(spawnPoints[f].x), Math.round(spawnPoints[f].y));
    reach[s] = 1;
    q.push(s);
  }
  while (q.length) {
    const c = q.pop()!;
    const cx = c % W;
    const cy = (c - cx) / W;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = idx(nx, ny);
      if (reach[n] || !walkableTile(tiles[n])) continue;
      reach[n] = 1;
      q.push(n);
    }
  }
  // Unreachable pockets become rock, so nothing spawns or stands where nobody can go.
  for (let i = 0; i < W * H; i++) if (!reach[i] && walkableTile(tiles[i])) tiles[i] = Tile.Rock;

  const nearestBase = (x: number, y: number) => Math.min(...FACTION_IDS.map((f) => dist(x, y, BASES[f].x, BASES[f].y)));
  const free = (x: number, y: number) => tiles[idx(x, y)] === Tile.Ground && reach[idx(x, y)];

  // Monster spawns, banded by distance from the bases.
  const monsters: SpawnPoint[] = [];
  const taken: Array<{ x: number; y: number }> = [];
  const farEnough = (x: number, y: number, d: number) => taken.every((t) => dist(t.x, t.y, x, y) >= d);
  monsters.push({ id: 0, x: PLAZA.x + 0.5, y: PLAZA.y + 0.5, type: 'colossus', level: 14 });
  taken.push(PLAZA);
  for (let tries = 0; tries < 4000 && monsters.length < 46; tries++) {
    const x = 2 + Math.floor(rnd() * (W - 4));
    const y = 2 + Math.floor(rnd() * (H - 4));
    if (!free(x, y)) continue;
    const db = nearestBase(x, y);
    if (db < SAFE_RADIUS + 3) continue;
    if (!farEnough(x, y, 3.2)) continue;
    const dp = dist(x, y, PLAZA.x, PLAZA.y);
    let type: MonsterType;
    let level: number;
    if (dp < 9) {
      type = 'wraith';
      level = 9 + Math.floor(rnd() * 4);
    } else if (db < 16) {
      type = 'skitter';
      level = 1 + Math.floor(((db - 10) / 6) * 3);
    } else if (db < 23) {
      type = 'stalker';
      level = 3 + Math.floor(((db - 16) / 7) * 4);
    } else {
      type = 'crawler';
      level = 6 + Math.floor(rnd() * 4);
    }
    level = Math.max(1, level);
    taken.push({ x, y });
    monsters.push({ id: monsters.length, x: x + 0.5, y: y + 0.5, type, level });
  }

  // Ore crystals you can mine by hand.
  const ores: OreNode[] = [];
  for (let tries = 0; tries < 3000 && ores.length < 22; tries++) {
    const x = 2 + Math.floor(rnd() * (W - 4));
    const y = 2 + Math.floor(rnd() * (H - 4));
    if (!free(x, y)) continue;
    const db = nearestBase(x, y);
    if (db < SAFE_RADIUS + 1.5) continue;
    if (!farEnough(x, y, 2.5)) continue;
    taken.push({ x, y });
    tiles[idx(x, y)] = Tile.Structure;
    ores.push({ id: ores.length, x: x + 0.5, y: y + 0.5, template: db > 20 || rnd() < 0.25 ? 'o_cobaltine' : 'o_lumen' });
  }

  cached = {
    w: W,
    h: H,
    tiles,
    biome,
    variant,
    bases: BASES,
    spawnPoints,
    portals,
    terminals,
    plaza: PLAZA,
    monsters,
    ores,
  };
  return cached;
}

export function walkableTile(t: number) {
  return t === Tile.Ground || t === Tile.Road || t === Tile.Base;
}

export function walkable(m: WorldMap, x: number, y: number) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return false;
  return walkableTile(m.tiles[ty * m.w + tx]);
}

export function inSafeZone(m: WorldMap, x: number, y: number): FactionId | null {
  for (const f of FACTION_IDS) if (Math.hypot(x - m.bases[f].x - 0.5, y - m.bases[f].y - 0.5) <= SAFE_RADIUS) return f;
  return null;
}

/** A* over the tile grid (8 directions, no corner cutting). Returns tile-centre waypoints. */
export function findPath(m: WorldMap, sx: number, sy: number, tx: number, ty: number, maxNodes = 4000): Array<[number, number]> | null {
  const W = m.w;
  const start = Math.floor(sy) * W + Math.floor(sx);
  let goalX = Math.floor(tx);
  let goalY = Math.floor(ty);
  if (!walkable(m, goalX, goalY)) {
    // Walk to the nearest walkable tile next to the target (e.g. an ore crystal or a monster on a rock edge).
    let best: [number, number] | null = null;
    let bd = 1e9;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = goalX + dx;
        const ny = goalY + dy;
        if (!walkable(m, nx, ny)) continue;
        const d = Math.hypot(nx + 0.5 - tx, ny + 0.5 - ty) + Math.hypot(nx - sx, ny - sy) * 0.01;
        if (d < bd) {
          bd = d;
          best = [nx, ny];
        }
      }
    }
    if (!best) return null;
    [goalX, goalY] = best;
  }
  const goal = goalY * W + goalX;
  if (start === goal) return [[tx, ty]];
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const open: Array<[number, number]> = [[start, 0]];
  const h = (i: number) => {
    const x = i % W;
    const y = (i - x) / W;
    const dx = Math.abs(x - goalX);
    const dy = Math.abs(y - goalY);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const closed = new Set<number>();
  let expanded = 0;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][1] < open[bi][1]) bi = i;
    const [cur] = open.splice(bi, 1)[0];
    if (cur === goal) break;
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (++expanded > maxNodes) return null;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walkable(m, nx, ny)) continue;
        if (dx && dy && (!walkable(m, cx + dx, cy) || !walkable(m, cx, cy + dy))) continue;
        const n = ny * W + nx;
        const cost = (g.get(cur) ?? 0) + (dx && dy ? 1.414 : 1);
        if (cost < (g.get(n) ?? Infinity)) {
          g.set(n, cost);
          came.set(n, cur);
          open.push([n, cost + h(n)]);
        }
      }
    }
  }
  if (!came.has(goal)) return null;
  const path: Array<[number, number]> = [];
  for (let c = goal; c !== start; c = came.get(c)!) {
    const x = c % W;
    path.push([x + 0.5, (c - x) / W + 0.5]);
  }
  path.reverse();
  // Finish on the exact tap point when it is walkable.
  if (walkable(m, tx, ty) && path.length) path[path.length - 1] = [tx, ty];
  return smooth(m, sx, sy, path);
}

/** Drops waypoints that can be skipped with a clear straight line. */
function smooth(m: WorldMap, sx: number, sy: number, path: Array<[number, number]>) {
  const out: Array<[number, number]> = [];
  let ax = sx;
  let ay = sy;
  let i = 0;
  while (i < path.length) {
    let j = path.length - 1;
    while (j > i && !lineClear(m, ax, ay, path[j][0], path[j][1])) j--;
    out.push(path[j]);
    [ax, ay] = path[j];
    i = j + 1;
  }
  return out;
}

export function lineClear(m: WorldMap, ax: number, ay: number, bx: number, by: number) {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.ceil(d * 4);
  for (let i = 1; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const y = ay + ((by - ay) * i) / n;
    if (!walkable(m, x, y)) return false;
    // keep a little clearance from blocked tiles so paths do not clip rock corners
    if (!walkable(m, x + 0.25, y) || !walkable(m, x - 0.25, y) || !walkable(m, x, y + 0.25) || !walkable(m, x, y - 0.25)) return false;
  }
  return true;
}

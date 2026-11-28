// Isometric canvas renderer for the shared world. Ground is pre-drawn into cached chunk canvases;
// raised objects and moving entities are depth-sorted and drawn every frame. Entity motion is
// smoothed between the server's 5 Hz snapshots using a velocity estimate.
import { FACTIONS, type FactionId, type RoleId } from '../../../shared/content';
import { MAP_H, MAP_W, Tile, worldMap, type WorldMap } from '../../../shared/map';
import type { WorldEnt, WorldFx, WorldSnap } from '../../../shared/protocol';

const HW = 32; // half tile width in px at zoom 1
const HH = 16; // half tile height
const CHUNK = 16;

export type Hit =
  | { kind: 'ent'; ent: WorldEnt }
  | { kind: 'ore'; id: number }
  | { kind: 'portal'; f: FactionId }
  | { kind: 'terminal'; f: FactionId }
  | { kind: 'base'; f: FactionId }
  | { kind: 'ground'; x: number; y: number };

interface Disp {
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  at: number;
  face: number;
  seen: number;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
  big?: boolean;
}
interface Ring {
  x: number;
  y: number;
  color: string;
  born: number;
  dur: number;
  r: number;
}
interface Tracer {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  color: string;
  born: number;
}

const BIOME_GROUND = ['#6b5832', '#4a3e6c', '#2f4c59', '#2b3a40'];
const BIOME_ROCK = ['#7a6a4c', '#5d5480', '#4d6874', '#4b555c'];
const MONSTER_COLOR: Record<string, string> = {
  skitter: '#d0773a',
  stalker: '#9fe3f0',
  crawler: '#7d8796',
  wraith: '#e58cff',
  colossus: '#c9a46a',
};

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}

export class WorldRenderer {
  readonly m: WorldMap = worldMap();
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  w = 0;
  h = 0;
  zoom = 0.85;
  cam = { x: 32, y: 32, init: false };
  chunks = new Map<string, HTMLCanvasElement>();
  disp = new Map<string, Disp>();
  floaters: Floater[] = [];
  rings: Ring[] = [];
  tracers: Tracer[] = [];
  snap: WorldSnap | null = null;
  prevSnap: WorldSnap | null = null;
  snapAt = 0;
  meId: string | null = null;
  myFaction: FactionId = 'aurex';
  myCharId = 0;
  selected: string | null = null;
  moveMarker: { x: number; y: number; born: number } | null = null;
  chips: Record<FactionId, { pct: number; destroyed: boolean }> | null = null;
  private hitList: Array<{ sx: number; sy: number; r: number; hit: Hit; pri: number }> = [];
  private raf = 0;
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  start() {
    const loop = (t: number) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  setSnap(s: WorldSnap) {
    const t = performance.now();
    this.prevSnap = this.snap;
    this.snap = s;
    this.snapAt = t;
    if (s.me) this.meId = s.me.id;
    const ents = [...s.ents];
    if (s.me) ents.push({ k: 'p', id: s.me.id, x: s.me.x, y: s.me.y, hp: s.me.hp, mhp: s.me.mhp } as WorldEnt);
    for (const e of ents) {
      const d = this.disp.get(e.id);
      if (!d) {
        this.disp.set(e.id, { x: e.x, y: e.y, tx: e.x, ty: e.y, vx: 0, vy: 0, at: t, face: 1, seen: t });
        continue;
      }
      const dt = Math.max(0.05, (t - d.at) / 1000);
      const jump = Math.hypot(e.x - d.tx, e.y - d.ty);
      if (jump > 6) {
        // teleport / respawn: snap immediately
        d.x = e.x;
        d.y = e.y;
        d.vx = d.vy = 0;
      } else {
        d.vx = (e.x - d.tx) / dt;
        d.vy = (e.y - d.ty) / dt;
        if (Math.abs(d.vx - d.vy) > 0.2) d.face = d.vx - d.vy > 0 ? 1 : -1;
      }
      d.tx = e.x;
      d.ty = e.y;
      d.at = t;
      d.seen = t;
    }
    for (const f of s.fx) this.addFx(f);
  }

  private posOf(id: string) {
    const d = this.disp.get(id);
    return d ? { x: d.x, y: d.y } : null;
  }

  private addFx(f: WorldFx) {
    const now = performance.now();
    if (f.a === 'hit') {
      const p = this.posOf(f.t);
      if (!p) return;
      const onMe = f.t === this.meId;
      this.floaters.push({ x: p.x, y: p.y, text: String(f.d), color: onMe ? '#ff7a6b' : f.crit ? '#ffb347' : '#ffffff', born: now, big: f.crit });
      const s = this.posOf(f.s);
      if (s && Math.hypot(s.x - p.x, s.y - p.y) > 2) this.tracers.push({ ax: s.x, ay: s.y, bx: p.x, by: p.y, color: f.s.startsWith('m:') ? '#e58cff' : '#fff3b0', born: now });
    } else if (f.a === 'heal') {
      const p = this.posOf(f.t);
      if (p) this.floaters.push({ x: p.x, y: p.y, text: `+${f.d}`, color: '#6fd3a6', born: now });
    } else if (f.a === 'die') {
      const p = this.posOf(f.t);
      if (p) this.rings.push({ x: p.x, y: p.y, color: '#ffffff', born: now, dur: 500, r: 1 });
    } else if (f.a === 'ab') {
      const p = this.posOf(f.s);
      const color = f.kind === 'bulwark' ? '#6ab8ff' : f.kind === 'nanite' ? '#6fd3a6' : '#ff9a3c';
      if (p) this.rings.push({ x: p.x, y: p.y, color, born: now, dur: 700, r: f.kind === 'overcharge' ? 1.2 : 4 });
    } else if (f.a === 'mined') {
      const o = this.m.ores[f.ore];
      if (o) this.rings.push({ x: o.x, y: o.y, color: '#8ff0e0', born: now, dur: 600, r: 1.5 });
    }
  }

  // ------------------------------------------------------------ transforms

  toScreen(wx: number, wy: number) {
    const z = this.zoom;
    return {
      x: this.w / 2 + (wx - wy - (this.cam.x - this.cam.y)) * HW * z,
      y: this.h / 2 + (wx + wy - (this.cam.x + this.cam.y)) * HH * z,
    };
  }
  toWorld(sx: number, sy: number) {
    const z = this.zoom;
    const u = (sx - this.w / 2) / (HW * z) + (this.cam.x - this.cam.y);
    const v = (sy - this.h / 2) / (HH * z) + (this.cam.x + this.cam.y);
    return { x: (u + v) / 2, y: (v - u) / 2 };
  }

  // ------------------------------------------------------------------ chunks

  private chunk(cx: number, cy: number) {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const scale = Math.min(2, this.dpr);
    c.width = (CHUNK * 2 * HW + 4) * scale;
    c.height = (CHUNK * 2 * HH + 4) * scale;
    const g = c.getContext('2d')!;
    g.scale(scale, scale);
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const ox = (x0 - y0 - CHUNK) * HW;
    const oy = (x0 + y0) * HH;
    const m = this.m;
    for (let y = y0; y < Math.min(m.h, y0 + CHUNK); y++) {
      for (let x = x0; x < Math.min(m.w, x0 + CHUNK); x++) {
        const i = y * m.w + x;
        const t = m.tiles[i];
        const b = m.biome[i];
        const sx = (x - y) * HW - ox + 2;
        const sy = (x + y) * HH - oy + 2;
        let col = BIOME_GROUND[b];
        const v = 0.92 + m.variant[i] * 0.04;
        if (t === Tile.Road) col = shade('#7d776a', 0.92 + m.variant[i] * 0.03);
        else if (t === Tile.Base) col = '#39425a';
        else if (t === Tile.Chasm) col = '#0a0e1b';
        else col = shade(col, v);
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + HW, sy + HH);
        g.lineTo(sx, sy + 2 * HH);
        g.lineTo(sx - HW, sy + HH);
        g.closePath();
        g.fillStyle = col;
        g.fill();
        g.strokeStyle = t === Tile.Base ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.14)';
        g.lineWidth = 1;
        g.stroke();
        if (t === Tile.Chasm) {
          g.strokeStyle = 'rgba(124,245,230,0.35)';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(sx - HW * 0.6, sy + HH);
          g.lineTo(sx, sy + HH * 0.6);
          g.lineTo(sx + HW * 0.6, sy + HH * 1.2);
          g.stroke();
        } else if (b === 3 && t === Tile.Ground && hash(x, y) < 0.08) {
          g.strokeStyle = 'rgba(167,123,255,0.35)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(sx - 10, sy + HH + 3);
          g.lineTo(sx + 2, sy + HH - 2);
          g.lineTo(sx + 12, sy + HH + 4);
          g.stroke();
        } else if (t === Tile.Ground && hash(x + 7, y) < 0.12) {
          g.fillStyle = 'rgba(255,255,255,0.06)';
          g.beginPath();
          g.ellipse(sx + (hash(x, y + 3) - 0.5) * 30, sy + HH, 4, 2, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // Faction floor sigils around each base.
    for (const f of Object.keys(m.bases) as FactionId[]) {
      const bse = m.bases[f];
      if (bse.x < x0 - 6 || bse.x > x0 + CHUNK + 6 || bse.y < y0 - 6 || bse.y > y0 + CHUNK + 6) continue;
      g.save();
      g.strokeStyle = FACTIONS[f].color;
      g.globalAlpha = 0.35;
      g.lineWidth = 2;
      for (const r of [4.6, 3.2]) {
        g.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const wx = bse.x + 0.5 + Math.cos(a) * r;
          const wy = bse.y + 0.5 + Math.sin(a) * r;
          const px = (wx - wy) * HW - ox + 2;
          const py = (wx + wy) * HH - oy + 2;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke();
      }
      g.restore();
    }
    this.chunks.set(key, c);
    if (this.chunks.size > 12) this.chunks.delete(this.chunks.keys().next().value!);
    return c;
  }

  // ------------------------------------------------------------------ frame

  frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.ctx;
    if (!this.w) this.resize();

    // Smooth entity motion: predict from velocity, then ease toward it.
    for (const [id, d] of this.disp) {
      if (now - d.seen > 2500) {
        this.disp.delete(id);
        continue;
      }
      const age = Math.min(0.22, (now - d.at) / 1000);
      const px = d.tx + d.vx * age * 0.9;
      const py = d.ty + d.vy * age * 0.9;
      const k = 1 - Math.exp(-dt * 14);
      d.x += (px - d.x) * k;
      d.y += (py - d.y) * k;
    }
    const me = this.meId ? this.disp.get(this.meId) : null;
    if (me) {
      if (!this.cam.init) {
        this.cam.x = me.x;
        this.cam.y = me.y;
        this.cam.init = true;
      }
      const k = 1 - Math.exp(-dt * 6);
      this.cam.x += (me.x - this.cam.x) * k;
      this.cam.y += (me.y - this.cam.y) * k;
    }

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#0b1020';
    g.fillRect(0, 0, this.w, this.h);

    // Visible tile range.
    const corners = [this.toWorld(0, 0), this.toWorld(this.w, 0), this.toWorld(0, this.h), this.toWorld(this.w, this.h)];
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - 2);
    const maxX = Math.min(MAP_W - 1, Math.ceil(Math.max(...corners.map((c) => c.x))) + 2);
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - 2);
    const maxY = Math.min(MAP_H - 1, Math.ceil(Math.max(...corners.map((c) => c.y))) + 2);

    // Ground chunks.
    const z = this.zoom;
    for (let cy = Math.floor(minY / CHUNK); cy <= Math.floor(maxY / CHUNK); cy++) {
      for (let cx = Math.floor(minX / CHUNK); cx <= Math.floor(maxX / CHUNK); cx++) {
        const c = this.chunk(cx, cy);
        const x0 = cx * CHUNK;
        const y0 = cy * CHUNK;
        const p = this.toScreen(x0 - CHUNK, y0);
        // toScreen(x0 - CHUNK, y0) gives the left edge; chunk origin x = (x0 - y0 - CHUNK) * HW
        const sx = this.w / 2 + (x0 - y0 - CHUNK - (this.cam.x - this.cam.y)) * HW * z - 2 * z;
        const sy = this.h / 2 + (x0 + y0 - (this.cam.x + this.cam.y)) * HH * z - 2 * z;
        void p;
        g.drawImage(c, sx, sy, (CHUNK * 2 * HW + 4) * z, (CHUNK * 2 * HH + 4) * z);
      }
    }

    // Move marker.
    if (this.moveMarker && now - this.moveMarker.born < 900) {
      const p = this.toScreen(this.moveMarker.x, this.moveMarker.y);
      const a = 1 - (now - this.moveMarker.born) / 900;
      g.strokeStyle = `rgba(255,255,255,${a})`;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(p.x, p.y, 12 * z * (1.4 - a * 0.4), 6 * z * (1.4 - a * 0.4), 0, 0, Math.PI * 2);
      g.stroke();
    }

    // Depth-sorted drawables.
    this.hitList = [];
    const draws: Array<{ d: number; fn: () => void }> = [];
    const m = this.m;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = m.tiles[y * m.w + x];
        if (t === Tile.Rock || t === Tile.Crystal) draws.push({ d: x + y + 1, fn: () => this.drawBlock(x, y, t) });
      }
    }
    for (const f of Object.keys(m.bases) as FactionId[]) {
      const b = m.bases[f];
      draws.push({ d: b.x + b.y + 1, fn: () => this.drawChip(f) });
      const p = m.portals[f];
      draws.push({ d: p.x + p.y + 1, fn: () => this.drawPortal(f) });
      const tm = m.terminals[f];
      draws.push({ d: tm.x + tm.y + 1, fn: () => this.drawTerminal(f) });
    }
    const depleted = new Set(this.snap?.ores ?? []);
    for (const o of m.ores) {
      if (o.x < minX || o.x > maxX + 1 || o.y < minY || o.y > maxY + 1) continue;
      draws.push({ d: o.x + o.y, fn: () => this.drawOre(o.id, depleted.has(o.id)) });
    }
    const ents = this.snap?.ents ?? [];
    for (const e of ents) {
      const d = this.disp.get(e.id);
      if (!d) continue;
      draws.push({ d: d.x + d.y, fn: () => this.drawEnt(e, d, now) });
    }
    if (this.snap?.me && me) {
      const meEnt: WorldEnt = { k: this.snap.me.inWar ? 'w' : 'p', id: this.snap.me.id, x: me.x, y: me.y, hp: this.snap.me.hp, mhp: this.snap.me.mhp, dead: this.snap.me.dead, f: this.myFaction, r: this.myRole, n: this.myName, l: this.myLevel };
      draws.push({ d: me.x + me.y, fn: () => this.drawEnt(meEnt, me, now, true) });
    }
    draws.sort((a, b) => a.d - b.d);
    for (const dr of draws) dr.fn();

    // Effects.
    this.tracers = this.tracers.filter((t) => now - t.born < 180);
    for (const t of this.tracers) {
      const a = this.toScreen(t.ax, t.ay);
      const b = this.toScreen(t.bx, t.by);
      g.strokeStyle = t.color;
      g.globalAlpha = 1 - (now - t.born) / 180;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(a.x, a.y - 22 * z);
      g.lineTo(b.x, b.y - 16 * z);
      g.stroke();
      g.globalAlpha = 1;
    }
    this.rings = this.rings.filter((r) => now - r.born < r.dur);
    for (const r of this.rings) {
      const p = this.toScreen(r.x, r.y);
      const k = (now - r.born) / r.dur;
      g.strokeStyle = r.color;
      g.globalAlpha = 1 - k;
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(p.x, p.y, r.r * HW * z * (0.4 + k * 0.6), r.r * HH * z * (0.4 + k * 0.6), 0, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    this.floaters = this.floaters.filter((f) => now - f.born < 900);
    g.textAlign = 'center';
    for (const f of this.floaters) {
      const k = (now - f.born) / 900;
      const p = this.toScreen(f.x, f.y);
      g.font = `700 ${f.big ? 18 : 14}px system-ui, sans-serif`;
      g.globalAlpha = 1 - k * k;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(f.text, p.x, p.y - (38 + k * 28) * z);
      g.fillStyle = f.color;
      g.fillText(f.text, p.x, p.y - (38 + k * 28) * z);
      g.globalAlpha = 1;
    }
  }

  myRole: RoleId = 'assault';
  myName = '';
  myLevel = 1;

  // ---------------------------------------------------------------- objects

  private drawBlock(x: number, y: number, t: number) {
    const g = this.ctx;
    const z = this.zoom;
    const b = this.m.biome[y * this.m.w + x];
    const p = this.toScreen(x, y);
    if (t === Tile.Rock) {
      const h = (14 + hash(x, y) * 16) * z;
      const top = shade(BIOME_ROCK[b], 1.05 + hash(y, x) * 0.1);
      const hw = HW * z;
      const hh = HH * z;
      g.fillStyle = shade(BIOME_ROCK[b], 0.62);
      g.beginPath();
      g.moveTo(p.x - hw, p.y + hh - h);
      g.lineTo(p.x, p.y + 2 * hh - h);
      g.lineTo(p.x, p.y + 2 * hh);
      g.lineTo(p.x - hw, p.y + hh);
      g.fill();
      g.fillStyle = shade(BIOME_ROCK[b], 0.8);
      g.beginPath();
      g.moveTo(p.x + hw, p.y + hh - h);
      g.lineTo(p.x, p.y + 2 * hh - h);
      g.lineTo(p.x, p.y + 2 * hh);
      g.lineTo(p.x + hw, p.y + hh);
      g.fill();
      g.fillStyle = top;
      g.beginPath();
      g.moveTo(p.x, p.y - h);
      g.lineTo(p.x + hw, p.y + hh - h);
      g.lineTo(p.x, p.y + 2 * hh - h);
      g.lineTo(p.x - hw, p.y + hh - h);
      g.fill();
    } else {
      // crystal cluster
      const cx = p.x;
      const cy = p.y + HH * z;
      const col = b === 0 ? '#ffd98a' : b === 1 ? '#c9a8ff' : b === 2 ? '#9feaf5' : '#8ff0e0';
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * 9 * z;
        const hgt = (22 + hash(x + i, y) * 18) * z;
        g.fillStyle = shade(col.length === 7 ? col : '#8ff0e0', 0.55 + i * 0.2);
        g.beginPath();
        g.moveTo(cx + ox - 5 * z, cy);
        g.lineTo(cx + ox, cy - hgt);
        g.lineTo(cx + ox + 5 * z, cy);
        g.closePath();
        g.fill();
      }
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.beginPath();
      g.ellipse(cx, cy, 14 * z, 6 * z, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawChip(f: FactionId) {
    const g = this.ctx;
    const z = this.zoom;
    const b = this.m.bases[f];
    const p = this.toScreen(b.x + 0.5, b.y + 0.5);
    const col = FACTIONS[f].color;
    const chip = this.chips?.[f];
    const destroyed = chip?.destroyed;
    // pedestal
    g.fillStyle = '#1d2536';
    g.beginPath();
    g.ellipse(p.x, p.y, 30 * z, 15 * z, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b3550';
    g.fillRect(p.x - 18 * z, p.y - 16 * z, 36 * z, 16 * z);
    g.beginPath();
    g.ellipse(p.x, p.y - 16 * z, 18 * z, 9 * z, 0, 0, Math.PI * 2);
    g.fillStyle = '#3a4668';
    g.fill();
    // floating crystal
    const bob = Math.sin(performance.now() / 600) * 3 * z;
    const cy = p.y - 52 * z + bob;
    g.save();
    if (!destroyed) {
      g.shadowColor = col;
      g.shadowBlur = 18 * z;
    }
    g.fillStyle = destroyed ? '#444b5c' : col;
    g.beginPath();
    g.moveTo(p.x, cy - 26 * z);
    g.lineTo(p.x + 14 * z, cy - 6 * z);
    g.lineTo(p.x + 10 * z, cy + 16 * z);
    g.lineTo(p.x, cy + 26 * z);
    g.lineTo(p.x - 10 * z, cy + 16 * z);
    g.lineTo(p.x - 14 * z, cy - 6 * z);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.moveTo(p.x, cy - 26 * z);
    g.lineTo(p.x + 5 * z, cy - 4 * z);
    g.lineTo(p.x, cy + 22 * z);
    g.closePath();
    g.fill();
    if (chip) {
      this.bar(p.x, cy - 36 * z, 60, 6, chip.pct, col);
      this.label(`${FACTIONS[f].chipName}${destroyed ? ' — destroyed' : ''}`, p.x, cy - 44 * z, '#ffffff', 11);
    } else {
      this.label(FACTIONS[f].baseName, p.x, cy - 36 * z, FACTIONS[f].accent, 11);
    }
    this.hitList.push({ sx: p.x, sy: p.y - 30 * z, r: 40 * z, hit: { kind: 'base', f }, pri: 1 });
  }

  private drawPortal(f: FactionId) {
    const g = this.ctx;
    const z = this.zoom;
    const pt = this.m.portals[f];
    const p = this.toScreen(pt.x + 0.5, pt.y + 0.5);
    const col = FACTIONS[f].accent;
    g.fillStyle = '#1b2236';
    g.beginPath();
    g.ellipse(p.x, p.y, 22 * z, 11 * z, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.strokeStyle = col;
    g.lineWidth = 5 * z;
    g.shadowColor = col;
    g.shadowBlur = 12 * z;
    g.beginPath();
    g.ellipse(p.x, p.y - 26 * z, 14 * z, 24 * z, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    const t = performance.now() / 400;
    g.fillStyle = 'rgba(167,123,255,0.45)';
    g.beginPath();
    g.ellipse(p.x, p.y - 26 * z, 10 * z * (0.8 + 0.2 * Math.sin(t)), 20 * z, 0, 0, Math.PI * 2);
    g.fill();
    if (f === this.myFaction) this.label('Dungeons', p.x, p.y - 56 * z, '#e6ecf6', 11);
    this.hitList.push({ sx: p.x, sy: p.y - 24 * z, r: 30 * z, hit: { kind: 'portal', f }, pri: 2 });
  }

  private drawTerminal(f: FactionId) {
    const g = this.ctx;
    const z = this.zoom;
    const tm = this.m.terminals[f];
    const p = this.toScreen(tm.x + 0.5, tm.y + 0.5);
    g.fillStyle = '#28324d';
    g.fillRect(p.x - 12 * z, p.y - 30 * z, 24 * z, 30 * z);
    g.fillStyle = '#3a4668';
    g.fillRect(p.x - 12 * z, p.y - 34 * z, 24 * z, 6 * z);
    g.fillStyle = '#f2c14e';
    g.fillRect(p.x - 8 * z, p.y - 26 * z, 16 * z, 12 * z);
    if (f === this.myFaction) this.label('Market', p.x, p.y - 42 * z, '#f2c14e', 11);
    this.hitList.push({ sx: p.x, sy: p.y - 18 * z, r: 24 * z, hit: { kind: 'terminal', f }, pri: 2 });
  }

  private drawOre(id: number, depleted: boolean) {
    const g = this.ctx;
    const z = this.zoom;
    const o = this.m.ores[id];
    const p = this.toScreen(o.x, o.y);
    const col = o.template === 'o_lumen' ? '#8ff0e0' : '#6e9bff';
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(p.x, p.y, 16 * z, 7 * z, 0, 0, Math.PI * 2);
    g.fill();
    const hgt = depleted ? 6 : 26;
    g.save();
    if (!depleted) {
      g.shadowColor = col;
      g.shadowBlur = 10 * z;
    }
    for (let i = 0; i < 4; i++) {
      const ox = (i - 1.5) * 7 * z;
      const hh = (hgt - Math.abs(i - 1.5) * 5) * z;
      g.fillStyle = depleted ? '#3d4a5c' : shade(col, 0.6 + i * 0.13);
      g.beginPath();
      g.moveTo(ox + p.x - 4 * z, p.y);
      g.lineTo(ox + p.x, p.y - hh);
      g.lineTo(ox + p.x + 4 * z, p.y);
      g.closePath();
      g.fill();
    }
    g.restore();
    this.hitList.push({ sx: p.x, sy: p.y - 12 * z, r: 22 * z, hit: { kind: 'ore', id }, pri: 2 });
  }

  // --------------------------------------------------------------- entities

  private drawEnt(e: WorldEnt, d: Disp, now: number, isMe = false) {
    const g = this.ctx;
    const z = this.zoom;
    const p = this.toScreen(d.x, d.y);
    const dead = !!e.dead;
    g.globalAlpha = dead ? 0.35 : 1;
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(p.x, p.y, (e.ty === 'colossus' ? 24 : 12) * z, (e.ty === 'colossus' ? 11 : 6) * z, 0, 0, Math.PI * 2);
    g.fill();
    if (this.selected === e.id) {
      g.strokeStyle = e.k === 'm' ? '#ff7a6b' : '#f2c14e';
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.ellipse(p.x, p.y, 17 * z, 8 * z, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    const walking = Math.hypot(d.vx, d.vy) > 0.3;
    const step = walking ? Math.sin(now / 90) : 0;
    let top = 40;
    if (e.k === 'm') top = this.drawMonster(e, p.x, p.y, now, step);
    else this.drawPilot(e, p.x, p.y, d.face, step, isMe);
    g.globalAlpha = 1;
    // overhead UI
    const showBar = e.k !== 'm' || e.hp < e.mhp || this.selected === e.id;
    if (showBar && !dead) {
      const col = e.k === 'm' ? '#ff7a6b' : e.f === this.myFaction ? '#6fd3a6' : '#ff9a6b';
      this.bar(p.x, p.y - (top + 6) * z, 30, 4, e.mhp ? e.hp / e.mhp : 0, col);
    }
    const quietNpc = e.k === 'w' && !e.charId && !isMe;
    if ((e.k !== 'm' && !quietNpc) || this.selected === e.id) {
      const name = e.k === 'm' ? `${e.n} Lv ${e.l}` : e.n ?? '';
      const col = isMe ? '#ffffff' : e.party ? '#7cf59a' : e.k === 'b' || (e.k === 'w' && !e.charId) ? '#aab4c8' : e.f ? FACTIONS[e.f].accent : '#ffffff';
      this.label(name, p.x, p.y - (top + 12) * z, col, 11);
    }
    if (!isMe) this.hitList.push({ sx: p.x, sy: p.y - 18 * z, r: (e.ty === 'colossus' ? 34 : 22) * z, hit: { kind: 'ent', ent: e }, pri: 0 });
    // mining progress over me
    if (isMe && this.snap?.me?.mining) {
      const pct = this.snap.me.mining.pct;
      g.strokeStyle = '#8ff0e0';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(p.x, p.y - 60 * z, 9 * z, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
      g.stroke();
    }
    if (isMe && this.snap?.me?.shield) {
      g.strokeStyle = 'rgba(106,184,255,0.7)';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(p.x, p.y - 18 * z, 18 * z, 24 * z, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private drawPilot(e: WorldEnt, x: number, y: number, face: number, step: number, isMe: boolean) {
    const g = this.ctx;
    const z = this.zoom;
    const f = e.f ?? 'aurex';
    const col = FACTIONS[f].color;
    const dark = FACTIONS[f].dark;
    // legs
    g.fillStyle = '#1a2030';
    g.fillRect(x - 6 * z, y - 12 * z + step * 2 * z, 4 * z, 12 * z - step * 2 * z);
    g.fillRect(x + 2 * z, y - 12 * z - step * 2 * z, 4 * z, 12 * z + step * 2 * z);
    // torso
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x - 9 * z, y - 12 * z);
    g.lineTo(x + 9 * z, y - 12 * z);
    g.lineTo(x + 7 * z, y - 28 * z);
    g.lineTo(x - 7 * z, y - 28 * z);
    g.closePath();
    g.fill();
    g.fillStyle = dark;
    g.fillRect(x - 4 * z, y - 24 * z, 8 * z, 6 * z);
    // head by role
    const r = e.r ?? 'assault';
    g.fillStyle = shade(col, 1.15);
    if (r === 'guardian') {
      g.fillRect(x - 8 * z, y - 38 * z, 16 * z, 10 * z);
      g.fillStyle = '#0e1424';
      g.fillRect(x - 6 * z, y - 35 * z, 12 * z, 3 * z);
      // shield
      g.fillStyle = shade(col, 0.75);
      g.fillRect(x + face * 9 * z - 3 * z, y - 26 * z, 6 * z, 14 * z);
    } else if (r === 'engineer') {
      g.beginPath();
      g.arc(x, y - 33 * z, 6.5 * z, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0e1424';
      g.beginPath();
      g.arc(x + face * 1.5 * z, y - 33 * z, 3 * z, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = shade(col, 1.2);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x + 4 * z, y - 38 * z);
      g.lineTo(x + 7 * z, y - 45 * z);
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(x - 6 * z, y - 28 * z);
      g.lineTo(x + 6 * z, y - 28 * z);
      g.lineTo(x + 5 * z, y - 37 * z);
      g.lineTo(x, y - 43 * z);
      g.lineTo(x - 5 * z, y - 37 * z);
      g.closePath();
      g.fill();
      g.fillStyle = '#0e1424';
      g.fillRect(x - 4 * z, y - 34 * z, 8 * z, 2.5 * z);
      // rifle
      g.strokeStyle = '#c9d2dc';
      g.lineWidth = 2.5 * z;
      g.beginPath();
      g.moveTo(x, y - 20 * z);
      g.lineTo(x + face * 14 * z, y - 22 * z);
      g.stroke();
    }
    if (isMe) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(x, y - 50 * z);
      g.lineTo(x - 4 * z, y - 56 * z);
      g.lineTo(x + 4 * z, y - 56 * z);
      g.closePath();
      g.fill();
    }
  }

  private drawMonster(e: WorldEnt, x: number, y: number, now: number, step: number): number {
    const g = this.ctx;
    const z = this.zoom;
    const col = MONSTER_COLOR[e.ty ?? 'skitter'];
    switch (e.ty) {
      case 'skitter': {
        g.strokeStyle = shade(col, 0.6);
        g.lineWidth = 2 * z;
        for (let i = -1; i <= 1; i++) {
          const k = Math.sin(now / 70 + i) * 2 * z;
          g.beginPath();
          g.moveTo(x + i * 5 * z, y - 7 * z);
          g.lineTo(x + i * 9 * z - 4 * z, y + k);
          g.moveTo(x + i * 5 * z, y - 7 * z);
          g.lineTo(x + i * 9 * z + 4 * z, y - k);
          g.stroke();
        }
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(x, y - 9 * z, 11 * z, 6 * z, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffe3a3';
        g.fillRect(x - 5 * z, y - 12 * z, 3 * z, 2 * z);
        g.fillRect(x + 2 * z, y - 12 * z, 3 * z, 2 * z);
        return 18;
      }
      case 'stalker': {
        g.fillStyle = '#5b7a8a';
        for (const lx of [-8, -3, 3, 8]) g.fillRect(x + lx * z, y - 8 * z + (lx > 0 ? step : -step) * 2 * z, 2.5 * z, 8 * z);
        g.fillStyle = '#7fa3b4';
        g.beginPath();
        g.ellipse(x, y - 12 * z, 12 * z, 6 * z, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = col;
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.moveTo(x - 9 * z + i * 6 * z, y - 14 * z);
          g.lineTo(x - 7 * z + i * 6 * z, y - (24 + (i % 2) * 6) * z);
          g.lineTo(x - 5 * z + i * 6 * z, y - 14 * z);
          g.fill();
        }
        return 32;
      }
      case 'crawler': {
        g.fillStyle = '#4a5260';
        g.beginPath();
        g.ellipse(x, y - 8 * z, 15 * z, 8 * z, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(x, y - 13 * z, 13 * z, 9 * z, 0, Math.PI, 0);
        g.fill();
        g.strokeStyle = '#2b313c';
        g.lineWidth = 1.5;
        for (const k of [-6, 0, 6]) {
          g.beginPath();
          g.moveTo(x + k * z, y - 21 * z);
          g.lineTo(x + k * 1.3 * z, y - 9 * z);
          g.stroke();
        }
        g.fillStyle = '#ff9a3c';
        g.fillRect(x + 9 * z, y - 12 * z, 3 * z, 2 * z);
        return 26;
      }
      case 'wraith': {
        const bob = Math.sin(now / 300) * 4 * z;
        g.save();
        g.shadowColor = col;
        g.shadowBlur = 14 * z;
        g.fillStyle = col;
        g.globalAlpha *= 0.85;
        g.beginPath();
        g.moveTo(x, y - 40 * z + bob);
        g.lineTo(x + 10 * z, y - 24 * z + bob);
        g.lineTo(x, y - 8 * z + bob);
        g.lineTo(x - 10 * z, y - 24 * z + bob);
        g.closePath();
        g.fill();
        g.restore();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(x, y - 24 * z + bob, 2.5 * z, 0, Math.PI * 2);
        g.fill();
        return 44;
      }
      default: {
        // colossus
        g.fillStyle = '#6b5a44';
        g.fillRect(x - 14 * z, y - 18 * z + step * 2 * z, 9 * z, 18 * z);
        g.fillRect(x + 5 * z, y - 18 * z - step * 2 * z, 9 * z, 18 * z);
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(x - 22 * z, y - 18 * z);
        g.lineTo(x + 22 * z, y - 18 * z);
        g.lineTo(x + 18 * z, y - 56 * z);
        g.lineTo(x - 18 * z, y - 56 * z);
        g.closePath();
        g.fill();
        g.fillStyle = '#8a7556';
        g.fillRect(x - 30 * z, y - 52 * z, 9 * z, 28 * z);
        g.fillRect(x + 21 * z, y - 52 * z, 9 * z, 28 * z);
        g.save();
        g.shadowColor = '#7cf5e6';
        g.shadowBlur = 16 * z;
        g.fillStyle = '#7cf5e6';
        g.beginPath();
        g.arc(x, y - 38 * z, 6 * z, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.fillStyle = '#5a4a36';
        g.fillRect(x - 9 * z, y - 70 * z, 18 * z, 14 * z);
        g.fillStyle = '#ffb347';
        g.fillRect(x - 5 * z, y - 65 * z, 10 * z, 3 * z);
        return 72;
      }
    }
  }

  private bar(x: number, y: number, w: number, h: number, pct: number, col: string) {
    const g = this.ctx;
    const z = Math.max(0.8, this.zoom);
    const W = w * z;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x - W / 2 - 1, y - 1, W + 2, h + 2);
    g.fillStyle = col;
    g.fillRect(x - W / 2, y, W * Math.max(0, Math.min(1, pct)), h);
  }

  private label(text: string, x: number, y: number, col: string, size: number) {
    const g = this.ctx;
    g.font = `600 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(8,12,22,0.85)';
    g.strokeText(text, x, y);
    g.fillStyle = col;
    g.fillText(text, x, y);
  }

  // -------------------------------------------------------------------- input

  pick(sx: number, sy: number): Hit {
    let best: { hit: Hit; d: number; pri: number } | null = null;
    for (const h of this.hitList) {
      const d = Math.hypot(h.sx - sx, h.sy - sy);
      if (d > h.r) continue;
      if (!best || h.pri < best.pri || (h.pri === best.pri && d < best.d)) best = { hit: h.hit, d, pri: h.pri };
    }
    if (best) return best.hit;
    const w = this.toWorld(sx, sy);
    return { kind: 'ground', x: w.x, y: w.y };
  }
}

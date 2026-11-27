/* Riftfall sprite generator: core 2.5D renderer.
   Characters are rigs of shaded 3D primitives projected into a 3/4 top-down view,
   so every facing direction is rendered from the same model and stays consistent. */
'use strict';
const TAU = Math.PI * 2;

/* ---------- vector math (model space: x = right, y = up, z = forward) ---------- */
const V = (x, y, z) => ({ x, y, z });
const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a, k) => V(a.x * k, a.y * k, a.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = a => Math.hypot(a.x, a.y, a.z);
const nrm = a => { const l = len(a) || 1; return mul(a, 1 / l); };
const cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => V(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
function rotX(p, a) { const c = Math.cos(a), s = Math.sin(a); return V(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return V(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
function rotZ(p, a) { const c = Math.cos(a), s = Math.sin(a); return V(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
/* keyframes: [[t, value], ...] with eased interpolation; values are numbers or vectors */
function keys(t, arr) {
  if (t <= arr[0][0]) return arr[0][1];
  for (let i = 1; i < arr.length; i++) {
    if (t <= arr[i][0]) {
      const [t0, v0] = arr[i - 1], [t1, v1] = arr[i], k = ease((t - t0) / (t1 - t0 || 1));
      return typeof v0 === 'number' ? lerp(v0, v1, k) : lerpV(v0, v1, k);
    }
  }
  return arr[arr.length - 1][1];
}
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

/* ---------- colour ---------- */
function rgbOf(h) { h = h.replace('#', ''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function tone(h, k) { const c = rgbOf(h).map(v => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))); return `rgb(${c[0]},${c[1]},${c[2]})`; }
function lit(h, m) { const c = rgbOf(h).map(v => Math.max(0, Math.min(255, Math.round(v * m)))); return `rgb(${c[0]},${c[1]},${c[2]})`; }
function rgba(h, a) { const c = rgbOf(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

/* ---------- projection ---------- */
const GS = 0.55, GH = 0.95;                       // ground squash, height scale (3/4 view)
const CAMV = { e: 0, s: 0.5, h: 0.866 };          // direction towards the viewer (east, south, up)
const LIT = (() => { const l = { e: -0.55, s: 0.3, h: 0.78 }, n = Math.hypot(l.e, l.s, l.h); return { e: l.e / n, s: l.s / n, h: l.h / n }; })();
let ctx = null, SC = 2, OX = 80, OY = 116, F = { e: 1, s: 0 }, R = { e: 0, s: 1 };
let TILT = { pitch: 0, roll: 0, pivot: V(0, 0, 0), lift: 0 };
let prims = [], glows = [];
function setFacing(a) { F = { e: Math.cos(a), s: Math.sin(a) }; R = { e: -Math.sin(a), s: Math.cos(a) }; }
function setTilt(t) { TILT = { pitch: (t && t.pitch) || 0, roll: (t && t.roll) || 0, pivot: (t && t.pivot) || V(0, 0, 0), lift: (t && t.lift) || 0 }; }
function tiltP(p) { if (!TILT.pitch && !TILT.roll && !TILT.lift) return p; let q = sub(p, TILT.pivot); q = rotZ(q, TILT.roll); q = rotX(q, TILT.pitch); q = add(q, TILT.pivot); q.y += TILT.lift; return q; }
function tiltN(n) { if (!TILT.pitch && !TILT.roll) return n; return rotX(rotZ(n, TILT.roll), TILT.pitch); }
function W(p) { p = tiltP(p); return { e: p.x * R.e + p.z * F.e, s: p.x * R.s + p.z * F.s, h: p.y }; }
function WN(n) { n = tiltN(n); return { e: n.x * R.e + n.z * F.e, s: n.x * R.s + n.z * F.s, h: n.y }; }
function P(p) { const w = W(p); return { x: OX + w.e * SC, y: OY + (w.s * GS - w.h * GH) * SC, d: w.s + w.h * 0.03 }; }
const dotW = (a, b) => a.e * b.e + a.s * b.s + a.h * b.h;
const facesCam = n => dotW(WN(n), CAMV);

/* ---------- primitives (pushed into a depth-sorted list) ---------- */
function push(d, fn) { prims.push({ d, fn }); }
const EDGE = 'rgba(8,10,16,.55)';
function sphere(c, r, col, o = {}) {
  const p = P(c), rx = r * SC * (o.kx || 1), ry = r * SC * (o.ky || 1);
  push(p.d + (o.bias || 0), () => {
    const g = ctx.createRadialGradient(p.x - rx * .38, p.y - ry * .42, Math.max(.5, r * SC * .08), p.x, p.y, Math.max(rx, ry) * 1.05);
    g.addColorStop(0, tone(col, .45)); g.addColorStop(.45, col); g.addColorStop(1, tone(col, -.5));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, o.rot || 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = EDGE; ctx.lineWidth = 1; ctx.stroke();
  });
}
function capsule(a, b, ra, rb, col, o = {}) {
  const pa = P(a), pb = P(b), A = ra * SC, B = rb * SC;
  push((pa.d + pb.d) / 2 + (o.bias || 0), () => {
    const dx = pb.x - pa.x, dy = pb.y - pa.y, L = Math.hypot(dx, dy);
    ctx.beginPath();
    let nx = 0, ny = -1;
    if (L < .5) ctx.arc(pa.x, pa.y, Math.max(A, B), 0, TAU);
    else {
      const ux = dx / L, uy = dy / L; nx = -uy; ny = ux; const tn = Math.atan2(ny, nx);
      ctx.moveTo(pa.x + nx * A, pa.y + ny * A); ctx.lineTo(pb.x + nx * B, pb.y + ny * B);
      ctx.arc(pb.x, pb.y, B, tn, tn - Math.PI, true); ctx.lineTo(pa.x - nx * A, pa.y - ny * A);
      ctx.arc(pa.x, pa.y, A, tn - Math.PI, tn - 2 * Math.PI, true); ctx.closePath();
    }
    if (nx * -.6 + ny * -.8 < 0) { nx = -nx; ny = -ny; }
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, Rr = Math.max(A, B);
    const g = ctx.createLinearGradient(mx + nx * Rr, my + ny * Rr, mx - nx * Rr, my - ny * Rr);
    g.addColorStop(0, tone(col, .38)); g.addColorStop(.42, col); g.addColorStop(1, tone(col, -.52));
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = EDGE; ctx.lineWidth = 1; ctx.stroke();
  });
}
function box(c, ax, ay, az, hx, hy, hz, col, o = {}) {
  const corner = (i, j, k) => add(add(add(c, mul(ax, i * hx)), mul(ay, j * hy)), mul(az, k * hz));
  const F6 = [
    ['+x', ax, [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], ['-x', mul(ax, -1), [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    ['+y', ay, [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], ['-y', mul(ay, -1), [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    ['+z', az, [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], ['-z', mul(az, -1), [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]];
  const pc = P(c), faces = [];
  for (const [key, n, cs] of F6) {
    const nw = WN(n); if (dotW(nw, CAMV) <= 0.01) continue;
    const pts = cs.map(q => P(corner(q[0], q[1], q[2])));
    const fc = (o.faces && o.faces[key]) || col, lam = Math.max(0, dotW(nw, LIT));
    faces.push({ pts, fill: lit(fc, .52 + .7 * lam), d: pts.reduce((s, q) => s + q.d, 0) / 4, key });
  }
  faces.sort((a, b) => a.d - b.d);
  push(pc.d + (o.bias || 0), () => {
    for (const f of faces) {
      ctx.beginPath(); ctx.moveTo(f.pts[0].x, f.pts[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(f.pts[i].x, f.pts[i].y); ctx.closePath();
      ctx.fillStyle = f.fill; ctx.fill(); ctx.strokeStyle = 'rgba(8,10,16,.5)'; ctx.lineWidth = 1; ctx.stroke();
      if (f.key === '+y') { ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.moveTo(f.pts[1].x, f.pts[1].y); ctx.lineTo(f.pts[2].x, f.pts[2].y); ctx.stroke(); }
    }
  });
}
function hull(ps) {
  const p = ps.slice().sort((a, b) => a.x - b.x || a.y - b.y), cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x), lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up);
}
/* cone / cylinder with horizontal rings (robes, sashes, mantles) */
function frustum(cb, ct, rb, rt, col, o = {}) {
  const N = 22, pts = [];
  for (let i = 0; i < N; i++) { const a = i / N * TAU; pts.push(P(V(cb.x + Math.cos(a) * rb, cb.y, cb.z + Math.sin(a) * rb))); pts.push(P(V(ct.x + Math.cos(a) * rt, ct.y, ct.z + Math.sin(a) * rt))); }
  const pc = P(lerpV(cb, ct, .5)), h = hull(pts);
  const folds = (o.folds || []).map(fa => {
    if (facesCam(V(Math.cos(fa), 0, Math.sin(fa))) < .2) return null;
    return [P(V(ct.x + Math.cos(fa) * rt * .97, ct.y, ct.z + Math.sin(fa) * rt * .97)), P(V(cb.x + Math.cos(fa) * rb * .97, cb.y, cb.z + Math.sin(fa) * rb * .97))];
  }).filter(Boolean);
  push(pc.d + (o.bias || 0), () => {
    ctx.beginPath(); ctx.moveTo(h[0].x, h[0].y); for (let i = 1; i < h.length; i++) ctx.lineTo(h[i].x, h[i].y); ctx.closePath();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of h) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, tone(col, .32)); g.addColorStop(.36, col); g.addColorStop(1, tone(col, -.45));
    ctx.fillStyle = g; ctx.fill();
    if (o.shadeBottom) { const g2 = ctx.createLinearGradient(0, y0, 0, y1); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, o.shadeBottom); ctx.fillStyle = g2; ctx.fill(); }
    ctx.strokeStyle = EDGE; ctx.lineWidth = 1; ctx.stroke();
    if (folds.length) { ctx.strokeStyle = o.foldCol || 'rgba(70,40,110,.28)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
      for (const [a, b] of folds) { ctx.beginPath(); ctx.moveTo(lerp(a.x, b.x, .12), lerp(a.y, b.y, .12)); ctx.lineTo(lerp(a.x, b.x, .9), lerp(a.y, b.y, .9)); ctx.stroke(); } }
  });
}
/* flat polygon lying on a surface; culled when its normal faces away */
function decal(pts, n, col, o = {}) {
  if (facesCam(n) < (o.minVis ?? 0.04)) return;
  const ps = pts.map(P), d = ps.reduce((s, q) => s + q.d, 0) / ps.length + (o.bias ?? 0.06);
  push(d, () => {
    ctx.beginPath(); ctx.moveTo(ps[0].x, ps[0].y); for (let i = 1; i < ps.length; i++) ctx.lineTo(ps[i].x, ps[i].y); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.sw || 1; ctx.stroke(); }
  });
}
/* flat polygon always drawn (cloth panels) */
function panel(pts, colA, colB, o = {}) {
  const ps = pts.map(P), d = ps.reduce((s, q) => s + q.d, 0) / ps.length + (o.bias || 0);
  push(d, () => {
    ctx.beginPath(); ctx.moveTo(ps[0].x, ps[0].y); for (let i = 1; i < ps.length; i++) ctx.lineTo(ps[i].x, ps[i].y); ctx.closePath();
    let y0 = 1e9, y1 = -1e9; for (const q of ps) { y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, colA); g.addColorStop(1, colB);
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = EDGE; ctx.lineWidth = 1; ctx.stroke();
  });
}
/* patch on a sphere's surface (visors, face openings) */
function spherePatch(c, r, f, rgt, up, p0, p1, t0, t1, col, o = {}) {
  const pt = (ph, th) => add(c, add(add(mul(rgt, r * Math.sin(ph) * Math.cos(th)), mul(up, r * Math.sin(th))), mul(f, r * Math.cos(ph) * Math.cos(th))));
  const pts = [], N = 10;
  for (let i = 0; i <= N; i++) pts.push(pt(lerp(p0, p1, i / N), t0));
  for (let i = N; i >= 0; i--) pts.push(pt(lerp(p0, p1, i / N), t1));
  const cn = nrm(sub(pt((p0 + p1) / 2, (t0 + t1) / 2), c));
  decal(pts, cn, col, o);
  return pt((p0 + p1) / 2, (t0 + t1) / 2);
}
function line3(a, b, col, w, o = {}) { const pa = P(a), pb = P(b); push((pa.d + pb.d) / 2 + (o.bias || 0), () => { ctx.strokeStyle = col; ctx.lineWidth = w * SC; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); }); }
function ring3(c, r, col, w, o = {}) {
  const pts = []; for (let i = 0; i <= 32; i++) { const t = i / 32 * TAU; pts.push(P(V(c.x + Math.cos(t) * r, c.y, c.z + Math.sin(t) * r))); }
  const d = P(c).d + (o.bias || 2);
  const path = () => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); };
  push(d, () => { path(); ctx.strokeStyle = 'rgba(8,10,16,.6)'; ctx.lineWidth = w * SC + 2; ctx.stroke(); path(); ctx.strokeStyle = col; ctx.lineWidth = w * SC; ctx.stroke(); });
  if (o.glow) glows.push({ d, fn: () => { path(); ctx.strokeStyle = rgba(o.glow, .35 * (o.ga || 1)); ctx.lineWidth = w * SC * 4; ctx.stroke(); } });
}
/* additive light (not outlined; occluded by the body when behind it) */
function glow(c, r, col, a = 1, o = {}) {
  const p = P(c);
  glows.push({ d: p.d + (o.bias || 0), front: o.front, fn: () => {
    const Rr = r * SC, g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Rr);
    g.addColorStop(0, rgba(col, Math.min(1, a))); g.addColorStop(.3, rgba(col, a * .5)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, Rr, 0, TAU); ctx.fill();
  } });
}
function star(c, r, col, a = 1, rot = 0) {
  const p = P(c);
  glows.push({ d: p.d + 50, front: true, fn: () => {
    const Rr = r * SC; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot); ctx.fillStyle = rgba(col, a);
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -Rr * .16); ctx.lineTo(Rr * (i % 2 ? .7 : 1), 0); ctx.lineTo(0, Rr * .16); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a)})`; ctx.beginPath(); ctx.arc(0, 0, Rr * .28, 0, TAU); ctx.fill(); ctx.restore();
  } });
}

/* ---------- skeleton helpers ---------- */
function ik(A, T, l1, l2, pole) {
  let d = sub(T, A), D = len(d); const max = l1 + l2 - 0.001;
  if (D > max) { d = mul(nrm(d), max); T = add(A, d); D = max; }
  if (D < 0.001) D = 0.001;
  const u = mul(d, 1 / D), x = (l1 * l1 - l2 * l2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  let p = sub(pole, mul(u, dot(pole, u))); p = nrm(p);
  return { J: add(add(A, mul(u, x)), mul(p, h)), T };
}
/* builds joints from a body spec + pose */
function skel(sp, po) {
  const root = po.root || V(0, 0, 0), pel = V(root.x, sp.hipH + root.y, root.z);
  const pitch = po.pitch || 0, yaw = po.yaw || 0, roll = po.roll || 0;
  const TA = n => rotY(rotX(rotZ(n, roll), pitch), yaw);
  const T = p => add(pel, TA(p));
  const ax = TA(V(1, 0, 0)), ay = TA(V(0, 1, 0)), az = TA(V(0, 0, 1));
  const legs = {};
  for (const [k, s] of [['L', -1], ['R', 1]]) {
    const hip = add(pel, rotY(V(s * sp.hipW, -1, 0), yaw * .4));
    const ft = po.feet[k], tgt = V(ft.x, ft.y + sp.ankle, ft.z);
    const pole = po.kneePole ? po.kneePole(s) : V(s * .15, 0, 1);
    const r = ik(hip, tgt, sp.thigh, sp.shin, pole);
    legs[k] = { hip, knee: r.J, foot: r.T, ground: ft, s };
  }
  const sh = { L: T(V(-sp.shW, sp.torsoH, 0)), R: T(V(sp.shW, sp.torsoH, 0)) };
  const hd = po.head || {};
  const HA = n => rotY(rotX(TA(n), hd.pitch || 0), hd.yaw || 0);
  const neck = T(V(0, sp.torsoH + sp.neck, 0));
  const head = { c: add(neck, HA(V(0, sp.headR * .85, sp.headZ || 0))), f: HA(V(0, 0, 1)), u: HA(V(0, 1, 0)), r: HA(V(1, 0, 0)) };
  if (po.handsFn) po = Object.assign({}, po, { hands: Object.assign({}, po.hands || {}, po.handsFn({ T, TA, pel, sh, ax, ay, az })) });
  const arms = {};
  for (const [k, s] of [['L', -1], ['R', 1]]) {
    const S = sh[k]; let tgt = po.hands && po.hands[k];
    if (!tgt) {
      const sw = (po.swing && po.swing[k]) || 0, out = (po.out && po.out[k]) ?? .14;
      const dir = TA(rotZ(rotX(V(0, -1, 0), -sw), s * out));
      tgt = add(S, mul(dir, (sp.upArm + sp.foreArm) * .93));
    }
    const pole = po.elbowPole ? po.elbowPole(s) : TA(V(s * .5, -.2, -1));
    const r = ik(S, tgt, sp.upArm, sp.foreArm, pole);
    arms[k] = { sh: S, elbow: r.J, hand: r.T, s };
  }
  return { pel, T, TA, ax, ay, az, legs, sh, head, arms };
}

function circlePts(c, u, v, r, N = 10) { const pts = []; for (let i = 0; i < N; i++) { const a = i / N * TAU; pts.push(add(c, add(mul(u, Math.cos(a) * r), mul(v, Math.sin(a) * r)))); } return pts; }
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

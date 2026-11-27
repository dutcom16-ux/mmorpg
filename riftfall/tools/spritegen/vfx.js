/* Riftfall skill VFX: frame-by-frame effect sheets (one row per effect). */
'use strict';
function fxG(c, x, y, r, col, a) { if (r <= 0 || a <= 0) return; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, Math.min(1, a))); g.addColorStop(.35, rgba(col, a * .5)); g.addColorStop(1, rgba(col, 0)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
function fxE(c, x, y, rx, ry, col, a, w) { if (a <= 0 || rx <= 0) return; c.strokeStyle = rgba(col, Math.min(1, a)); c.lineWidth = w; c.beginPath(); c.ellipse(x, y, rx, Math.max(.1, ry), 0, 0, TAU); c.stroke(); }
function fxJag(c, x0, y0, x1, y1, seg, jit, R) { c.beginPath(); c.moveTo(x0, y0); for (let i = 1; i < seg; i++) { const t = i / seg; c.lineTo(lerp(x0, x1, t) + (R() - .5) * jit, lerp(y0, y1, t) + (R() - .5) * jit); } c.lineTo(x1, y1); c.stroke(); }
function fxStar(c, x, y, r, col, a, rot = 0) { if (a <= 0) return; c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = rgba(col, a); for (let i = 0; i < 4; i++) { c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(0, -r * .16); c.lineTo(r, 0); c.lineTo(0, r * .16); c.closePath(); c.fill(); } c.fillStyle = `rgba(255,255,255,${a})`; c.beginPath(); c.arc(0, 0, r * .25, 0, TAU); c.fill(); c.restore(); }
const env = (t, a, b) => t < a ? t / a : t > b ? Math.max(0, (1 - t) / (1 - b)) : 1;
function castCircle(col) {
  return (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; const cx = 80, cy = 48;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, 70); g.addColorStop(0, rgba(col, .22)); g.addColorStop(1, rgba(col, 0));
    c.save(); c.translate(cx, cy); c.scale(1, .54); c.beginPath(); c.arc(0, 0, 70, 0, TAU); c.restore(); c.fillStyle = g; c.fill();
    fxE(c, cx, cy, 70, 38, col, .85, 2.6); fxE(c, cx, cy, 54, 29, col, .7, 1.6); fxE(c, cx, cy, 70, 38, col, .25, 8);
    c.strokeStyle = rgba(col, .9); c.lineWidth = 2;
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU + t * TAU / 16; c.beginPath(); c.moveTo(cx + Math.cos(a) * 56, cy + Math.sin(a) * 30.2); c.lineTo(cx + Math.cos(a) * 66, cy + Math.sin(a) * 35.8); c.stroke(); }
    c.fillStyle = rgba(col, .9);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU - t * TAU / 3; const x = cx + Math.cos(a) * 40, y = cy + Math.sin(a) * 21.6; c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 5, y + 3); c.lineTo(x - 5, y + 3); c.closePath(); c.fill(); fxG(c, x, y, 9, col, .5); }
  };
}
const FXDEF = {
  proj_bolt: { fw: 64, fh: 32, frames: 4, fps: 20, loop: true, rotate: true, anchor: [46, 16], world: [32, 16], blend: 'lighter', draw: (c, f) => {
    c.globalCompositeOperation = 'lighter'; const w = 1 + .18 * Math.sin(f * 1.9);
    const g = c.createLinearGradient(2, 0, 58, 0); g.addColorStop(0, 'rgba(56,232,255,0)'); g.addColorStop(.65, 'rgba(56,232,255,.5)'); g.addColorStop(1, 'rgba(220,252,255,.95)');
    c.fillStyle = g; c.beginPath(); c.ellipse(32, 16, 28, 5.5 * w, 0, 0, TAU); c.fill(); fxG(c, 50, 16, 12 * w, '#38e8ff', .75);
    c.fillStyle = 'rgba(255,255,255,.95)'; c.beginPath(); c.ellipse(48, 16, 10, 2.3, 0, 0, TAU); c.fill();
    const Q = rng(3 + f); for (let i = 0; i < 3; i++) fxG(c, 10 + Q() * 30, 16 + (Q() - .5) * 8, 2.5, '#9ff6ff', .6); } },
  proj_orb: { fw: 48, fh: 48, frames: 6, fps: 14, loop: true, anchor: [24, 24], world: [26, 26], blend: 'lighter', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; fxG(c, 24, 24, 22, '#c35cff', .55); fxG(c, 24, 24, 11, '#f0c8ff', .9);
    c.strokeStyle = 'rgba(255,220,255,.85)'; c.lineWidth = 2; c.lineCap = 'round';
    for (let i = 0; i < 3; i++) { const a = t * TAU / 3 + i * TAU / 3; c.beginPath(); c.arc(24, 24, 12, a, a + 1.1); c.stroke(); }
    c.fillStyle = '#fff'; c.beginPath(); c.arc(24, 24, 4.5, 0, TAU); c.fill(); } },
  proj_shell: { fw: 40, fh: 40, frames: 4, fps: 16, loop: true, rotate: true, anchor: [27, 20], world: [22, 22], blend: 'lighter', draw: (c, f) => {
    c.globalCompositeOperation = 'lighter'; const g = c.createLinearGradient(2, 0, 28, 0); g.addColorStop(0, 'rgba(255,140,60,0)'); g.addColorStop(1, 'rgba(255,190,110,.7)');
    c.fillStyle = g; c.beginPath(); c.ellipse(16, 20, 14, 4 + .6 * Math.sin(f * 2), 0, 0, TAU); c.fill();
    fxG(c, 27, 20, 11, '#ff9a4a', .8); c.fillStyle = '#fff2e0'; c.beginPath(); c.arc(27, 20, 4, 0, TAU); c.fill(); } },
  proj_rocket: { fw: 80, fh: 32, frames: 4, fps: 18, loop: true, rotate: true, anchor: [58, 16], world: [40, 16], blend: 'source-over', draw: (c, f) => {
    c.globalCompositeOperation = 'lighter'; const fl = .8 + .25 * Math.sin(f * 2.3 + 1);
    const g = c.createLinearGradient(36, 0, 2, 0); g.addColorStop(0, 'rgba(255,240,200,.95)'); g.addColorStop(.4, 'rgba(255,150,50,.75)'); g.addColorStop(1, 'rgba(255,80,20,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(22, 16, 20 * fl, 5.5, 0, 0, TAU); c.fill(); fxG(c, 34, 16, 10, '#ffb347', .8);
    c.globalCompositeOperation = 'source-over';
    const b = c.createLinearGradient(0, 11, 0, 21); b.addColorStop(0, '#b9c2cc'); b.addColorStop(.5, '#7d8794'); b.addColorStop(1, '#3a414b');
    c.fillStyle = b; c.beginPath(); c.roundRect(34, 11.5, 32, 9, 3); c.fill(); c.strokeStyle = '#0a0c12'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#ff4a3d'; c.beginPath(); c.moveTo(66, 11.5); c.lineTo(76, 16); c.lineTo(66, 20.5); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#2a2e35'; c.beginPath(); c.moveTo(36, 11.5); c.lineTo(32, 6); c.lineTo(42, 11.5); c.closePath(); c.fill(); c.beginPath(); c.moveTo(36, 20.5); c.lineTo(32, 26); c.lineTo(42, 20.5); c.closePath(); c.fill(); } },
  proj_cannon: { fw: 64, fh: 64, frames: 4, fps: 16, loop: true, anchor: [32, 32], world: [34, 34], blend: 'lighter', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; fxG(c, 32, 32, 30, '#5aa8ff', .6); fxG(c, 32, 32, 15, '#d6ecff', .95);
    c.save(); c.translate(32, 32); c.rotate(t * TAU / 2); c.scale(1, .45); c.strokeStyle = 'rgba(190,230,255,.8)'; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, 19, 0, TAU); c.stroke(); c.restore();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(32, 32, 6, 0, TAU); c.fill(); } },
  proj_zap: { fw: 48, fh: 48, frames: 4, fps: 20, loop: true, anchor: [24, 24], world: [24, 24], blend: 'lighter', draw: (c, f, t, R) => {
    c.globalCompositeOperation = 'lighter'; fxG(c, 24, 24, 20, '#38e8ff', .55); c.strokeStyle = 'rgba(220,255,255,.9)'; c.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) { const a = R() * TAU; fxJag(c, 24, 24, 24 + Math.cos(a) * 20, 24 + Math.sin(a) * 20, 4, 8, R); }
    c.fillStyle = '#fff'; c.beginPath(); c.arc(24, 24, 4, 0, TAU); c.fill(); } },
  fx_hit: { fw: 96, fh: 96, frames: 6, fps: 26, anchor: [48, 48], world: [52, 52], blend: 'lighter', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; const Q = rng(42);
    if (f < 2) fxG(c, 48, 48, 26 * (1 - t * .5), '#fff3d6', .9);
    for (let i = 0; i < 11; i++) { const a = Q() * TAU, sp = .6 + Q() * .6, hue = Q(); const r0 = 6 + t * 30 * sp, r1 = r0 + 12 * (1 - t) + 4;
      c.strokeStyle = `rgba(255,${200 + hue * 55 | 0},${130 + hue * 110 | 0},${1 - t})`; c.lineWidth = 2.4 * (1 - t) + .6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(48 + Math.cos(a) * r0, 48 + Math.sin(a) * r0 * .8); c.lineTo(48 + Math.cos(a) * r1, 48 + Math.sin(a) * r1 * .8); c.stroke(); }
    fxE(c, 48, 48, 10 + 30 * t, (10 + 30 * t) * .6, '#ffffff', .5 * (1 - t), 2); } },
  fx_explosion: { fw: 256, fh: 256, frames: 9, fps: 20, anchor: [128, 150], radiusPx: 118, blend: 'source-over', draw: (c, f, t) => {
    const cx = 128, cy = 150, Qs = rng(5), Qf = rng(6), Qe = rng(7);
    if (t < .75) { const r = 30 + t * 120; fxE(c, cx, cy, r, r * .52, '#ffd6a0', .55 * (1 - t / .75), 6 * (1 - t) + 1); }
    for (let i = 0; i < 9; i++) { const a = Qs() * TAU, d = Qs() * 40, sz = 16 + Qs() * 18, st = .25 + Qs() * .2; if (t < st) continue; const k = (t - st) / (1 - st);
      c.fillStyle = `rgba(42,38,44,${.55 * (1 - k)})`; c.beginPath(); c.arc(cx + Math.cos(a) * d * (1 + k), cy - 30 - k * 50 + Math.sin(a) * d * .5, sz * (.7 + k * .9), 0, TAU); c.fill(); }
    c.globalCompositeOperation = 'lighter';
    if (f === 0) fxG(c, cx, cy - 20, 80, '#fff6d6', 1);
    const fb = t < .62 ? 1 - t / .62 : 0;
    for (let i = 0; i < 10; i++) { const a = Qf() * TAU, d = Qf() * (20 + 60 * t), sz = (22 + Qf() * 20) * (.6 + t); if (fb <= 0) continue;
      const x = cx + Math.cos(a) * d, y = cy - 25 - t * 30 + Math.sin(a) * d * .6, g = c.createRadialGradient(x, y, 0, x, y, sz);
      g.addColorStop(0, `rgba(255,240,190,${.9 * fb})`); g.addColorStop(.45, `rgba(255,140,40,${.7 * fb})`); g.addColorStop(1, 'rgba(200,40,10,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, sz, 0, TAU); c.fill(); }
    for (let i = 0; i < 16; i++) { const a = Qe() * TAU, v = .4 + Qe() * .8; fxG(c, cx + Math.cos(a) * v * 120 * t, cy - 20 + Math.sin(a) * v * 70 * t - 40 * t + 60 * t * t, 3.2, '#ffcf7a', (1 - t) * .9); } } },
  fx_arc_blast: { fw: 256, fh: 256, frames: 8, fps: 20, anchor: [128, 150], radiusPx: 112, blend: 'lighter', draw: (c, f, t, R) => {
    c.globalCompositeOperation = 'lighter'; const cx = 128, cy = 150, a = 1 - t;
    if (f < 2) fxG(c, cx, cy - 10, 90, '#e8fdff', .95 - f * .3);
    fxG(c, cx, cy - 8, 70 * (1 - t * .5), '#38e8ff', .45 * a);
    const r = 30 + 85 * ease(t); fxE(c, cx, cy, r, r * .52, '#8feaff', .9 * a, 5 * a + 1); fxE(c, cx, cy, r * .7, r * .36, '#38e8ff', .6 * a, 3);
    c.strokeStyle = `rgba(220,255,255,${.95 * a})`; c.lineWidth = 2.2 * a + .5;
    for (let i = 0; i < 9; i++) { const an = i / 9 * TAU + R() * .4, L = (40 + 80 * t) * (.6 + R() * .5); fxJag(c, cx, cy - 10, cx + Math.cos(an) * L, cy - 10 + Math.sin(an) * L * .6, 6, 14, R); }
    const Qs = rng(12); for (let i = 0; i < 14; i++) { const an = Qs() * TAU, v = .5 + Qs() * .7; fxG(c, cx + Math.cos(an) * v * 110 * t, cy - 10 + Math.sin(an) * v * 60 * t - 30 * t, 3, '#bff8ff', a); } } },
  fx_drone: { fw: 64, fh: 64, frames: 6, fps: 18, loop: true, anchor: [32, 36], world: [32, 32], blend: 'source-over', draw: (c, f, t) => {
    const hubs = [[13, 26], [51, 26], [17, 44], [47, 44]];
    c.strokeStyle = '#2b323e'; c.lineWidth = 3; for (const [x, y] of hubs) { c.beginPath(); c.moveTo(32, 36); c.lineTo(x, y); c.stroke(); }
    const b = c.createRadialGradient(28, 30, 2, 32, 36, 14); b.addColorStop(0, '#c4ccd6'); b.addColorStop(.5, '#7d8999'); b.addColorStop(1, '#3a4250');
    c.fillStyle = b; c.beginPath(); c.ellipse(32, 36, 13, 9, 0, 0, TAU); c.fill(); c.strokeStyle = '#0a0c12'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#3d8bff'; c.beginPath(); c.ellipse(32, 32, 7, 4, 0, 0, TAU); c.fill();
    c.fillStyle = '#0b5a78'; c.beginPath(); c.ellipse(32, 40, 5, 3, 0, 0, TAU); c.fill();
    c.globalCompositeOperation = 'lighter'; fxG(c, 32, 40, 8, '#38e8ff', .8);
    for (const [x, y] of hubs) { c.fillStyle = 'rgba(200,230,255,.28)'; c.beginPath(); c.ellipse(x, y, 10, 4, 0, 0, TAU); c.fill();
      const a = t * Math.PI + x; c.strokeStyle = 'rgba(230,245,255,.55)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x - Math.cos(a) * 9, y - Math.sin(a) * 3.5); c.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 3.5); c.stroke(); } } },
  fx_mech_summon: { fw: 256, fh: 320, frames: 10, fps: 18, anchor: [128, 276], radiusPx: 90, blend: 'lighter', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; const gy = 276, cx = 128;
    if (t < .5) { const k = t / .5, w = 46 * (1 - k) + 8; const g = c.createLinearGradient(cx - w, 0, cx + w, 0); g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(.5, `rgba(220,245,255,${.9 * (1 - k * .5)})`); g.addColorStop(1, 'rgba(120,200,255,0)'); c.fillStyle = g; c.fillRect(cx - w, 0, w * 2, gy); }
    if (t > .1 && t < .55) fxG(c, cx, gy - 10, 100, '#d6ecff', 1 - (t - .1) / .45);
    if (t > .15) { const k = (t - .15) / .85; for (const [d, col] of [[0, '#a8d6ff'], [.18, '#3d8bff']]) { const kk = Math.max(0, k - d); const r = 20 + 120 * ease(Math.min(1, kk)); fxE(c, cx, gy, r, r * .5, col, .85 * (1 - kk), 6 * (1 - kk) + 1); } }
    const Q = rng(21); for (let i = 0; i < 18; i++) { const a = Q() * TAU, v = .5 + Q() * .6, k = Math.max(0, t - .2) / .8; if (k <= 0) continue; fxG(c, cx + Math.cos(a) * v * 110 * k, gy + Math.sin(a) * v * 50 * k - 80 * k * v, 3, '#bfe4ff', 1 - k); } } },
  fx_nova: { fw: 384, fh: 384, frames: 9, fps: 18, anchor: [192, 200], radiusPx: 175, blend: 'lighter', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; const cx = 192, cy = 200, k = ease(t), r = 30 + 145 * k, ry = r * .55, a = 1 - Math.max(0, (t - .5) / .5);
    c.save(); c.translate(cx, cy); c.scale(1, .55); const g = c.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, `rgba(255,170,80,${.25 * a})`); g.addColorStop(.85, `rgba(255,110,40,${.3 * a})`); g.addColorStop(1, 'rgba(255,80,20,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill(); c.restore();
    fxE(c, cx, cy, r, ry, '#ff9a4a', .85 * a, 14 * (1 - t) + 3); fxE(c, cx, cy, r, ry, '#fff0c8', .7 * a, 2.5);
    const Q = rng(3);
    for (let i = 0; i < 34; i++) { const an = i / 34 * TAU + Q() * .1, hgt = (30 + Q() * 26) * (1 - t * .7) * a, w = 6 + Q() * 4; const x = cx + Math.cos(an) * r, y = cy + Math.sin(an) * ry;
      if (hgt <= 1) continue; const fg = c.createLinearGradient(0, y, 0, y - hgt); fg.addColorStop(0, 'rgba(255,240,180,.9)'); fg.addColorStop(.4, 'rgba(255,150,50,.75)'); fg.addColorStop(1, 'rgba(255,60,20,0)');
      c.fillStyle = fg; c.beginPath(); c.moveTo(x - w, y); c.quadraticCurveTo(x - w * .4, y - hgt * .6, x, y - hgt); c.quadraticCurveTo(x + w * .4, y - hgt * .6, x + w, y); c.closePath(); c.fill(); }
    const Qe = rng(4); for (let i = 0; i < 20; i++) { const an = Qe() * TAU, v = .8 + Qe() * .4, up = Qe(); fxG(c, cx + Math.cos(an) * r * v, cy + Math.sin(an) * ry * v - up * 60 * t, 3, '#ffcf7a', a * .9); } } },
  fx_mend: { fw: 192, fh: 192, frames: 10, fps: 14, anchor: [96, 120], radiusPx: 70, blend: 'lighter', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; const cx = 96, cy = 120, e = env(t, .2, .72);
    const col = c.createLinearGradient(0, cy, 0, 10); col.addColorStop(0, `rgba(126,232,162,${.32 * e})`); col.addColorStop(1, 'rgba(126,232,162,0)'); c.fillStyle = col; c.fillRect(cx - 44, 10, 88, cy - 10);
    fxE(c, cx, cy, 70, 38, '#7ee8a2', .9 * e, 2.6); fxE(c, cx, cy, 52, 28, '#b6ffd0', .7 * e, 1.6); fxE(c, cx, cy, 70, 38, '#7ee8a2', .25 * e, 9);
    c.strokeStyle = `rgba(182,255,208,${.9 * e})`; c.lineWidth = 2;
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + t * 1.2; c.beginPath(); c.moveTo(cx + Math.cos(a) * 55, cy + Math.sin(a) * 29.7); c.lineTo(cx + Math.cos(a) * 66, cy + Math.sin(a) * 35.6); c.stroke(); }
    const Q = rng(9); for (let i = 0; i < 12; i++) { const x = cx + (Q() - .5) * 110, y0 = cy + (Q() - .5) * 36, sp = Q(), k = (t * 1.3 + sp) % 1, y = y0 - k * 96, a = e * (1 - k), s = 3 + Q() * 2.5;
      c.fillStyle = `rgba(190,255,214,${a})`; c.fillRect(x - s, y - s * .3, s * 2, s * .6); c.fillRect(x - s * .3, y - s, s * .6, s * 2); fxG(c, x, y, s * 2.5, '#7ee8a2', a * .6); } } },
  fx_meteor: { fw: 96, fh: 192, frames: 6, fps: 16, loop: true, anchor: [48, 150], world: [60, 120], blend: 'source-over', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; const fl = 1 + .12 * Math.sin(t * TAU * 2);
    const g = c.createLinearGradient(48, 150, 86, 6); g.addColorStop(0, 'rgba(255,245,210,.95)'); g.addColorStop(.3, 'rgba(255,170,60,.75)'); g.addColorStop(1, 'rgba(255,80,20,0)');
    c.fillStyle = g; c.beginPath(); c.moveTo(48 - 14 * fl, 152); c.lineTo(88, 4); c.lineTo(48 + 14 * fl, 146); c.closePath(); c.fill(); fxG(c, 48, 150, 30 * fl, '#ffb347', .7);
    c.globalCompositeOperation = 'source-over';
    const r = c.createRadialGradient(43, 144, 2, 48, 150, 14); r.addColorStop(0, '#8a6a4a'); r.addColorStop(.6, '#4a3626'); r.addColorStop(1, '#1e140c');
    c.fillStyle = r; c.beginPath(); c.moveTo(36, 150); c.lineTo(42, 138); c.lineTo(56, 138); c.lineTo(62, 150); c.lineTo(54, 163); c.lineTo(40, 161); c.closePath(); c.fill(); c.strokeStyle = '#0a0c12'; c.lineWidth = 1.5; c.stroke();
    c.globalCompositeOperation = 'lighter'; c.strokeStyle = 'rgba(255,170,70,.9)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(42, 148); c.lineTo(48, 152); c.lineTo(46, 158); c.moveTo(52, 142); c.lineTo(55, 150); c.stroke(); } },
  fx_meteor_impact: { fw: 320, fh: 320, frames: 9, fps: 18, anchor: [160, 190], radiusPx: 130, blend: 'source-over', draw: (c, f, t) => {
    const cx = 160, cy = 190, a = 1 - t;
    c.fillStyle = `rgba(26,18,12,${.5 * (1 - t * .6)})`; c.beginPath(); c.ellipse(cx, cy, 60 + 10 * t, 32 + 5 * t, 0, 0, TAU); c.fill();
    const Qd = rng(31); for (let i = 0; i < 14; i++) { const an = Qd() * TAU, v = .5 + Qd() * .7, s = 3 + Qd() * 4; const x = cx + Math.cos(an) * v * 140 * t, y = cy + Math.sin(an) * v * 70 * t - 120 * v * t + 160 * t * t;
      c.fillStyle = `rgba(58,40,28,${a})`; c.beginPath(); c.moveTo(x - s, y); c.lineTo(x, y - s); c.lineTo(x + s, y + s * .3); c.closePath(); c.fill(); }
    c.globalCompositeOperation = 'lighter';
    if (f < 2) fxG(c, cx, cy - 20, 130 - f * 30, '#fff6d6', 1);
    const r = 30 + 110 * ease(t); fxE(c, cx, cy, r, r * .52, '#ffe27a', .9 * a, 8 * a + 1);
    const fb = t < .6 ? 1 - t / .6 : 0, Qf = rng(32);
    for (let i = 0; i < 9; i++) { const an = Qf() * TAU, d = Qf() * (20 + 50 * t), sz = (24 + Qf() * 20) * (.6 + t); if (fb <= 0) continue; const x = cx + Math.cos(an) * d, y = cy - 30 - t * 30 + Math.sin(an) * d * .6;
      const g = c.createRadialGradient(x, y, 0, x, y, sz); g.addColorStop(0, `rgba(255,248,210,${.9 * fb})`); g.addColorStop(.45, `rgba(255,190,60,${.7 * fb})`); g.addColorStop(1, 'rgba(220,90,20,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, sz, 0, TAU); c.fill(); }
    const Qe = rng(33); for (let i = 0; i < 14; i++) { const an = Qe() * TAU, v = .4 + Qe() * .8; fxStar(c, cx + Math.cos(an) * v * 120 * t, cy - 20 + Math.sin(an) * v * 60 * t - 50 * t, 6, '#ffe7a3', a * .9, an); } } },
  fx_wall: { fw: 160, fh: 192, frames: 8, fps: 12, loop: true, anchor: [80, 150], world: [80, 96], blend: 'lighter', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; const cx = 80, cy = 100, rx = 50, ry = 64;
    const g = c.createRadialGradient(cx, cy, rx * .3, cx, cy, ry); g.addColorStop(0, 'rgba(255,120,90,0)'); g.addColorStop(.8, 'rgba(255,120,90,.16)'); g.addColorStop(1, 'rgba(255,150,120,.4)');
    c.fillStyle = g; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, TAU); c.fill();
    c.save(); c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, TAU); c.clip();
    const band = (t * 1.4 % 1.4) * (ry * 2 + 40) + cy - ry - 20, hs = 10;
    for (let row = -8; row <= 8; row++) for (let col = -6; col <= 6; col++) { const x = cx + col * hs * 1.5, y = cy + row * hs * 1.73 + (col % 2 ? hs * .866 : 0); const near = Math.max(0, 1 - Math.abs(y - band) / 26);
      c.strokeStyle = `rgba(255,${170 + near * 60 | 0},${140 + near * 80 | 0},${.16 + .5 * near})`; c.lineWidth = 1.2; c.beginPath(); for (let i = 0; i <= 6; i++) { const a = i / 6 * TAU; c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * hs, y + Math.sin(a) * hs); } c.stroke(); }
    c.restore();
    fxE(c, cx, cy, rx, ry, '#ffb0a0', .85, 2.5); fxE(c, cx, cy, rx, ry, '#ff6a50', .3, 8);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 3; c.beginPath(); c.ellipse(cx, cy, rx - 8, ry - 8, 0, 3.6, 4.4); c.stroke(); } },
  fx_siege: { fw: 192, fh: 192, frames: 8, fps: 14, anchor: [96, 112], radiusPx: 70, blend: 'source-over', draw: (c, f, t) => {
    const cx = 96, cy = 112, a = 1 - t, r = 20 + 62 * ease(t);
    c.strokeStyle = `rgba(150,128,100,${.5 * a})`; c.lineWidth = 14 * a + 4; c.beginPath(); c.ellipse(cx, cy, r, r * .52, 0, 0, TAU); c.stroke();
    const Q = rng(51); c.strokeStyle = `rgba(20,16,14,${.7 * Math.min(1, (1 - t) * 1.5)})`; c.lineWidth = 2; c.lineCap = 'round';
    for (let i = 0; i < 7; i++) { const an = Q() * TAU, L = (24 + Q() * 30) * Math.min(1, t * 2.5); fxJag(c, cx, cy, cx + Math.cos(an) * L, cy + Math.sin(an) * L * .52, 4, 5, rng(60 + i)); }
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) { const an = i / 4 * TAU + .4; fxG(c, cx + Math.cos(an) * 34, cy + Math.sin(an) * 17.6, 10, '#ff5a46', .85 * (.6 + .4 * Math.sin(t * 9 + i)) * Math.min(1, t * 4)); }
    const Qs = rng(52); for (let i = 0; i < 12; i++) { const an = Qs() * TAU, v = .5 + Qs() * .5; fxG(c, cx + Math.cos(an) * v * 70 * t, cy + Math.sin(an) * v * 36 * t - 60 * t * v, 2.6, '#ffd27a', a); } } },
  fx_levelup: { fw: 256, fh: 320, frames: 12, fps: 16, anchor: [128, 280], radiusPx: 60, blend: 'lighter', draw: (c, f, t) => {
    c.globalCompositeOperation = 'lighter'; const cx = 128, gy = 280, e = env(t, .15, .7);
    const g = c.createLinearGradient(cx - 34, 0, cx + 34, 0); g.addColorStop(0, 'rgba(255,211,77,0)'); g.addColorStop(.5, `rgba(255,236,170,${.5 * e})`); g.addColorStop(1, 'rgba(255,211,77,0)');
    c.fillStyle = g; c.fillRect(cx - 34, 20, 68, gy - 20); fxG(c, cx, gy, 60, '#ffd34d', .5 * e);
    for (let i = 0; i < 3; i++) { const k = t * 1.5 - i * .25; if (k < 0 || k > 1) continue; const y = gy - k * 220, rx = 48 * (1 - k * .3); fxE(c, cx, y, rx, rx * .42, '#ffe27a', .9 * (1 - k), 3); }
    const Q = rng(77); for (let i = 0; i < 14; i++) { const x = cx + (Q() - .5) * 120, y = gy - Q() * 230, ph = Q() * TAU; fxStar(c, x, y - t * 30, 5 + 3 * Math.sin(t * 12 + ph), '#fff1b8', e * (.5 + .5 * Math.sin(t * 10 + ph)), ph); } } },
  fx_cast_ferros: { fw: 160, fh: 96, frames: 8, fps: 12, loop: true, anchor: [80, 48], radiusPx: 70, blend: 'lighter', draw: castCircle('#5aa8ff') },
  fx_cast_aether: { fw: 160, fh: 96, frames: 8, fps: 12, loop: true, anchor: [80, 48], radiusPx: 70, blend: 'lighter', draw: castCircle('#d58cff') },
  fx_cast_chrome: { fw: 160, fh: 96, frames: 8, fps: 12, loop: true, anchor: [80, 48], radiusPx: 70, blend: 'lighter', draw: castCircle('#ff6a50') }
};

/* Riftfall sprite generator: frame post-processing, sheet assembly and export. */
'use strict';
const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];   // row order; angle = index * 45deg, y pointing down
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function renderFrame(rig, pose, facing) {
  const fw = rig.fw, fh = rig.fh;
  const body = mkCanvas(fw, fh); ctx = body.getContext('2d');
  SC = rig.sc; OX = rig.ox; OY = rig.oy; setFacing(facing); prims = []; glows = []; setTilt(pose.tilt);
  const meta = rig.draw(pose) || {};
  prims.sort((a, b) => a.d - b.d);
  for (const p of prims) { ctx.save(); p.fn(); ctx.restore(); }
  const coreD = meta.coreD != null ? meta.coreD : 0;
  // silhouette
  const sil = mkCanvas(fw, fh), sc = sil.getContext('2d');
  sc.drawImage(body, 0, 0); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = '#0a0c12'; sc.fillRect(0, 0, fw, fh);
  // rim light on top-left edges (pixels whose up-left neighbour is empty)
  const rim = mkCanvas(fw, fh), rc = rim.getContext('2d');
  rc.drawImage(sil, 0, 0); rc.globalCompositeOperation = 'source-in'; rc.fillStyle = '#dff1ff'; rc.fillRect(0, 0, fw, fh);
  rc.globalCompositeOperation = 'destination-out'; rc.drawImage(sil, 2, 2);
  // outline + body + rim + tint
  const out = mkCanvas(fw, fh), oc = out.getContext('2d');
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; oc.drawImage(sil, Math.cos(a) * 2, Math.sin(a) * 2); }
  oc.drawImage(body, 0, 0);
  oc.globalCompositeOperation = 'source-atop'; oc.globalAlpha = .3; oc.drawImage(rim, 0, 0); oc.globalAlpha = 1;
  if (pose.tint) { oc.fillStyle = pose.tint; oc.fillRect(0, 0, fw, fh); }
  oc.globalCompositeOperation = 'source-over';
  // glows: behind-body ones are masked by the silhouette, front ones are added on top
  const gb = mkCanvas(fw, fh), gbc = gb.getContext('2d'), gf = mkCanvas(fw, fh), gfc = gf.getContext('2d');
  glows.sort((a, b) => a.d - b.d);
  for (const g of glows) { ctx = (!g.front && g.d < coreD - 1) ? gbc : gfc; ctx.save(); ctx.globalCompositeOperation = 'lighter'; g.fn(); ctx.restore(); }
  gbc.globalCompositeOperation = 'destination-out'; gbc.drawImage(sil, 0, 0);
  const fin = mkCanvas(fw, fh), fc = fin.getContext('2d');
  fc.globalAlpha = pose.alpha ?? 1;
  fc.drawImage(gb, 0, 0); fc.drawImage(out, 0, 0); fc.globalCompositeOperation = 'lighter'; fc.drawImage(gf, 0, 0);
  return fin;
}

function buildSheet(rigName, animName) {
  const rig = RIGS[rigName], A = rig.anims[animName];
  const sheet = mkCanvas(rig.fw * A.frames, rig.fh * 8), c = sheet.getContext('2d');
  for (let d = 0; d < 8; d++) for (let f = 0; f < A.frames; f++) {
    const t = A.loop ? f / A.frames : (A.frames > 1 ? f / (A.frames - 1) : 0);
    const fr = renderFrame(rig, A.pose(t, f), d * Math.PI / 4);
    c.drawImage(fr, f * rig.fw, d * rig.fh);
  }
  return sheet;
}

function buildFx(name) {
  const fx = FXDEF[name], sheet = mkCanvas(fx.fw * fx.frames, fx.fh), c = sheet.getContext('2d');
  for (let f = 0; f < fx.frames; f++) {
    const fr = mkCanvas(fx.fw, fx.fh), fc = fr.getContext('2d');
    const t = fx.loop ? f / fx.frames : (fx.frames > 1 ? f / (fx.frames - 1) : 0);
    fx.draw(fc, f, t, rng(1000 + f * 7919 + name.length * 31), fx);
    c.drawImage(fr, f * fx.fw, 0);
  }
  return sheet;
}

/* public API used by the build script and the viewer */
window.SpriteGen = {
  DIRS,
  jobs() {
    const out = [];
    for (const r of Object.keys(RIGS)) for (const a of Object.keys(RIGS[r].anims)) out.push({ kind: 'char', rig: r, anim: a, file: `${r}_${a}` });
    for (const n of Object.keys(FXDEF)) out.push({ kind: 'fx', name: n, file: n });
    return out;
  },
  render(job, type = 'image/png', q) {
    const cv = job.kind === 'char' ? buildSheet(job.rig, job.anim) : buildFx(job.name);
    return cv.toDataURL(type, q);
  },
  renderBoth(job) {
    const cv = job.kind === 'char' ? buildSheet(job.rig, job.anim) : buildFx(job.name);
    return { png: cv.toDataURL('image/png'), webp: cv.toDataURL('image/webp', .9) };
  },
  atlas(ext = 'png') {
    const A = { version: 1, generator: 'Riftfall spritegen', directions: DIRS, directionNote: 'Rows are facing directions in this order; facing angle = row * 45 degrees with y pointing down (0 = east, 2 = south).', characters: {}, effects: {} };
    for (const [r, rig] of Object.entries(RIGS)) {
      A.characters[r] = { frame: [rig.fw, rig.fh], anchor: [rig.ox, rig.oy], pxPerUnit: rig.sc, anims: {} };
      for (const [a, an] of Object.entries(rig.anims)) A.characters[r].anims[a] = { file: `${r}_${a}.${ext}`, frames: an.frames, fps: an.fps, loop: !!an.loop };
    }
    for (const [n, fx] of Object.entries(FXDEF)) A.effects[n] = { file: `${n}.${ext}`, frame: [fx.fw, fx.fh], frames: fx.frames, fps: fx.fps, loop: !!fx.loop, anchor: fx.anchor, radiusPx: fx.radiusPx || null, world: fx.world || null, blend: fx.blend, rotate: !!fx.rotate };
    return A;
  },
  /* single frame for quick previews */
  frame(rigName, animName, f, d) { const rig = RIGS[rigName], A = rig.anims[animName]; const t = A.loop ? f / A.frames : (A.frames > 1 ? f / (A.frames - 1) : 0); return renderFrame(rig, A.pose(t, f), d * Math.PI / 4); }
};

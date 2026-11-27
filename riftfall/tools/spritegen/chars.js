/* Riftfall character rigs: Ferros, Aether, Chrome (+ siege form) and the Ferros battle mech. */
'use strict';

/* ======================= FERROS UNION: engineer gunner ======================= */
const FER_SP = { hipH: 12, hipW: 3.4, thigh: 6.2, shin: 6.0, ankle: 1.6, torsoH: 11, shW: 7.4, upArm: 5, foreArm: 5.2, neck: 1.2, headR: 8.2 };
const FC = { blue: '#3d8bff', navy: '#1d3f7a', suit: '#3b4658', gray: '#7d8999', white: '#e4eaf2', dark: '#262d38', boot: '#2a303b', cyan: '#38e8ff', tank: '#cfd8e3', gold: '#ffd34d' };
function ferBase() { return { root: V(0, 0, 0), pitch: .06, yaw: 0, roll: 0, feet: { L: V(-3.3, 0, .7), R: V(3.3, 0, -.7) }, head: { pitch: 0, yaw: 0 }, aim: -.1, recoil: 0, flash: 0, gun: 'both' }; }
function ferGun(po, s) {
  const yaw = po.yaw || 0; let aim, G;
  if (po.gun === 'left') { aim = rotY(rotX(V(0, 0, 1), .75), yaw); G = s.T(V(-3.8, 1.6, 3.8)); }
  else { aim = rotY(rotX(V(0, 0, 1), -(po.aim || 0)), yaw); G = s.T(V(2.2, 6.4, 5.6)); }
  G = sub(G, mul(aim, po.recoil || 0));
  const gx = nrm(cross(V(0, 1, 0), aim)), gy = cross(aim, gx);
  return { aim, G, gx, gy, at: (f, u, r) => add(G, add(add(mul(aim, f), mul(gy, u)), mul(gx, r))) };
}
function drawFerGun(g, po) {
  const { aim, gx, gy, at } = g;
  box(at(2.6, 0, 0), gx, gy, aim, 1.45, 1.9, 7.2, '#2b323e', { faces: { '+y': '#3c4656' } });
  box(at(-4.4, -.2, 0), gx, gy, aim, 1.1, 1.7, 2.3, '#2b323e');
  box(at(.6, -2.7, 0), gx, gy, aim, .9, 1.5, 1.1, '#222831');
  box(at(4.2, .2, 1.5), gx, gy, aim, .35, .9, 2.6, FC.cyan, { bias: .05 });
  box(at(4.2, .2, -1.5), gx, gy, aim, .35, .9, 2.6, FC.cyan, { bias: .05 });
  box(at(3, 2.2, 0), gx, gy, aim, .6, .5, 2.2, '#3c4656', { bias: .05 });
  capsule(at(9.3, .3, 0), at(13.4, .3, 0), .9, .85, '#8d99aa');
  const m = at(14.1, .3, 0); glow(m, 1.8, FC.cyan, .75); glow(at(4.2, .2, 1.5), 1.6, FC.cyan, .3);
  if (po.flash) { glow(m, 8 * po.flash, FC.cyan, .95, { front: true }); star(m, 10 * po.flash, '#c8fbff', po.flash, .3); }
}
function drawFerros(po) {
  let gun = null;
  po.handsFn = s => {
    gun = ferGun(po, s); const h = {};
    if (po.gun === 'both') { h.R = gun.at(-.6, -1.6, 0); h.L = gun.at(6.2, -1.2, -.5); }
    else if (po.gun === 'left') h.L = gun.at(-.4, -1.4, 0);
    return h;
  };
  const sk = skel(FER_SP, po), { T, ax, ay, az } = sk, c = FC;
  for (const k of ['L', 'R']) {
    const L = sk.legs[k];
    capsule(L.hip, L.knee, 2.4, 2.2, c.suit); capsule(L.knee, L.foot, 2.2, 2.0, c.suit);
    box(add(L.knee, mul(az, 1.2)), ax, ay, az, 2.1, 2.3, 1, c.blue, { faces: { '+y': tone(c.blue, .2) }, bias: .25 });
    const fy = rotY(V(0, 0, 1), (po.yaw || 0) * .35), fx = rotY(V(1, 0, 0), (po.yaw || 0) * .35), g = L.ground;
    box(V(g.x, g.y + 1.5, g.z + .9), fx, V(0, 1, 0), fy, 2.5, 1.5, 3.4, c.boot, { faces: { '+y': '#3a4252', '+z': c.navy } });
  }
  box(T(V(0, 0, 0)), ax, ay, az, 5.6, 2.4, 4.2, c.navy);
  decal([T(V(-1.3, -1.1, 4.25)), T(V(1.3, -1.1, 4.25)), T(V(1.3, 1.1, 4.25)), T(V(-1.3, 1.1, 4.25))], az, c.gold);
  box(T(V(0, 6.7, 0)), ax, ay, az, 7.2, 5.3, 5, c.blue, { faces: { '+y': tone(c.blue, .18) } });
  decal([T(V(-4.6, 3.2, 4.85)), T(V(4.6, 3.2, 4.85)), T(V(3.4, 10, 4.85)), T(V(-3.4, 10, 4.85))], az, tone(c.blue, .3));
  decal([T(V(-6.85, 2, -3)), T(V(-6.85, 2, 3)), T(V(-6.85, 4, 3)), T(V(-6.85, 4, -3))], mul(ax, -1), c.navy);
  decal([T(V(6.85, 2, 3)), T(V(6.85, 2, -3)), T(V(6.85, 4, -3)), T(V(6.85, 4, 3))], ax, c.navy);
  const cl = T(V(2.8, 8.2, 4.9)); decal(circlePts(cl, ax, ay, 1.1), az, c.cyan, { bias: .1 }); if (facesCam(az) > 0) glow(cl, 2.6, c.cyan, .5);
  capsule(T(V(-3.6, 11.6, .3)), T(V(3.6, 11.6, .3)), 2, 2, c.navy, { bias: .1 });
  box(T(V(0, 7.4, -6.5)), ax, ay, az, 5.2, 5.8, 2.2, c.gray, { faces: { '+y': tone(c.gray, .2) } });
  capsule(T(V(-3.1, 2.6, -9.1)), T(V(-3.1, 11.4, -9.1)), 1.5, 1.5, c.tank);
  capsule(T(V(3.1, 2.6, -9.1)), T(V(3.1, 11.4, -9.1)), 1.5, 1.5, c.tank);
  const ant = T(V(4.3, 25, -9.5)); line3(T(V(3.6, 13, -7.2)), ant, c.dark, .55); sphere(ant, .9, c.cyan); glow(ant, 2.2, c.cyan, .7);
  for (const k of ['L', 'R']) {
    const A = sk.arms[k];
    box(add(A.sh, add(mul(ay, 1.1), mul(ax, A.s * .7))), ax, ay, az, 3.4, 2.1, 4, c.blue, { faces: { '+y': tone(c.blue, .22) }, bias: .3 });
    capsule(A.sh, A.elbow, 2.05, 1.9, c.suit); capsule(A.elbow, A.hand, 1.95, 1.8, c.suit);
    capsule(lerpV(A.elbow, A.hand, .18), lerpV(A.elbow, A.hand, .72), 2.15, 2.05, c.blue, { bias: .05 });
    sphere(A.hand, 2.1, c.dark, { bias: .1 });
  }
  const H = sk.head;
  sphere(H.c, 8.2, c.white);
  capsule(add(H.c, add(mul(H.u, 7.3), mul(H.f, 4))), add(H.c, add(mul(H.u, 7.2), mul(H.f, -5.2))), 1.35, 1.1, c.blue, { bias: .4 });
  sphere(add(H.c, mul(H.r, 7.8)), 2.5, c.blue, { bias: .15 }); sphere(add(H.c, mul(H.r, -7.8)), 2.5, c.blue, { bias: .15 });
  const vc = spherePatch(H.c, 8.32, H.f, H.r, H.u, -.95, .95, -.28, .3, '#0b5a78');
  spherePatch(H.c, 8.36, H.f, H.r, H.u, -.7, .2, .12, .26, 'rgba(200,250,255,.55)', { bias: .08 });
  if (facesCam(H.f) > -.1) glow(vc, 5.5, c.cyan, .42);
  if (gun) drawFerGun(gun, po);
  if (po.grenade) { sphere(po.grenade, 1.7, '#2b323e', { bias: .5 }); glow(po.grenade, 3.5, c.cyan, .8, { front: true }); }
  return { coreD: P(T(V(0, 6, 0))).d };
}
const FER_ANIMS = {
  idle: { frames: 6, fps: 7, loop: true, pose: t => { const b = Math.sin(t * TAU), p = ferBase(); p.root.y = -.25 + .25 * b; p.pitch = .05 + .02 * b; p.head.pitch = -.03 * b; p.aim = -.1 + .03 * b; return p; } },
  walk: { frames: 8, fps: 12, loop: true, pose: t => {
    const ph = t * TAU, p = ferBase(), st = 4.3, lf = 2.4;
    p.feet.L = V(-3.2, Math.max(0, Math.cos(ph)) * lf, st * Math.sin(ph)); p.feet.R = V(3.2, Math.max(0, -Math.cos(ph)) * lf, -st * Math.sin(ph));
    p.root.y = -.95 + .95 * Math.abs(Math.cos(ph)); p.pitch = .15; p.roll = .05 * Math.sin(ph); p.yaw = .07 * Math.sin(ph); p.aim = -.12; p.head.yaw = -.06 * Math.sin(ph); return p; } },
  attack: { frames: 6, fps: 16, pose: (t, f) => {
    const p = ferBase(); p.feet.L = V(-3.7, 0, 1.8); p.feet.R = V(3.7, 0, -1.6); p.aim = .02;
    p.recoil = [0, 2.3, 1.5, .8, .3, 0][f]; p.flash = [0, 1, .55, 0, 0, 0][f]; p.pitch = .04 - p.recoil * .03; p.root.z = -p.recoil * .25; return p; } },
  cast: { frames: 6, fps: 12, pose: t => {
    const p = ferBase(); p.gun = 'left'; p.feet.L = V(-3.4, 0, 2.6); p.feet.R = V(3.4, 0, -2.4);
    p.yaw = keys(t, [[0, 0], [.35, -.5], [.7, .38], [1, 0]]); p.pitch = keys(t, [[0, .05], [.35, -.08], [.7, .24], [1, .06]]);
    p.hands = { R: keys(t, [[0, V(5.5, 17, 3.5)], [.35, V(6, 27, -4)], [.7, V(3, 24, 10)], [1, V(5.5, 17, 4)]]) };
    p.grenade = t < .62 ? add(p.hands.R, V(0, 1.2, .6)) : null; p.head.pitch = keys(t, [[0, 0], [.35, .15], [.7, -.05], [1, 0]]); return p; } },
  hurt: { frames: 3, fps: 12, pose: (t, f) => {
    const k = [.55, 1, .4][f], p = ferBase(); p.pitch = .06 - .42 * k; p.root.z = -1.5 * k; p.root.y = -.5 * k; p.head.pitch = -.35 * k; p.aim = -.1 - .4 * k;
    p.tint = f === 0 ? 'rgba(255,255,255,.35)' : f === 1 ? 'rgba(255,60,50,.3)' : null; return p; } },
  death: { frames: 6, fps: 9, pose: t => {
    const p = ferBase(); p.feet.L = V(-3.6, 0, 1.6); p.feet.R = V(3.6, 0, -1.2);
    p.root.y = -keys(t, [[0, 0], [.3, 3.6], [1, 3.8]]); p.pitch = keys(t, [[0, .06], [.3, .25], [1, -.2]]); p.head.pitch = keys(t, [[0, 0], [1, -.5]]); p.aim = keys(t, [[0, -.1], [1, -.7]]);
    p.tilt = { pitch: -keys(t, [[0, 0], [.3, .08], [1, 1.3]]), roll: keys(t, [[0, 0], [.3, .05], [1, .75]]), pivot: V(0, 0, -1), lift: keys(t, [[0, 0], [1, 2.6]]) }; return p; } }
};

/* ======================= AETHER COVENANT: force caster ======================= */
const AET_SP = { hipH: 16, hipW: 2.6, thigh: 8.2, shin: 7.6, ankle: 1, torsoH: 16, shW: 6, upArm: 7, foreArm: 6.6, neck: 1, headR: 6.8 };
const AC = { robe: '#ece6f6', vio: '#b056f0', vioD: '#4f1f73', vioM: '#7a35b0', gold: '#f2c66d', skin: '#ecdcf3', face: '#120a1a', eye: '#ffd6ff', orb: '#c35cff' };
const AET_DEF = { L: V(-6.2, 15.5, 3.6), R: V(5.6, 17, 4.6) };
function aetBase() {
  return { root: V(0, 1, 0), pitch: .03, yaw: 0, roll: 0, feet: { L: V(-2.4, 0, .4), R: V(2.4, 0, -.4) }, head: { pitch: 0, yaw: 0 },
    hands: { L: AET_DEF.L, R: AET_DEF.R }, staffDir: V(-.06, 1, .1), sway: V(0, 0, -.6), orbOff: V(0, 3.4, 1.4), orbGlow: 1, staffGlow: .35, haloA: 1, hem: 1, flash: 0 };
}
function drawAether(po) {
  const sk = skel(AET_SP, po), { T, ax, ay, az } = sk, c = AC;
  const hemC = V(po.root.x + po.sway.x, .7, po.root.z + po.sway.z), waist = T(V(0, .5, 0));
  const H0 = Math.max(1, waist.y - hemC.y), rAt = h => lerp(10 * po.hem, 5.4, clamp01(h / H0));
  frustum(hemC, waist, 10 * po.hem, 5.4, c.robe, { folds: [.95, 1.35, 1.8, 2.2], foldCol: 'rgba(90,50,140,.24)', shadeBottom: 'rgba(60,20,90,.16)' });
  const k2 = 2.3 / H0;
  frustum(hemC, V(lerp(hemC.x, waist.x, k2), hemC.y + 2.3, lerp(hemC.z, waist.z, k2)), rAt(0) + .14, rAt(2.3) + .14, c.vio, { bias: .15 });
  const sw = po.sway;
  panel([T(V(-5.6, 14.6, -3.4)), T(V(5.6, 14.6, -3.4)), V(po.root.x + 8.8 + sw.x, 2.2, po.root.z - 6.8 + sw.z * 1.4), V(po.root.x - 8.8 + sw.x, 2.2, po.root.z - 6.8 + sw.z * 1.4)], c.vioM, c.vioD, { bias: -.4 });
  frustum(T(V(0, 0, 0)), T(V(0, 13.5, 0)), 5.1, 6.3, c.robe, { bias: .05 });
  frustum(T(V(0, 1.1, 0)), T(V(0, 3.4, 0)), 5.45, 5.7, c.vio, { bias: .12 });
  decal(circlePts(T(V(0, 2.25, 5.75)), ax, ay, 1.2), az, c.gold, { bias: .2 });
  frustum(T(V(0, 10.3, 0)), T(V(0, 16.4, 0)), 8.6, 4.6, c.vio, { bias: .25 });
  frustum(T(V(0, 10.0, 0)), T(V(0, 10.9, 0)), 8.75, 8.45, c.gold, { bias: .3 });
  for (const k of ['L', 'R']) {
    const A = sk.arms[k];
    capsule(A.sh, A.elbow, 2.4, 2.5, c.robe); capsule(A.elbow, A.hand, 2.5, 3.2, c.robe, { bias: .02 });
    capsule(lerpV(A.elbow, A.hand, .7), lerpV(A.elbow, A.hand, .98), 3.3, 3.4, c.vio, { bias: .05 });
    sphere(A.hand, 1.75, c.skin, { bias: .1 });
  }
  const H = sk.head;
  sphere(add(H.c, add(mul(H.f, -2.6), mul(H.u, .6))), 5.8, c.vioD, { bias: -.2 });
  sphere(H.c, 6.8, c.vioD);
  spherePatch(H.c, 6.9, H.f, H.r, H.u, -.62, .62, -.55, .42, c.face);
  if (facesCam(H.f) > .05) for (const s of [-1, 1]) { const e = add(H.c, add(add(mul(H.f, 6.6), mul(H.r, s * 1.9)), mul(H.u, .2))); sphere(e, .75, c.eye, { bias: .3 }); glow(e, 2, '#ff9cf0', .75, { front: true }); }
  spherePatch(H.c, 7.0, H.f, H.r, H.u, -.72, .72, .42, .56, c.vio, { bias: .07 });
  ring3(add(H.c, V(0, 9.6, 0)), 5.2, c.gold, .6, { glow: '#ffe7a3', ga: po.haloA });
  const sh = sk.arms.L.hand, sd = nrm(po.staffDir), top = add(sh, mul(sd, 21)), bot = add(sh, mul(sd, -14));
  capsule(bot, top, .8, .8, '#b38a52', { bias: .1 });
  capsule(add(top, mul(sd, -1.2)), add(top, mul(sd, .6)), 1.4, 1.4, c.gold, { bias: .15 });
  const cr = add(top, mul(sd, 3.2)); sphere(cr, 2.3, c.vio, { ky: 1.7, bias: .2 }); glow(cr, 5 + 3 * po.staffGlow, c.orb, .35 + .4 * po.staffGlow);
  const ob = add(sk.arms.R.hand, po.orbOff); sphere(ob, 2.5, '#f6e2ff', { bias: .3 }); glow(ob, 6.5 * po.orbGlow, c.orb, .8);
  if (po.flash) { glow(ob, 12 * po.flash, '#e6a8ff', .9, { front: true }); star(ob, 11 * po.flash, '#f3d9ff', po.flash, .6); }
  if (po.motes) for (const m of po.motes) glow(m.p, m.r, c.orb, m.a, { front: true });
  return { coreD: P(T(V(0, 6, 0))).d };
}
const AET_ANIMS = {
  idle: { frames: 6, fps: 7, loop: true, pose: t => {
    const b = Math.sin(t * TAU), p = aetBase(); p.root.y = 1 + .7 * b; p.sway = V(.4 * Math.sin(t * TAU + 1), 0, -.6);
    p.orbOff = V(Math.cos(t * TAU) * 1.3, 3.4 + .5 * Math.sin(t * 2 * TAU), 1.4 + Math.sin(t * TAU) * 1.3);
    p.hands = { L: add(AET_DEF.L, V(0, .3 * b, 0)), R: add(AET_DEF.R, V(0, .4 * b, 0)) }; p.staffGlow = .35 + .15 * b; return p; } },
  walk: { frames: 8, fps: 10, loop: true, pose: t => {
    const ph = t * TAU, p = aetBase(); p.root.y = 1 + .5 * Math.abs(Math.sin(ph)); p.pitch = .1; p.sway = V(.5 * Math.sin(ph), 0, -2 + .8 * Math.cos(2 * ph));
    p.hands = { R: V(5.8, 15.5 + 1.2 * Math.sin(ph), 3.6 + 2.4 * Math.sin(ph)), L: V(-6.2, 15.5, 3.6 + 2.2 * Math.sin(ph + Math.PI)) };
    p.staffDir = V(-.06, 1, .12 + .16 * Math.sin(ph + Math.PI)); p.head.yaw = .05 * Math.sin(ph); p.hem = 1.02; return p; } },
  attack: { frames: 6, fps: 15, pose: (t, f) => {
    const p = aetBase();
    p.hands = { L: AET_DEF.L, R: keys(t, [[0, AET_DEF.R], [.3, V(4.2, 19.5, 1.5)], [.55, V(2.5, 19, 12.5)], [1, AET_DEF.R]]) };
    p.orbOff = keys(t, [[0, V(0, 3.4, 1.4)], [.3, V(0, 3.2, 1)], [.55, V(0, 1.2, 4.5)], [1, V(0, 3.4, 1.4)]]);
    p.flash = [0, 0, 0, 1, .5, 0][f]; p.pitch = keys(t, [[0, .03], [.3, -.06], [.55, .18], [1, .03]]); p.orbGlow = keys(t, [[0, 1], [.55, 1.8], [1, 1]]); return p; } },
  cast: { frames: 6, fps: 11, pose: t => {
    const p = aetBase();
    p.hands = { L: keys(t, [[0, AET_DEF.L], [.4, V(-3.4, 30, 3.6)], [.75, V(-3, 31, 4)], [1, AET_DEF.L]]), R: keys(t, [[0, AET_DEF.R], [.4, V(3.4, 27, 3.4)], [.75, V(3.2, 28, 3.8)], [1, AET_DEF.R]]) };
    p.staffDir = V(0, 1, .05); p.root.y = keys(t, [[0, 1], [.4, 3.6], [.75, 3.8], [1, 1]]); p.staffGlow = keys(t, [[0, .35], [.45, 1.6], [.8, 1.3], [1, .35]]);
    p.haloA = keys(t, [[0, 1], [.5, 2.2], [1, 1]]); p.pitch = -.06; p.orbOff = keys(t, [[0, V(0, 3.4, 1.4)], [.5, V(-1, 5, 2)], [1, V(0, 3.4, 1.4)]]); p.sway = V(0, 0, -1.2); return p; } },
  hurt: { frames: 3, fps: 12, pose: (t, f) => {
    const k = [.55, 1, .4][f], p = aetBase(); p.pitch = .03 - .4 * k; p.root.z = -1.8 * k; p.head.pitch = -.3 * k; p.orbOff = V(.8 * k, 3.4, 1.4 - k);
    p.sway = V(0, 0, 1.2 * k); p.tint = f === 0 ? 'rgba(255,255,255,.35)' : f === 1 ? 'rgba(255,60,50,.3)' : null; return p; } },
  death: { frames: 6, fps: 8, pose: (t, f) => {
    const p = aetBase(); p.root.y = keys(t, [[0, 1], [.5, -5], [1, -7.5]]); p.hem = keys(t, [[0, 1], [1, 1.4]]); p.pitch = keys(t, [[0, .03], [1, .45]]); p.head.pitch = .6 * t;
    p.hands = { L: keys(t, [[0, AET_DEF.L], [1, V(-7, 6, 4)]]), R: keys(t, [[0, AET_DEF.R], [1, V(6, 6, 5)]]) }; p.staffGlow = .35 * (1 - t); p.orbGlow = keys(t, [[0, 1], [1, .2]]);
    p.alpha = [1, 1, .85, .62, .38, .14][f]; const R = rng(7 + f); p.motes = [];
    for (let i = 0; i < 9; i++) p.motes.push({ p: V(R() * 16 - 8, 6 + t * 30 + i * 3, R() * 10 - 5), r: 1.5 + R() * 1.5, a: .8 * (1 - t * .4) * (t > .1 ? 1 : 0) });
    return p; } }
};

/* ======================= CHROME HEGEMONY: siege cyborg ======================= */
const CHR_SP = { hipH: 15, hipW: 4.4, thigh: 7.6, shin: 7.4, ankle: 1.8, torsoH: 15.5, shW: 10.5, upArm: 6.6, foreArm: 6.6, neck: 1.2, headR: 4.4, headZ: .8 };
const CC = { steel: '#4b525c', steelD: '#353a42', steelL: '#6c7480', red: '#ff4a3d', dark: '#24282e', glow: '#ff5a46' };
const CHR_HAND = { L: V(-11, 9.5, 2.5), R: V(11, 9.5, 2.5) };
function chrBase() { return { root: V(0, 0, 0), pitch: .08, yaw: 0, roll: 0, feet: { L: V(-4.4, 0, .9), R: V(4.4, 0, -.9) }, head: { pitch: 0, yaw: 0 }, swing: { L: .08, R: .12 }, out: { L: .28, R: .22 }, cannonLen: 22, cannonPitch: .05, recoil: 0, flash: 0, core: .6, siege: 0, vent: 0 }; }
function drawChrome(po) {
  const sk = skel(CHR_SP, po), { T, ax, ay, az } = sk, c = CC;
  for (const k of ['L', 'R']) {
    const L = sk.legs[k], s = L.s;
    capsule(L.hip, L.knee, 3.3, 3.0, c.steelD); capsule(L.knee, L.foot, 3.1, 2.7, c.steel);
    const kd = nrm(sub(L.foot, L.knee)), kf = nrm(cross(kd, ax));
    box(add(L.knee, mul(kf, 1.8)), ax, ay, az, 2.5, 2.7, 1.3, c.steelL, { faces: { '+y': c.red }, bias: .3 });
    const g = L.ground, fy = rotY(V(0, 0, 1), (po.yaw || 0) * .3), fx = rotY(V(1, 0, 0), (po.yaw || 0) * .3);
    box(V(g.x, g.y + 1.6, g.z + 1.4), fx, V(0, 1, 0), fy, 3.1, 1.6, 4.4, c.dark, { faces: { '+y': c.steel } });
    if (po.siege > 0) {
      const top = add(L.knee, V(s * 2.2, -1, 0)), gp = V(L.knee.x + s * 7 * po.siege, 0, L.knee.z + (k === 'L' ? 2.5 : -2.5) * po.siege);
      capsule(top, lerpV(top, gp, Math.min(1, po.siege * 1.2)), 1.1, .6, '#2a2e35', { bias: .2 });
      if (po.siege > .6) glow(gp, 3, c.glow, .9 * po.siege);
    }
  }
  box(T(V(0, 0, 0)), ax, ay, az, 5.6, 3, 4.2, c.steelD);
  box(T(V(0, 4.9, 0)), ax, ay, az, 5, 2.7, 3.8, c.dark);
  box(T(V(0, 10.6, .4)), ax, ay, az, 9.2, 5.4, 6.2, c.steel, { faces: { '+y': c.steelL } });
  decal([T(V(-8.9, 6, 6.65)), T(V(-5.5, 6, 6.65)), T(V(-3, 15.6, 6.65)), T(V(-6.4, 15.6, 6.65))], az, c.red);
  decal([T(V(5.5, 6, 6.65)), T(V(8.9, 6, 6.65)), T(V(6.4, 15.6, 6.65)), T(V(3, 15.6, 6.65))], az, c.red);
  const core = T(V(0, 10.8, 6.68));
  decal(circlePts(core, ax, ay, 2.3, 6), az, '#3a0d0a'); decal(circlePts(core, ax, ay, 1.5, 6), az, c.glow, { bias: .1 });
  if (facesCam(az) > 0) glow(core, 4 + 3 * po.core, c.glow, .5 + .25 * po.core);
  const back = mul(az, -1);
  for (const s of [-1, 1]) { const vp = T(V(s * 4.5, 12, -5.85)); decal(circlePts(vp, ax, ay, 1.4, 8), back, '#1a1d22'); if (po.vent > 0 && facesCam(back) > 0) glow(vp, 3.5, '#ff8a5a', .5 * po.vent); }
  box(T(V(-4.6, 15.5, -7.6)), ax, ay, az, 4, 3.8, 2.2, c.steelD, { faces: { '+y': c.steel } });
  for (const [x, y] of [[-6.2, 17], [-3, 17], [-6.2, 14], [-3, 14]]) decal(circlePts(T(V(x, y, -9.85)), ax, ay, .9, 6), back, c.red);
  const H = sk.head;
  box(H.c, H.r, H.u, H.f, 3.6, 3.4, 4, '#3a3f48', { faces: { '+y': c.steelL } });
  const vs = add(H.c, mul(H.f, 4.05));
  decal([add(vs, add(mul(H.r, -2.9), mul(H.u, .2))), add(vs, add(mul(H.r, 2.9), mul(H.u, .2))), add(vs, add(mul(H.r, 2.6), mul(H.u, 1.3))), add(vs, add(mul(H.r, -2.6), mul(H.u, 1.3)))], H.f, c.glow);
  if (facesCam(H.f) > 0) glow(add(vs, mul(H.u, .7)), 3.6, c.glow, .6);
  const at = add(H.c, add(mul(H.u, 3.4), add(mul(H.r, -2.2), mul(H.f, -2)))), atTip = add(at, V(-.6, 6, -1));
  line3(at, atTip, c.dark, .4); glow(atTip, 1.4, c.glow, .8);
  for (const k of ['L', 'R']) {
    const A = sk.arms[k], s = A.s;
    box(add(A.sh, add(mul(ay, 1.8), mul(ax, s * .8))), ax, ay, az, 4.3, 2.7, 4.8, c.steelL, { faces: { '+y': c.red }, bias: .5 });
    capsule(A.sh, A.elbow, 2.7, 2.5, c.steelD); capsule(A.elbow, A.hand, 2.8, 3.1, c.steel);
    box(A.hand, ax, ay, az, 2.1, 2.1, 2.2, c.dark, { bias: .1 });
  }
  const ca = rotY(rotX(V(0, 0, 1), -(po.cannonPitch || 0)), po.yaw || 0), cx = nrm(cross(V(0, 1, 0), ca)), cy = cross(ca, cx);
  const cb = sub(T(V(8.4, 19.4, .6)), mul(ca, po.recoil || 0)), L = po.cannonLen;
  box(add(cb, mul(ca, -1.5)), cx, cy, ca, 3.4, 3.4, 3.6, c.steelD, { faces: { '+y': c.steel }, bias: .6 });
  box(add(cb, mul(ca, L * .32)), cx, cy, ca, 2.5, 2.5, L * .42, '#2c3138', { faces: { '+y': '#454c56' }, bias: .62 });
  const mz = add(cb, mul(ca, L * .74)); capsule(mz, add(mz, mul(ca, 1.4)), 2.9, 2.9, c.red, { bias: .65 });
  const tip = add(mz, mul(ca, 2)); glow(tip, 2.2, c.glow, .7);
  if (po.flash) { glow(tip, 11 * po.flash, '#ffb070', .95, { front: true }); star(tip, 13 * po.flash, '#ffd9a8', po.flash, .2); }
  if (po.sparks) for (const s of po.sparks) glow(s, 2.4, '#ffd27a', .95, { front: true });
  return { coreD: P(T(V(0, 8, 0))).d };
}
function siegeStance(p, k) {
  p.feet.L = V(-4.4 - 4.6 * k, 0, .9 + 1.4 * k); p.feet.R = V(4.4 + 4.6 * k, 0, -.9 - 1.4 * k);
  p.root.y = -3.2 * k; p.siege = k; p.cannonLen = 22 + 12 * k; p.cannonPitch = .05 + .1 * k; p.pitch = .08 + .05 * k; p.core = .6 + .6 * k; p.out = { L: .28 + .3 * k, R: .22 + .3 * k };
  return p;
}
const CHR_ANIMS = {
  idle: { frames: 6, fps: 7, loop: true, pose: t => { const b = Math.sin(t * TAU), p = chrBase(); p.root.y = -.3 + .3 * b; p.pitch = .07 + .01 * b; p.core = .55 + .3 * (.5 + .5 * b); p.head.yaw = .07 * Math.sin(t * TAU); return p; } },
  walk: { frames: 8, fps: 11, loop: true, pose: t => {
    const ph = t * TAU, p = chrBase(), st = 4.6, lf = 2.2;
    p.feet.L = V(-4.3, Math.max(0, Math.cos(ph)) * lf, st * Math.sin(ph)); p.feet.R = V(4.3, Math.max(0, -Math.cos(ph)) * lf, -st * Math.sin(ph));
    p.root.y = -1.3 + 1.3 * Math.abs(Math.cos(ph)); p.pitch = .14; p.roll = .05 * Math.sin(ph); p.swing = { L: .38 * Math.sin(ph), R: -.3 * Math.sin(ph) }; p.vent = .8; return p; } },
  attack: { frames: 6, fps: 15, pose: (t, f) => {
    const p = chrBase(); p.recoil = [0, 3.4, 2, .9, .3, 0][f]; p.flash = [0, 1, .5, 0, 0, 0][f]; p.pitch = .08 - p.recoil * .025; p.root.z = -p.recoil * .25; p.cannonPitch = .04;
    p.feet.L = V(-4.6, 0, 1.6); p.feet.R = V(4.6, 0, -1.6); return p; } },
  cast: { frames: 6, fps: 11, pose: t => {
    const p = chrBase();
    p.hands = { L: keys(t, [[0, CHR_HAND.L], [.4, V(-13, 23, 5)], [.75, V(-13.5, 24, 5.5)], [1, CHR_HAND.L]]), R: keys(t, [[0, CHR_HAND.R], [.4, V(13, 23, 5)], [.75, V(13.5, 24, 5.5)], [1, CHR_HAND.R]]) };
    p.core = keys(t, [[0, .6], [.45, 2.4], [.8, 2], [1, .6]]); p.root.y = keys(t, [[0, 0], [.3, -1.6], [.6, .5], [1, 0]]); p.vent = keys(t, [[0, 0], [.5, 1.4], [1, 0]]);
    p.head.pitch = keys(t, [[0, 0], [.5, -.2], [1, 0]]); return p; } },
  hurt: { frames: 3, fps: 12, pose: (t, f) => {
    const k = [.55, 1, .4][f], p = chrBase(); p.pitch = .08 - .35 * k; p.root.z = -1.3 * k; p.head.pitch = -.3 * k;
    p.sparks = f === 1 ? [V(4, 22, 5), V(-6, 14, 5.5)] : null; p.tint = f === 0 ? 'rgba(255,255,255,.35)' : f === 1 ? 'rgba(255,60,50,.3)' : null; return p; } },
  death: { frames: 6, fps: 9, pose: (t, f) => {
    const p = chrBase(); p.root.y = -keys(t, [[0, 0], [.35, 4.5], [1, 4.8]]); p.pitch = keys(t, [[0, .08], [.35, .3], [1, .1]]); p.head.pitch = .4 * t;
    p.tilt = { pitch: keys(t, [[0, 0], [.35, .1], [1, 1.25]]), roll: keys(t, [[0, 0], [.35, -.05], [1, -.7]]), pivot: V(0, 0, 1.5), lift: keys(t, [[0, 0], [1, 3]]) };
    p.core = keys(t, [[0, .6], [.5, 1.5], [1, 0]]); const R = rng(11 + f);
    p.sparks = f >= 1 && f <= 4 ? [V(R() * 16 - 8, 10 + R() * 14, R() * 8), V(R() * 16 - 8, 8 + R() * 14, R() * 8)] : null; return p; } },
  siege_deploy: { frames: 6, fps: 12, pose: t => siegeStance(chrBase(), ease(t)) },
  siege_idle: { frames: 4, fps: 6, loop: true, pose: t => { const p = siegeStance(chrBase(), 1), b = Math.sin(t * TAU); p.core = 1 + .3 * b; p.root.y += .2 * b; return p; } },
  siege_fire: { frames: 6, fps: 14, pose: (t, f) => { const p = siegeStance(chrBase(), 1); p.recoil = [0, 5.5, 3, 1.4, .5, 0][f]; p.flash = [0, 1.25, .6, 0, 0, 0][f]; p.root.z = -p.recoil * .15; p.core = 1.4; return p; } }
};

/* ======================= FERROS BATTLE MECH ======================= */
const MECH_SP = { hipH: 31, hipW: 9.5, thigh: 15, shin: 16.5, ankle: 3, torsoH: 16, shW: 19.5, upArm: 6, foreArm: 6, neck: 0, headR: 0 };
const MC = { blue: '#3d8bff', navy: '#1d3f7a', body: '#56637a', bodyD: '#3a4352', joint: '#2b323e', dark: '#232a35', glass: '#1fb8d8', cyan: '#38e8ff', white: '#e4eaf2' };
function mechBase() { return { root: V(0, 0, 0), pitch: .04, yaw: 0, roll: 0, feet: { L: V(-10, 0, 2), R: V(10, 0, -2) }, head: {}, recoil: { L: 0, R: 0 }, flash: { L: 0, R: 0 }, thr: .5, aimP: .02, kneePole: s => V(s * .1, 0, -1) }; }
function drawMech(po) {
  const sk = skel(MECH_SP, po), { T, ax, ay, az } = sk, c = MC;
  for (const k of ['L', 'R']) {
    const L = sk.legs[k], s = L.s;
    capsule(L.hip, L.knee, 4.6, 4.0, c.bodyD);
    const u = nrm(sub(L.hip, L.knee)), w = nrm(cross(ax, u));
    box(add(lerpV(L.hip, L.knee, .45), mul(ax, s * 2.6)), ax, u, w, 2.2, 6.2, 4.6, c.blue, { faces: { '+y': tone(c.blue, .2) }, bias: .2 });
    capsule(L.knee, L.foot, 4.0, 3.4, c.body); sphere(L.knee, 4.6, c.joint, { bias: .25 });
    const u2 = nrm(sub(L.knee, L.foot)), w2 = nrm(cross(ax, u2));
    box(add(lerpV(L.knee, L.foot, .5), mul(w2, 3)), ax, u2, w2, 3.4, 6.5, 1.4, c.navy, { bias: .3 });
    sphere(L.foot, 3, c.joint, { bias: .1 });
    const g = L.ground, fy = rotY(V(0, 0, 1), (po.yaw || 0) * .3), fx = rotY(V(1, 0, 0), (po.yaw || 0) * .3);
    box(V(g.x, g.y + 2.2, g.z + 2.4), fx, V(0, 1, 0), fy, 5.4, 2.2, 7.6, c.dark, { faces: { '+y': c.bodyD, '+z': c.navy } });
  }
  box(T(V(0, 0, 0)), ax, ay, az, 10.5, 4.5, 8, c.joint);
  box(T(V(0, 11, .5)), ax, ay, az, 15.5, 6.5, 12.5, c.body, { faces: { '+y': c.bodyD } });
  box(T(V(0, 21.5, -1.5)), ax, ay, az, 11.5, 5, 10.5, c.body, { faces: { '+y': c.blue } });
  decal([T(V(15.55, 6, -9)), T(V(15.55, 6, 9)), T(V(15.55, 15.5, 9)), T(V(15.55, 15.5, -9))], ax, c.blue);
  decal([T(V(-15.55, 6, 9)), T(V(-15.55, 6, -9)), T(V(-15.55, 15.5, -9)), T(V(-15.55, 15.5, 9))], mul(ax, -1), c.blue);
  decal([T(V(11.55, 18, -8)), T(V(11.55, 18, 6)), T(V(11.55, 24, 6)), T(V(11.55, 24, -8))], ax, c.navy);
  decal([T(V(-11.55, 18, 6)), T(V(-11.55, 18, -8)), T(V(-11.55, 24, -8)), T(V(-11.55, 24, 6))], mul(ax, -1), c.navy);
  decal([T(V(-15.5, 5.2, 13.05)), T(V(15.5, 5.2, 13.05)), T(V(15.5, 7.6, 13.05)), T(V(-15.5, 7.6, 13.05))], az, c.navy);
  decal([T(V(-8.5, 17.4, 9.05)), T(V(8.5, 17.4, 9.05)), T(V(7, 25.2, 9.05)), T(V(-7, 25.2, 9.05))], az, c.glass);
  decal([T(V(-7.6, 23.6, 9.1)), T(V(-2, 23.6, 9.1)), T(V(-2.5, 25, 9.1)), T(V(-6.8, 25, 9.1))], az, 'rgba(220,252,255,.7)', { bias: .12 });
  decal(circlePts(T(V(0, 20.6, 9.1)), ax, ay, 2.8), az, c.white, { bias: .1 });
  decal(circlePts(T(V(.6, 20.9, 9.15)), ax, ay, 1.5, 8), az, '#0b5a78', { bias: .14 });
  if (facesCam(az) > 0) { glow(T(V(0, 21, 9.2)), 9, c.cyan, .25); for (const s of [-1, 1]) { const hl = T(V(s * 11.5, 10.5, 13.1)); decal(circlePts(hl, ax, ay, 1.6), az, '#e8fbff', { bias: .12 }); glow(hl, 4, c.cyan, .6); } }
  for (const s of [-1, 1]) { capsule(T(V(s * 7, 25, -12)), T(V(s * 7, 9, -14.5)), 3.8, 3.3, c.bodyD, { bias: -.2 }); glow(T(V(s * 7, 6.5, -15)), 4 + 3 * po.thr, c.cyan, .45 + .35 * po.thr); }
  const an = T(V(-8, 40, -9)); line3(T(V(-8, 26, -8)), an, c.dark, .9); glow(an, 2.4, '#ff5a46', .85);
  for (const k of ['L', 'R']) {
    const s = k === 'L' ? -1 : 1, S = T(V(s * 19.5, 13, 1)); sphere(S, 4.8, c.joint, { bias: .1 });
    const ca = rotY(rotX(V(0, 0, 1), -(po.aimP || 0)), po.yaw || 0), cx = nrm(cross(V(0, 1, 0), ca)), cy = cross(ca, cx);
    const cc = sub(add(S, mul(ca, 5)), mul(ca, po.recoil[k]));
    box(cc, cx, cy, ca, 4.4, 5, 12, c.dark, { faces: { '+y': c.blue }, bias: .3 });
    box(add(cc, add(mul(cx, s * 4.5), mul(ca, -2))), cx, cy, ca, .6, 3, 7, c.navy, { bias: .31 });
    for (const o of [-1.9, 1.9]) capsule(add(cc, add(mul(ca, 11), mul(cy, o))), add(cc, add(mul(ca, 20), mul(cy, o))), 1.6, 1.5, '#8d99aa', { bias: .32 });
    const mz = add(cc, mul(ca, 20.8)); glow(add(mz, mul(cy, 1.9)), 2, c.cyan, .7); glow(add(mz, mul(cy, -1.9)), 2, c.cyan, .7);
    if (po.flash[k]) { glow(mz, 13 * po.flash[k], '#a8d6ff', .95, { front: true }); star(mz, 14 * po.flash[k], '#e0f4ff', po.flash[k], .4); }
  }
  return { coreD: P(T(V(0, 14, 0))).d };
}
const MECH_ANIMS = {
  idle: { frames: 6, fps: 6, loop: true, pose: t => { const b = Math.sin(t * TAU), p = mechBase(); p.root.y = -.7 + .7 * b; p.pitch = .04 + .01 * b; p.thr = .4 + .2 * b; return p; } },
  walk: { frames: 8, fps: 9, loop: true, pose: t => {
    const ph = t * TAU, p = mechBase(), st = 8.5, lf = 5.2;
    p.feet.L = V(-10, Math.max(0, Math.cos(ph)) * lf, st * Math.sin(ph)); p.feet.R = V(10, Math.max(0, -Math.cos(ph)) * lf, -st * Math.sin(ph));
    p.root.y = -3.2 + 3.2 * Math.abs(Math.cos(ph)); p.pitch = .1; p.roll = .05 * Math.sin(ph); p.yaw = .04 * Math.sin(ph); p.thr = .9; return p; } },
  attack: { frames: 6, fps: 14, pose: (t, f) => {
    const p = mechBase(); p.recoil = { L: [0, 3.2, 1.6, .6, .2, 0][f], R: [0, 0, .3, 3.2, 1.6, .4][f] }; p.flash = { L: [0, 1, .4, 0, 0, 0][f], R: [0, 0, 0, 1, .4, 0][f] };
    p.aimP = .03; p.root.z = -(p.recoil.L + p.recoil.R) * .15; return p; } },
  hurt: { frames: 3, fps: 12, pose: (t, f) => { const k = [.55, 1, .4][f], p = mechBase(); p.pitch = .04 - .25 * k; p.root.z = -2 * k; p.tint = f === 0 ? 'rgba(255,255,255,.3)' : f === 1 ? 'rgba(255,60,50,.25)' : null; return p; } }
};

const RIGS = {
  ferros: { fw: 160, fh: 160, ox: 80, oy: 116, sc: 2, draw: drawFerros, anims: FER_ANIMS },
  aether: { fw: 160, fh: 160, ox: 80, oy: 116, sc: 2, draw: drawAether, anims: AET_ANIMS },
  chrome: { fw: 160, fh: 160, ox: 80, oy: 116, sc: 2, draw: drawChrome, anims: CHR_ANIMS },
  mech: { fw: 208, fh: 208, ox: 104, oy: 176, sc: 2, draw: drawMech, anims: MECH_ANIMS }
};

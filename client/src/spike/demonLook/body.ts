// SPIKE (#379): the demon's skeleton and its shapes. Left is +x, up +y, the front +z; about 2.7 units tall to the crown.
// The bind pose stands upright with the arms a little out and the wings spread; every stance is bone turns on top (pose.ts).
import * as THREE from 'three';
import { ball, cone, field, kite, skin, slab, type Prim, type Tag, type V } from './sdf';
import { on } from './opts';

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mx = (s: number, v: V): V => [s * v[0], v[1], v[2]];

// Joints of the left side; the right side is the mirror.
const S: V = [0.45, 2.07, -0.03], E: V = [0.69, 1.57, -0.03], W: V = [0.87, 1.04, 0], KN: V = [0.92, 0.85, 0];
const HP: V = [0.22, 1.24, 0], KNEE: V = [0.3, 0.72, 0.12], AN: V = [0.3, 0.28, -0.1], BA: V = [0.31, 0.07, 0.1];
const TAIL: V[] = on('tail')
  ? [[0, 1.2, -0.2], [0, 1.02, -0.52], [0, 0.74, -0.86], [0, 0.47, -1.2], [0, 0.3, -1.62], [0, 0.36, -2.15]]
  : [[0, 1.2, -0.2], [0, 1.02, -0.5], [0, 0.75, -0.8], [0, 0.5, -1.08], [0, 0.32, -1.38], [0, 0.3, -1.7]];
const TAIL_R = on('tail') ? [0.15, 0.115, 0.08, 0.05, 0.026, 0.003] : [0.15, 0.12, 0.09, 0.065, 0.04, 0.008];
/** The left horn's middle line and its radius there, base to tip (the paint follows it too). */
export const HORN_PATH: [V, number][] = [[[0.1, 2.56, 0.12], 0.125], [[0.3, 2.5, 0.2], 0.122], [[0.5, 2.45, 0.27], 0.112], [[0.68, 2.47, 0.3], 0.097], [[0.8, 2.58, 0.28], 0.08], [[0.86, 2.74, 0.22], 0.058], [[0.86, 2.9, 0.16], 0.034], [[0.82, 3.05, 0.11], 0.008]];
// The wing arm, as a bat's: shoulder, a short upper arm to the elbow, a long forearm up to the wrist; HM and FM bow the two bones.
const WR: V = [0.2, 2.15, -0.2], WE: V = [1.05, 2.55, -0.55], WW: V = [1.2, 3.8, -0.5], WHIP: V = [0.22, 1.35, -0.24];
const HM: V = [0.62, 2.4, -0.4], FM: V = [1.16, 3.18, -0.55];
/** The four wing fingers: the middle joint and the tip. */
const FINGER: [V, V][] = [
  [[2.25, 3.6, -0.68], [2.8, 2.35, -0.62]],
  [[1.95, 2.95, -0.72], [2.32, 1.55, -0.66]],
  [[1.56, 2.6, -0.74], [1.76, 1.0, -0.7]],
  [[1.22, 2.45, -0.7], [1.16, 0.95, -0.6]],
];
/** The left half of the mouth's line, from the middle of the muzzle to the corner turned up in the cheek. */
const SMILE: V[] = [[0, 2.352, 0.365], [0.05, 2.358, 0.35], [0.088, 2.39, 0.3], [0.112, 2.445, 0.235]];
export const EYE: V = [0.078, 2.495, 0.32], MOUTH: V = [0, 2.365, 0.36];

const DEFS: [string, string | null, V][] = [
  ['hips', null, [0, 1.3, -0.04]], ['waist', 'hips', [0, 1.5, -0.03]], ['chest', 'waist', [0, 1.74, -0.03]],
  ['neck', 'chest', [0, 2.2, 0]], ['head', 'neck', [0, 2.38, 0.06]], ['jaw', 'head', [0, 2.37, 0.16]],
  ...TAIL.slice(0, 5).map((p, i): [string, string, V] => [`tail${i}`, i ? `tail${i - 1}` : 'hips', p]),
];
for (const [side, s] of [['L', 1], ['R', -1]] as const) {
  const d = (n: string, p: string, v: V) => DEFS.push([n + side, p, mx(s, v)]);
  d('clav', 'chest', [0.14, 2.06, 0]); d('upperArm', 'clav' + side, S); d('foreArm', 'upperArm' + side, E); d('hand', 'foreArm' + side, W); d('fingers', 'hand' + side, KN);
  d('thigh', 'hips', HP); d('shin', 'thigh' + side, KNEE); d('foot', 'shin' + side, AN); d('toes', 'foot' + side, BA);
  d('wing1', 'chest', WR); d('wing2', 'wing1' + side, WE);
  FINGER.forEach((f, i) => { d(`wf${i}a`, 'wing2' + side, WW); d(`wf${i}b`, `wf${i}a` + side, f[0]); });
}

export interface Rig { root: THREE.Bone; bones: THREE.Bone[]; by: Record<string, THREE.Bone>; skeleton: THREE.Skeleton; id: (n: string) => number }
export function rig(): Rig {
  const by: Record<string, THREE.Bone> = {}, bones: THREE.Bone[] = [], world: Record<string, V> = {};
  for (const [name, parent, p] of DEFS) {
    const b = new THREE.Bone();
    b.name = name; b.rotation.order = 'YXZ';
    const pp: V = parent ? world[parent] : [0, 0, 0];
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (parent) by[parent].add(b);
    by[name] = b; world[name] = p; bones.push(b);
  }
  by.hips.updateMatrixWorld(true);
  return { root: by.hips, bones, by, skeleton: new THREE.Skeleton(bones), id: (n) => { const i = DEFS.findIndex((d) => d[0] === n); if (i < 0) throw new Error(n); return i; } };
}

const norm = (v: V): V => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A plate given by its own x axis and its normal. */
function plate(c: V, h: V, xa: V, za: V, bone: number, tag: Tag, k = 0.005, round = 0.006): Prim {
  const z = norm(za), d = dot(xa, z), x = norm([xa[0] - z[0] * d, xa[1] - z[1] * d, xa[2] - z[2] * d]), y = cross(z, x);
  return { a: c, ra: 0, rb: 0, k, bone, tag, c, br: Math.hypot(h[0], h[1], h[2]) + round, box: { h, m: [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]], round } };
}
interface Ray { o: V; d: V; bone: number; size: number }
/**
 * Armour down the spine: chevrons (two arms meeting in a point that aims at the tail), each lapping over the next, as wide as
 * `size` says at that place. The rays find the surface of `base` along the middle line.
 */
function chevrons(base: Prim[], rays: Ray[], tag: Tag): Prim[] {
  const pts: { p: V; ray: Ray }[] = [];
  for (const ray of rays) for (let t = 0; t < 1.4; t += 0.003) {
    const p: V = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
    if (field(base, p[0], p[1], p[2]) < 0) { pts.push({ p, ray }); break; }
  }
  const out: Prim[] = [], A = 0.62, e = 0.01;
  let next = 0, s = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const { p, ray } = pts[i], q = pts[i - 1].p;
    s += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (s < next) continue;
    const L = ray.size; next = s + L * 0.72;
    const T = norm([0, pts[i + 1].p[1] - q[1], pts[i + 1].p[2] - q[2]]);
    const N = norm([0, field(base, p[0], p[1] + e, p[2]) - field(base, p[0], p[1] - e, p[2]), field(base, p[0], p[1], p[2] + e) - field(base, p[0], p[1], p[2] - e)]);
    const nz: V = norm([N[0] - 0.3 * T[0], N[1] - 0.3 * T[1], N[2] - 0.3 * T[2]]);
    for (const side of [1, -1]) {
      const dir = norm([side * Math.cos(A), -T[1] * Math.sin(A) - N[1] * 0.3, -T[2] * Math.sin(A) - N[2] * 0.3]);
      const lift = 0.006 + 0.1 * L;
      const c: V = [p[0] + N[0] * lift + dir[0] * L * 0.5, p[1] + N[1] * lift + dir[1] * L * 0.5, p[2] + N[2] * lift + dir[2] * L * 0.5];
      out.push(plate(c, [L * 0.6, L * 0.3, 0.008 + 0.07 * L], dir, nz, ray.bone, tag));
    }
  }
  return out;
}
const PLATE: Tag = [0, 0.9, 0, 0];

/** The tail: its own skin, long and thin to a point, with the spine's chevrons running on to the tip. */
function tailPrims(id: (n: string) => number): Prim[] {
  const P: Prim[] = [];
  for (let i = 0; i < 5; i++) P.push(cone(TAIL[i], TAIL[i + 1], TAIL_R[i], TAIL_R[i + 1], id(`tail${i}`), i === 4 ? [0, 1, 1, 0] : [0, 0, 0, 0.3], 0.05));
  if (!on('spine')) return P;
  const rays: Ray[] = [];
  for (let i = 0; i < 5; i++) for (let f = i ? 0 : 0.45; f < (i === 4 ? 0.55 : 1); f += 0.02) {
    const p = lerp(TAIL[i], TAIL[i + 1], f), T = norm([0, TAIL[i + 1][1] - TAIL[i][1], TAIL[i + 1][2] - TAIL[i][2]]), U: V = [0, -T[2], T[1]];
    const r = TAIL_R[i] + (TAIL_R[i + 1] - TAIL_R[i]) * f;
    rays.push({ o: [0, p[1] + U[1] * 0.4, p[2] + U[2] * 0.4], d: [0, -U[1], -U[2]], bone: id(`tail${i}`), size: 0.85 * r + 0.012 });
  }
  return [...P, ...chevrons(P, rays, PLATE)];
}

function prims(id: (n: string) => number): Prim[] {
  const sk = (glow: number, dark = 0): Tag => [glow, 0, 0, dark];
  const HORN: Tag = [0, 1, 0, 0], TIP: Tag = [0, 1, 1, 0];
  const P: Prim[] = [
    ball([0, 1.28, -0.03], [on('slim') ? 0.265 : 0.31, 0.19, 0.21], id('hips'), sk(0.3, 0.1)),
    ball([0, 1.55, 0.01], [on('slim') ? 0.24 : 0.29, 0.25, 0.2], id('waist'), sk(0.8)),
    ball([0, 1.9, -0.02], [0.35, 0.34, 0.25], id('chest'), sk(1)),
    ball([0, 2.11, -0.1], [0.35, 0.16, 0.19], id('chest'), sk(0.2)),
    cone([0, 2.16, 0], [0, 2.4, 0.08], 0.17, 0.14, id('neck'), sk(0.3)),
    ball([0, 2.5, 0.12], [0.175, 0.18, 0.2], id('head'), sk(0.1)),
    { ...cone([0, 2.34, 0.3], [0, 2.2, 0.37], 0.06, 0.012, id('jaw'), sk(0), 0.02), wr: 0.02 },
    cone([0, 2.66, 0.24], [0, 2.93, 0.17], 0.07, 0.008, id('head'), HORN, 0.015),
    { ...ball([0, 2.43, 0.27], [0.095, 0.075, 0.1], id('head'), sk(0), 0.04), wr: 0.02 },
    { ...ball([0, 2.335, 0.24], [0.095, 0.045, 0.11], id('jaw'), sk(0), 0.02), wr: 0.02 },
    { ...ball([0, 2.365, on('teeth') ? 0.29 : 0.31], on('teeth') ? [0.075, 0.018, 0.1] : [0.085, 0.02, 0.13], 0, sk(0), 0.01), sub: true },
  ];
  // the grin: the mouth's line runs round the muzzle and turns up into the cheeks
  if (on('teeth')) for (const s of [1, -1]) for (let i = 0; i + 1 < SMILE.length; i++) P.push({ ...cone(mx(s, SMILE[i]), mx(s, SMILE[i + 1]), 0.015, i === 2 ? 0.006 : 0.015, 0, sk(0), 0.008), sub: true });
  for (const s of [1, -1]) {
    const n = (name: string) => id(name + (s > 0 ? 'L' : 'R'));
    const m = (v: V) => mx(s, v);
    const c = (a: V, b: V, ra: number, rb: number, bone: string, tag: Tag, k?: number) => P.push(cone(m(a), m(b), ra, rb, n(bone), tag, k));
    const e = (a: V, r: V, bone: string, tag: Tag, k?: number) => P.push(ball(m(a), r, n(bone), tag, k));
    P.push({ ...cone(m([0.04, 2.478, 0.325]), m([0.115, 2.512, 0.3]), 0.014, 0.018, 0, sk(0), 0.012), sub: true });
    P.push(ball(m([0.17, 2.0, 0.14]), [0.2, 0.16, 0.11], id('chest'), sk(1)), ball(m([0.26, 1.82, -0.1]), [0.15, 0.28, 0.16], id('chest'), sk(0.3)));
    const eb = (a: V, r: V, bone: string, tag: Tag, k?: number) => P.push(ball(m(a), r, id(bone), tag, k));
    if (on('traps')) { eb([0.17, 2.2, -0.08], [0.2, 0.115, 0.14], 'chest', sk(0.3), 0.05); P.push(cone(m([0.07, 2.37, -0.04]), m([0.37, 2.14, -0.07]), 0.105, 0.095, id('chest'), sk(0.3), 0.05)); }
    if (on('muscle')) {
      const um = lerp(S, E, 0.5), th = (f: number) => lerp(HP, KNEE, f), cf = lerp(KNEE, AN, 0.28);
      e(add(S, [0.07, -0.06, 0]), [0.12, 0.16, 0.13], 'upperArm', sk(0.4), 0.02);
      e(add(um, [-0.01, 0.02, 0.085]), [0.085, 0.16, 0.075], 'upperArm', sk(0.25), 0.02);
      e(add(um, [0.03, 0.04, -0.085]), [0.08, 0.15, 0.07], 'upperArm', sk(0.1), 0.02);
      e(add(lerp(E, W, 0.25), [0.05, 0, 0.03]), [0.075, 0.15, 0.07], 'foreArm', sk(0.2, 0.1), 0.02);
      eb([0.17, 1.97, 0.17], [0.17, 0.12, 0.085], 'chest', sk(1), 0.015);
      eb([0.075, 1.72, 0.175], [0.07, 0.055, 0.045], 'chest', sk(1), 0.015);
      eb([0.075, 1.6, 0.185], [0.07, 0.055, 0.045], 'waist', sk(0.9), 0.015);
      eb([0.072, 1.48, 0.18], [0.065, 0.055, 0.045], 'waist', sk(0.8), 0.015);
      eb([on('slim') ? 0.195 : 0.24, 1.62, 0.08], [0.08, 0.13, 0.1], 'waist', sk(0.5), 0.02);
      e(add(th(0.55), [0.09, 0, 0.06]), [0.085, 0.2, 0.09], 'thigh', sk(0.15, 0.2), 0.02);
      e(add(th(0.8), [-0.07, 0, 0.07]), [0.07, 0.11, 0.07], 'thigh', sk(0.15, 0.2), 0.02);
      e(add(th(0.45), [0, 0, 0.12]), [0.08, 0.2, 0.07], 'thigh', sk(0.15, 0.2), 0.02);
      e(add(cf, [0.045, 0, -0.09]), [0.06, 0.13, 0.07], 'shin', sk(0.05, 0.5), 0.02);
      e(add(cf, [-0.045, 0, -0.09]), [0.06, 0.13, 0.07], 'shin', sk(0.05, 0.5), 0.02);
      eb(add(HP, [0.02, 0.05, -0.16]), [0.13, 0.14, 0.1], 'hips', sk(0.1, 0.1), 0.03);
    }
    // arm
    const mid = lerp(S, E, 0.5);
    e(add(S, [0.02, 0, 0]), [0.165, 0.17, 0.165], 'upperArm', sk(0.4));
    c(S, E, 0.15, 0.115, 'upperArm', sk(0.25));
    e(add(mid, [0, 0.03, 0.07]), [0.11, 0.2, 0.1], 'upperArm', sk(0.25));
    e(add(mid, [0.02, 0, -0.07]), [0.1, 0.2, 0.09], 'upperArm', sk(0.1));
    c(add(S, [0.07, 0.11, -0.05]), add(S, [0.19, 0.28, -0.12]), 0.05, 0.006, 'upperArm', HORN, 0.04);
    c(add(E, [0.02, 0, -0.1]), add(E, [0.07, 0.08, -0.27]), 0.05, 0.006, 'upperArm', HORN, 0.03);
    c(E, W, 0.125, 0.08, 'foreArm', sk(0.2, 0.1));
    e(add(lerp(E, W, 0.3), [0.03, 0, 0]), [0.12, 0.19, 0.12], 'foreArm', sk(0.2, 0.1));
    e(add(W, [0.03, -0.1, 0]), [0.07, 0.1, 0.055], 'hand', sk(0.1, 0.2), 0.03);
    for (const z of [-0.066, -0.022, 0.022, 0.066]) {
      const k0: V = [KN[0], KN[1], z], p1 = add(k0, [0.02, -0.11, 0]), p2 = add(p1, [-0.01, -0.1, 0]);
      c(add(W, [0.03, -0.12, z * 0.6]), k0, 0.04, 0.034, 'hand', sk(0, 0.3), 0.02);
      c(k0, p1, 0.034, 0.03, 'fingers', sk(0, 0.4), 0.015); c(p1, p2, 0.03, 0.024, 'fingers', sk(0, 0.5), 0.015);
      c(p2, add(p2, [-0.04, -0.13, 0]), 0.022, 0.004, 'fingers', TIP, 0.01);
    }
    const t0 = add(W, [-0.03, -0.08, 0.07]), t1 = add(t0, [-0.05, -0.1, 0.05]);
    c(t0, t1, 0.036, 0.028, 'hand', sk(0, 0.4), 0.02); c(t1, add(t1, [-0.03, -0.1, 0.02]), 0.024, 0.004, 'hand', TIP, 0.01);
    // leg
    P.push(ball(m(add(HP, [0.02, 0.02, -0.12])), [0.17, 0.17, 0.14], id('hips'), sk(0.1, 0.1)));
    c(HP, KNEE, 0.21, 0.14, 'thigh', sk(0.15, 0.2));
    e(add(lerp(HP, KNEE, 0.4), [0.02, 0, 0.08]), [0.15, 0.24, 0.13], 'thigh', sk(0.15, 0.2));
    e(add(KNEE, [0, 0, 0.06]), [0.09, 0.1, 0.07], 'shin', sk(0, 0.4), 0.04);
    c(KNEE, AN, 0.125, 0.075, 'shin', sk(0.05, 0.5));
    e(add(lerp(KNEE, AN, 0.3), [0, 0, -0.07]), [0.1, 0.17, 0.1], 'shin', sk(0.05, 0.5));
    c(AN, BA, 0.075, 0.085, 'foot', sk(0, 0.7));
    c(add(AN, [0, 0, -0.05]), add(AN, [0, 0.03, -0.2]), 0.045, 0.006, 'foot', HORN, 0.03);
    for (const yaw of [-0.35, 0.1, 0.55]) {
      const d: V = [Math.sin(yaw), 0, Math.cos(yaw)];
      const tip: V = [BA[0] + d[0] * 0.2, 0.05, BA[2] + d[2] * 0.2];
      c(BA, tip, 0.065, 0.05, 'toes', sk(0, 0.8), 0.03);
      c(tip, [BA[0] + d[0] * 0.36, 0.012, BA[2] + d[2] * 0.36], 0.04, 0.005, 'toes', TIP, 0.015);
    }
    // horns: very thick at the base, out and a little forward and down, then bending up to a point
    const horn = HORN_PATH;
    for (let i = 0; i + 1 < horn.length; i++) P.push(cone(m(horn[i][0]), m(horn[i + 1][0]), horn[i][1], horn[i + 1][1], id('head'), i > 5 ? TIP : HORN, 0.02));
    // armour over the forehead and crown: a crest of tall kites up the middle, each lapping over the next toward the back, its
    // lowest point between the eyes; rows of kites beside it running onto the horns' bases; and a heavy brow plate over each
    // eye, low at the middle and rising outward, whose edge leaves the eye a slit
    const C: V = [0, 2.5, 0.12];
    const rows: [number, [number, number, number][]][] = [
      [0, [[0.08, 0.06, 0.075], [0.5, 0.085, 0.115], [0.95, 0.08, 0.11], [1.4, 0.07, 0.1], [1.85, 0.06, 0.09]]],
      [0.55, [[0.75, 0.07, 0.1], [1.2, 0.07, 0.095], [1.65, 0.065, 0.09], [2.1, 0.06, 0.085]]],
      [1.0, [[1.0, 0.06, 0.085], [1.5, 0.06, 0.085], [2.0, 0.055, 0.08]]],
    ];
    for (const [phi, plates] of rows) {
      if (phi === 0 && s < 0) continue;
      for (const [th, hw, hh] of plates) {
        const d: V = [Math.sin(phi), Math.cos(phi) * Math.sin(th), Math.cos(phi) * Math.cos(th)];
        P.push(kite(m([C[0] + d[0] * 0.185, C[1] + d[1] * 0.19, C[2] + d[2] * 0.21]), [hw, hh, 0.02], [-th + 0.26, s * phi, s * phi * 0.4], id('head'), sk(0)));
      }
    }
    P.push(slab(m([0.115, 2.592, 0.25]), [0.1, 0.055, 0.018], [-0.35, s * 0.4, s * 0.45], id('head'), sk(0)));
    P.push(slab(m([0.125, 2.42, 0.25]), [0.045, 0.06, 0.02], [0, s * 0.95, s * -0.25], id('head'), sk(0)));
  }
  if (on('spine')) {
    const size = (y: number) => { const t: [number, number][] = [[2.62, 0.05], [2.32, 0.06], [2.16, 0.11], [1.92, 0.16], [1.62, 0.12], [1.46, 0.12]]; let i = 0; while (i < t.length - 2 && y < t[i + 1][0]) i++; const f = Math.min(1, Math.max(0, (t[i][0] - y) / (t[i][0] - t[i + 1][0]))); return t[i][1] + (t[i + 1][1] - t[i][1]) * f; };
    const rays: Ray[] = [];
    for (let y = 2.6; y > 1.47; y -= 0.008) rays.push({ o: [0, y, -0.9], d: [0, 0, 1], bone: id(y > 2.38 ? 'head' : y > 2.2 ? 'neck' : y > 1.74 ? 'chest' : 'waist'), size: size(y) });
    P.push(...chevrons(P.filter((p) => !p.sub), rays, PLATE));
  }
  return P;
}

type Wt = [number, number][];
class Buf {
  pos: number[] = []; idx: number[] = []; uv: number[] = []; info: number[] = []; si: number[] = []; sw: number[] = [];
  get n() { return this.pos.length / 3; }
  push(p: THREE.Vector3, u: number, v: number, tag: Tag, w: Wt) {
    this.pos.push(p.x, p.y, p.z); this.uv.push(u, v); this.info.push(...tag);
    const top = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, e) => s + e[1], 0);
    for (let c = 0; c < 4; c++) { this.si.push(top[c]?.[0] ?? 0); this.sw.push((top[c]?.[1] ?? 0) / sum); }
  }
  geometry(): THREE.BufferGeometry {
    return geometry(new Float32Array(this.pos), new Uint32Array(this.idx), new Float32Array(this.info), new Uint16Array(this.si), new Float32Array(this.sw), new Float32Array(this.uv));
  }
}
function geometry(pos: Float32Array, idx: Uint32Array, info: Float32Array, si: Uint16Array, sw: Float32Array, uv?: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/** A curve through joints; each stretch between two joints follows one bone, blending into its neighbour near a joint. */
function chain(pts: V[], bones: number[], last?: (f: number) => Wt) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  const n = pts.length - 1;
  return {
    n, curve,
    at(u: number): { p: THREE.Vector3; w: Wt } {
      const seg = Math.min(n - 1, Math.floor(u * n)), f = u * n - seg;
      let w: Wt = [[bones[seg], 1]];
      if (last && seg === n - 1) w = last(f);
      else if (f < 0.3 && seg > 0) { const a = 0.5 * (1 - f / 0.3); w = [[bones[seg], 1 - a], [bones[seg - 1], a]]; }
      else if (f > 0.7 && seg < n - 1 && !last) { const a = (0.5 * (f - 0.7)) / 0.3; w = [[bones[seg], 1 - a], [bones[seg + 1], a]]; }
      return { p: curve.getPoint(u), w };
    },
  };
}

function tube(b: Buf, pts: V[], radii: number[], bones: number[], tag: (u: number) => Tag, rings = 8, radial = 10) {
  const ch = chain(pts, bones), total = ch.n * rings, v0 = b.n;
  const N = new THREE.Vector3(), Bn = new THREE.Vector3(), q = new THREE.Vector3();
  for (let r = 0; r <= total; r++) {
    const u = r / total, { p, w } = ch.at(u), T = ch.curve.getTangent(u);
    const seg = Math.min(ch.n - 1, Math.floor(u * ch.n)), f = u * ch.n - seg, rad = radii[seg] + (radii[seg + 1] - radii[seg]) * f;
    N.crossVectors(T, Math.abs(T.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)).normalize(); Bn.crossVectors(T, N);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      q.copy(p).addScaledVector(N, Math.cos(a) * rad).addScaledVector(Bn, Math.sin(a) * rad);
      b.push(q, u, j / radial, tag(u), w);
    }
    if (r) for (let j = 0; j < radial; j++) {
      const a = v0 + (r - 1) * radial + j, c = v0 + (r - 1) * radial + ((j + 1) % radial);
      b.idx.push(a, c, a + radial, c, c + radial, a + radial);
    }
  }
}

type Curve = { at(u: number): { p: THREE.Vector3; w: Wt } };
function sheet(b: Buf, A: Curve, B: Curve, panel: number, scallop: number, bulge: number, NS = 40, NT = 44) {
  const v0 = b.n;
  for (let it = 0; it <= NT; it++) for (let is = 0; is <= NS; is++) {
    const s = is / NS, t = it / NT, tt = t * (1 - scallop * Math.sin(Math.PI * s));
    const a = A.at(tt), c = B.at(tt), p = a.p.lerp(c.p, s);
    p.z -= bulge * Math.sin(Math.PI * s) * t;
    b.push(p, panel + s, t, [0, 0, 0, 0], [...a.w.map(([i, w]): [number, number] => [i, w * (1 - s)]), ...c.w.map(([i, w]): [number, number] => [i, w * s])]);
  }
  for (let it = 0; it < NT; it++) for (let is = 0; is < NS; is++) {
    const a = v0 + it * (NS + 1) + is;
    b.idx.push(a, a + 1, a + NS + 1, a + 1, a + NS + 2, a + NS + 1);
  }
}

export interface Built { body: THREE.BufferGeometry; tail: THREE.BufferGeometry; tubes: THREE.BufferGeometry; web: THREE.BufferGeometry; cloth: THREE.BufferGeometry; ms: number; verts: number }
export function build(r: Rig): Built {
  const t0 = performance.now();
  const sk = skin(prims(r.id), [-1.2, -0.06, -0.5], [1.2, 3.12, 0.7], 0.008);
  const body = geometry(sk.position, sk.index, sk.info, sk.skinIndex, sk.skinWeight);

  const tubes = new Buf(), web = new Buf(), cloth = new Buf();
  const LEATHER: Tag = [2, 0, 0, 0];
  const tk = skin(tailPrims(r.id), [-0.3, 0, -2.3], [0.3, 1.5, -0.05], 0.008);
  const tail = geometry(tk.position, tk.index, tk.info, tk.skinIndex, tk.skinWeight);
  // the strap round the hips that the cloth hangs from
  const strap: V[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; strap.push([(on('slim') ? 0.262 : 0.3) * Math.sin(a), 1.41 - 0.035 * Math.cos(a), 0.225 * Math.cos(a) - 0.01]); }
  tube(tubes, strap, strap.map(() => 0.04), strap.slice(1).map(() => r.id('hips')), () => LEATHER, 3, 8);
  // teeth: pointed fangs along the grin, the upper ones on the skull, the lower ones on the jaw, meshing when the mouth shuts
  if (on('teeth')) for (const s of [1, -1]) {
    const at = (t: number): V => { const f = Math.min(2.999, t * 3), i = Math.floor(f); return lerp(SMILE[i], SMILE[i + 1], f - i); };
    const tooth = (t: number, up: boolean, len: number) => {
      const p = at(t), n = norm([p[0], 0, p[2] - 0.2]), dy = up ? 1 : -1;
      const base: V = [s * (p[0] - n[0] * 0.017), p[1] + dy * 0.02, p[2] - n[2] * 0.017], tip: V = [s * (p[0] - n[0] * 0.006), p[1] - dy * len, p[2] - n[2] * 0.006];
      tube(tubes, [base, tip], [0.013 + len * 0.1, 0.0012], [r.id(up ? 'head' : 'jaw')], () => [1, 1, 0, 0], 4, 7);
    };
    [[0.07, 0.03], [0.24, 0.034], [0.42, 0.056], [0.58, 0.036], [0.73, 0.03], [0.87, 0.024]].forEach(([t, l]) => { if (s > 0 || t > 0.02) tooth(t, true, l); });
    [[0.155, 0.03], [0.33, 0.046], [0.5, 0.034], [0.655, 0.03], [0.8, 0.024]].forEach(([t, l]) => tooth(t, false, l));
  }
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const n = (name: string) => r.id(name + side), m = (v: V) => mx(s, v);
    const w1 = n('wing1'), w2 = n('wing2');
    // bones with thick joint ends: upper arm, forearm, thumb claw, and fingers with a knuckle
    tube(tubes, [WR, HM, WE].map(m), [0.1, 0.06, 0.085], [w1, w1], () => LEATHER, 8, 10);
    tube(tubes, [WE, FM, WW].map(m), [0.09, 0.05, 0.075], [w2, w2], () => LEATHER, 8, 10);
    tube(tubes, [WW, add(WW, [0.06, 0.2, 0.08]), add(WW, [0.02, 0.4, 0.14])].map(m), [0.05, 0.03, 0.004], [w2, w2], (u) => [1, 1, u > 0.7 ? 1 : 0, 0], 4, 8);
    const fingers = FINGER.map((f, i) => {
      const pts = [WW, lerp(WW, f[0], 0.5), f[0], lerp(f[0], f[1], 0.5), f[1]].map(m), a = n(`wf${i}a`), b = n(`wf${i}b`);
      pts[1][1] += 0.04; pts[3][0] += s * 0.05;
      tube(tubes, pts, [0.055, 0.028, 0.04, 0.02, 0.005], [a, a, b, b], () => LEATHER, 6, 8);
      return chain(pts, [a, a, b, b]);
    });
    for (let i = 0; i < 3; i++) sheet(web, fingers[i], fingers[i + 1], i, 0.2, 0.07);
    const arm = [WW, FM, WE, HM, WR].map(m);
    sheet(web, fingers[3], chain([...arm, m(WHIP)], [w2, w2, w1, w1, r.id('chest')], (f) => [[r.id('chest'), 1 - f], [r.id('hips'), f]]), 3, 0.12, 0.05);
    // the skin in front of the elbow, from the shoulder to the wrist
    sheet(web, chain([...arm].reverse(), [w1, w1, w2, w2]), chain([WR, [0.74, 2.95, -0.38], WW].map(m), [w1, w2]), 4, 0, 0, 8, 24);
  }
  // loincloth, front and back: hangs from the hips
  const hips: Wt = [[r.id('hips'), 1]];
  for (const [z, panel] of [[0.235, 0], [-0.25, 1]] as const) {
    const v0 = cloth.n, NS = 12, NT = 22;
    for (let it = 0; it <= NT; it++) for (let is = 0; is <= NS; is++) {
      const s = is / NS, t = it / NT, half = 0.17 - 0.05 * t, x = (s * 2 - 1) * half;
      cloth.push(new THREE.Vector3(x, 1.4 - 0.86 * t, z + Math.sign(z) * (0.03 * Math.sin(t * 2.5) - 1.6 * x * x * (1 - t))), panel + s, t, [0, 0, 0, 0], hips);
    }
    for (let it = 0; it < NT; it++) for (let is = 0; is < NS; is++) { const a = v0 + it * (NS + 1) + is; cloth.idx.push(a, a + 1, a + NS + 1, a + 1, a + NS + 2, a + NS + 1); }
  }
  return { body, tail, tubes: tubes.geometry(), web: web.geometry(), cloth: cloth.geometry(), ms: performance.now() - t0, verts: sk.position.length / 3 };
}

// The demon's skeleton and its shapes (spike #379, moved here by #442). Left is +x, up +y, the front +z; about 2.7 units tall to the crown.
// The bind pose stands upright with the arms a little out and the wings spread. Every part is built here, ahead of time, into a
// `SkinPart` (build-demon-skin.ts writes them to a file); no browser is needed.
import * as THREE from 'three/webgpu';
import { ball, blade as bladePlate, cone, field, kite, outline, skin, slab, type Prim, type Tag, type V } from './sdf';

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mx = (s: number, v: V): V => [s * v[0], v[1], v[2]];

// Joints of the left side; the right side is the mirror.
const S: V = [0.45, 2.07, -0.03], E: V = [0.69, 1.57, -0.03], W: V = [0.87, 1.04, 0], KN: V = [0.92, 0.85, 0];
const HP: V = [0.22, 1.24, 0], KNEE: V = [0.3, 0.72, 0.12], AN: V = [0.3, 0.28, -0.1], BA: V = [0.31, 0.07, 0.1];
const TAIL5: V[] = [[0, 1.2, -0.2], [0, 1.02, -0.52], [0, 0.74, -0.86], [0, 0.47, -1.2], [0, 0.3, -1.62], [0, 0.36, -2.15]];
const TAIL_R5 = [0.15, 0.115, 0.08, 0.05, 0.026, 0.003];
// a supple tail has twice the joints: a joint more in the middle of every stretch, on a smooth curve through the old ones
const TAIL: V[] = [], TAIL_R: number[] = [];
for (let i = 0; i < 6; i++) {
  TAIL.push(TAIL5[i]); TAIL_R.push(TAIL_R5[i]);
  if (i === 5) continue;
  const a = TAIL5[Math.max(0, i - 1)], b = TAIL5[i], c = TAIL5[i + 1], e = TAIL5[Math.min(5, i + 2)];
  TAIL.push([0, (-a[1] + 9 * b[1] + 9 * c[1] - e[1]) / 16, (-a[2] + 9 * b[2] + 9 * c[2] - e[2]) / 16]); TAIL_R.push((TAIL_R5[i] + TAIL_R5[i + 1]) / 2);
}
/** How many joints the tail has. */
export const TAIL_N = TAIL.length - 1;
/** The outlines of the two blades in the body's middle plane, as [z, y] points: the crest on the head, the blade at the tail's end. */
export const CREST: [number, number][] = [], TAIL_BLADE: [number, number][] = [];
{
  // the crest: a row of teeth raked back, each taller than the one before, the last a long hooked point
  const sk = (th: number, r: number): [number, number] => [0.12 + 0.21 * r * Math.cos(th), 2.5 + 0.19 * r * Math.sin(th)];
  const rake = [-0.42, 0.91], teeth: [number, number, number][] = [[0.3, 0.72, 0.06], [0.72, 1.12, 0.1], [1.12, 1.56, 0.155], [1.56, 2.1, 0.25]];
  CREST.push(sk(0.25, 1));
  for (const [a, b, h] of teeth) {
    const up = (th: number, f: number): [number, number] => { const q = sk(th, 1.1); return [q[0] + rake[0] * h * f, q[1] + rake[1] * h * f]; };
    CREST.push(up(a + (b - a) * 0.4, 0.62), up(b - 0.04, 1), up(b + 0.03, 0.42));
  }
  CREST.push(sk(2.35, 1), sk(2.2, 0.7), sk(1.3, 0.7), sk(0.4, 0.7));
  // the tail's blade: a barbed spearhead of bone, long and drawn out to a needle point
  const A = TAIL5[4], Z = TAIL5[5], L = Math.hypot(Z[1] - A[1], Z[2] - A[2]), dz = (Z[2] - A[2]) / L, dy = (Z[1] - A[1]) / L;
  const at = (s: number, w: number): [number, number] => [A[2] + dz * (0.3 * L + s) - dy * w, A[1] + dy * (0.3 * L + s) + dz * w];
  for (const [s, w] of [[0, 0.014], [0.035, 0.03], [-0.04, 0.092], [0.09, 0.082], [0.22, 0.052], [0.36, 0.024], [0.52, 0], [0.36, -0.022], [0.22, -0.046], [0.09, -0.07], [-0.03, -0.078], [0.035, -0.028], [0, -0.014]]) TAIL_BLADE.push(at(s, w));
}
/** The left horn's middle line and its radius there, base to tip (the paint follows it too). */
export const HORN_PATH: [V, number][] = [[[0.1, 2.56, 0.12], 0.125], [[0.3, 2.5, 0.2], 0.122], [[0.5, 2.45, 0.27], 0.112], [[0.68, 2.47, 0.3], 0.097], [[0.8, 2.58, 0.28], 0.08], [[0.86, 2.74, 0.22], 0.058], [[0.86, 2.9, 0.16], 0.034], [[0.82, 3.05, 0.11], 0.008]];
// The wing arm, as a bat's: shoulder, a short upper arm to the elbow, a long forearm up to the wrist; HM and FM bow the two bones.
const WR: V = [0.2, 2.15, -0.2], WE: V = [1.05, 2.55, -0.55], WW: V = [1.2, 3.8, -0.5], WHIP: V = [0.22, 1.35, -0.24];
const HM: V = [0.62, 2.4, -0.4], FM: V = [1.16, 3.18, -0.55];
/** The hand's four fingers, index to little: knuckle, two joints and the claw's point; each has its own length, the knuckles lie on an arc and the fingers fan a little. */
export const DIGITS: V[][] = [-0.066, -0.022, 0.022, 0.066].map((z, i) => {
  const len = [0.94, 1.08, 1.0, 0.8][3 - i], fan = z * 0.22, k0: V = [KN[0], KN[1] + [0.004, -0.012, -0.005, 0.014][3 - i], z];
  const p1 = add(k0, [0.02 * len, -0.11 * len, fan]), p2 = add(p1, [-0.01 * len, -0.1 * len, fan]);
  return [k0, p1, p2, add(p2, [-0.04 * len, -0.13 * len, fan * 0.5])];
});
const THUMB: V[] = [add(W, [-0.03, -0.08, 0.07]), add(W, [-0.08, -0.18, 0.12]), add(W, [-0.11, -0.28, 0.14])];
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

/** A broken shackle on the left forearm (in the forearm bone's space) and the first link of the chain that hangs from it. */
const CUFF_AT: V = [0.15, -0.44, 0.025], CUFF_ALONG: V = [0.18, -0.53, 0.03], HANG_AT: V = add(CUFF_AT, [-0.1, 0, 0.03]);
const CHAIN_LINKS = 6;

/** Every bone: name, parent, bind position in the model's space. Parents come before their children. */
export const BONE_DEFS: readonly [name: string, parent: string | null, at: V][] = (() => {
  const D: [string, string | null, V][] = [
    ['hips', null, [0, 1.3, -0.04]], ['waist', 'hips', [0, 1.5, -0.03]], ['chest', 'waist', [0, 1.74, -0.03]],
    ['neck', 'chest', [0, 2.2, 0]], ['head', 'neck', [0, 2.38, 0.06]], ['jaw', 'head', [0, 2.37, 0.16]],
    ...TAIL.slice(0, TAIL_N).map((p, i): [string, string, V] => [`tail${i}`, i ? `tail${i - 1}` : 'hips', p]),
  ];
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const d = (n: string, p: string, v: V) => D.push([n + side, p, mx(s, v)]);
    d('clav', 'chest', [0.14, 2.06, 0]); d('upperArm', 'clav' + side, S); d('foreArm', 'upperArm' + side, E); d('hand', 'foreArm' + side, W); d('fingers', 'hand' + side, KN);
    DIGITS.forEach((f, i) => { d(`f${i}a`, 'hand' + side, f[0]); d(`f${i}b`, `f${i}a` + side, f[1]); d(`f${i}c`, `f${i}b` + side, f[2]); });
    d('th0', 'hand' + side, THUMB[0]); d('th1', 'th0' + side, THUMB[1]);
    d('thigh', 'hips', HP); d('shin', 'thigh' + side, KNEE); d('foot', 'shin' + side, AN); d('toes', 'foot' + side, BA);
    d('wing1', 'chest', WR); d('wing2', 'wing1' + side, WE);
    FINGER.forEach((f, i) => { d(`wf${i}a`, 'wing2' + side, WW); d(`wf${i}b`, `wf${i}a` + side, f[0]); });
  }
  // the chain's links hang one from the other, the first from the left forearm
  for (let i = 0; i < CHAIN_LINKS; i++) D.push([`chain${i}`, i ? `chain${i - 1}` : 'foreArmL', add(add(E, HANG_AT), [0, -0.03 - 0.075 * i, 0])]);
  return D;
})();
export const BONES = BONE_DEFS.length;
export const B: Record<string, number> = Object.fromEntries(BONE_DEFS.map((d, i) => [d[0], i]));
const id = (n: string): number => { const i = B[n]; if (i === undefined) throw new Error(n); return i; };

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
function tailPrims(): Prim[] {
  const P: Prim[] = [];
  const N = TAIL_N, last = id(`tail${N - 1}`);
  for (let i = 0; i < N; i++) P.push(cone(TAIL[i], TAIL[i + 1], TAIL_R[i], TAIL_R[i + 1], id(`tail${i}`), i >= N - N / 5 ? [0, 1, 0, 0] : [0, 0, 0, 0.3], 0.05));
  P.push(bladePlate(TAIL_BLADE, 0.007, 0.024, 0.05, last, [0, 1, 0, 0], 0.012));
  const rays: Ray[] = [], base = P.filter((q) => !q.poly);
  for (let i = 0; i < N; i++) for (let f = 0; f < 1; f += 0.02 * N / 5) {
    if ((i + f) / N < 0.09 || (i + f) / N > 0.91) continue;
    const p = lerp(TAIL[i], TAIL[i + 1], f), T = norm([0, TAIL[i + 1][1] - TAIL[i][1], TAIL[i + 1][2] - TAIL[i][2]]), U: V = [0, -T[2], T[1]];
    const r = TAIL_R[i] + (TAIL_R[i + 1] - TAIL_R[i]) * f;
    rays.push({ o: [0, p[1] + U[1] * 0.4, p[2] + U[2] * 0.4], d: [0, -U[1], -U[2]], bone: id(`tail${i}`), size: 0.85 * r + 0.012 });
  }
  return [...P, ...chevrons(base, rays, PLATE)];
}

function prims(): Prim[] {
  const sk = (glow: number, dark = 0): Tag => [glow, 0, 0, dark];
  const HORN: Tag = [0, 1, 0, 0], TIP: Tag = [0, 1, 1, 0];
  const P: Prim[] = [
    ball([0, 1.28, -0.03], [0.265, 0.19, 0.21], id('hips'), sk(0.3, 0.1)),
    ball([0, 1.55, 0.01], [0.24, 0.25, 0.2], id('waist'), sk(0.8)),
    ball([0, 1.9, -0.02], [0.35, 0.34, 0.25], id('chest'), sk(1)),
    ball([0, 2.11, -0.1], [0.35, 0.16, 0.19], id('chest'), sk(0.2)),
    cone([0, 2.16, 0], [0, 2.4, 0.08], 0.17, 0.14, id('neck'), sk(0.3)),
    ball([0, 2.5, 0.12], [0.175, 0.18, 0.2], id('head'), sk(0.1)),
    { ...cone([0, 2.34, 0.3], [0, 2.2, 0.37], 0.06, 0.012, id('jaw'), sk(0), 0.02), wr: 0.02 },
    { ...ball([0, 2.43, 0.27], [0.095, 0.075, 0.1], id('head'), sk(0), 0.04), wr: 0.02 },
    { ...ball([0, 2.335, 0.24], [0.095, 0.045, 0.11], id('jaw'), sk(0), 0.02), wr: 0.02 },
    { ...ball([0, 2.365, 0.29], [0.075, 0.018, 0.1], 0, sk(0), 0.01), sub: true },
  ];
  // the crest: an arrowhead of a plate standing on the middle of the head, rising from the forehead back and up to a point
  P.push(bladePlate(CREST, 0.007, 0.022, 0.045, id('head'), HORN, 0.012));
  // the grin: the mouth's line runs round the muzzle and turns up into the cheeks
  for (const s of [1, -1]) for (let i = 0; i + 1 < SMILE.length; i++) P.push({ ...cone(mx(s, SMILE[i]), mx(s, SMILE[i + 1]), 0.015, i === 2 ? 0.006 : 0.015, 0, sk(0), 0.008), sub: true });
  for (const s of [1, -1]) {
    const n = (name: string) => id(name + (s > 0 ? 'L' : 'R'));
    const m = (v: V) => mx(s, v);
    const c = (a: V, b: V, ra: number, rb: number, bone: string, tag: Tag, k?: number) => P.push(cone(m(a), m(b), ra, rb, n(bone), tag, k));
    const e = (a: V, r: V, bone: string, tag: Tag, k?: number) => P.push(ball(m(a), r, n(bone), tag, k));
    P.push({ ...cone(m([0.04, 2.478, 0.325]), m([0.115, 2.512, 0.3]), 0.007, 0.009, 0, sk(0), 0.012), sub: true });
    P.push(ball(m([0.17, 2.0, 0.14]), [0.2, 0.16, 0.11], id('chest'), sk(1)), ball(m([0.26, 1.82, -0.1]), [0.15, 0.28, 0.16], id('chest'), sk(0.3)));
    const eb = (a: V, r: V, bone: string, tag: Tag, k?: number) => P.push(ball(m(a), r, id(bone), tag, k));
    eb([0.17, 2.2, -0.08], [0.2, 0.115, 0.14], 'chest', sk(0.3), 0.05); P.push(cone(m([0.07, 2.37, -0.04]), m([0.37, 2.14, -0.07]), 0.105, 0.095, id('chest'), sk(0.3), 0.05));
    {
      const um = lerp(S, E, 0.5), th = (f: number) => lerp(HP, KNEE, f), cf = lerp(KNEE, AN, 0.28);
      e(add(S, [0.07, -0.06, 0]), [0.12, 0.16, 0.13], 'upperArm', sk(0.4), 0.02);
      e(add(um, [-0.01, 0.02, 0.085]), [0.085, 0.16, 0.075], 'upperArm', sk(0.25), 0.02);
      e(add(um, [0.03, 0.04, -0.085]), [0.08, 0.15, 0.07], 'upperArm', sk(0.1), 0.02);
      e(add(lerp(E, W, 0.25), [0.05, 0, 0.03]), [0.075, 0.15, 0.07], 'foreArm', sk(0.2, 0.1), 0.02);
      eb([0.17, 1.97, 0.17], [0.17, 0.12, 0.085], 'chest', sk(1), 0.015);
      eb([0.075, 1.72, 0.175], [0.07, 0.055, 0.045], 'chest', sk(1), 0.015);
      eb([0.075, 1.6, 0.185], [0.07, 0.055, 0.045], 'waist', sk(0.9), 0.015);
      eb([0.072, 1.48, 0.18], [0.065, 0.055, 0.045], 'waist', sk(0.8), 0.015);
      eb([0.195, 1.62, 0.08], [0.08, 0.13, 0.1], 'waist', sk(0.5), 0.02);
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
    for (const [a, b] of [[[0.06, 2.3, 0.31], [0.085, 2.235, 0.345]], [[0.092, 2.31, 0.24], [0.14, 2.25, 0.255]], [[0.09, 2.325, 0.17], [0.15, 2.28, 0.15]]] as [V, V][])
      P.push({ ...cone(m(a), m(b), 0.02, 0.003, id('jaw'), HORN, 0.01), wr: 0.02 });
    c(add(E, [0.02, 0, -0.1]), add(E, [0.07, 0.08, -0.27]), 0.05, 0.006, 'upperArm', HORN, 0.03);
    c(E, W, 0.125, 0.08, 'foreArm', sk(0.2, 0.1));
    e(add(lerp(E, W, 0.3), [0.03, 0, 0]), [0.12, 0.19, 0.12], 'foreArm', sk(0.2, 0.1));
    e(add(W, [0.03, -0.1, 0]), [0.07, 0.1, 0.055], 'hand', sk(0.1, 0.2), 0.03);
    for (let fi = 0; fi < 4; fi++) {
      const [k0, p1, p2, p3] = DIGITS[fi], z = k0[2], fa = `f${fi}a`, fb = `f${fi}b`, fc = `f${fi}c`;
      c(add(k0, [0.01, 0.01, 0]), add(k0, [0.075, 0.035, 0]), 0.022, 0.003, 'hand', HORN, 0.012);
      c(add(W, [0.03, -0.12, z * 0.6]), k0, 0.04, 0.034, 'hand', sk(0, 0.3), 0.02);
      c(k0, p1, 0.034, 0.03, fa, sk(0, 0.4), 0.015); c(p1, p2, 0.03, 0.024, fb, sk(0, 0.5), 0.015);
      c(p2, p3, 0.022, 0.004, fc, TIP, 0.01);
    }
    c(THUMB[0], THUMB[1], 0.036, 0.028, 'th0', sk(0, 0.4), 0.02); c(THUMB[1], THUMB[2], 0.024, 0.004, 'th1', TIP, 0.01);
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
  {
    const size = (y: number) => { const t: [number, number][] = [[2.62, 0.05], [2.32, 0.06], [2.16, 0.11], [1.92, 0.16], [1.62, 0.12], [1.46, 0.12]]; let i = 0; while (i < t.length - 2 && y < t[i + 1][0]) i++; const f = Math.min(1, Math.max(0, (t[i][0] - y) / (t[i][0] - t[i + 1][0]))); return t[i][1] + (t[i + 1][1] - t[i][1]) * f; };
    const rays: Ray[] = [];
    for (let y = 2.6; y > 1.47; y -= 0.008) rays.push({ o: [0, y, -0.9], d: [0, 0, 1], bone: id(y > 2.38 ? 'head' : y > 2.2 ? 'neck' : y > 1.74 ? 'chest' : 'waist'), size: size(y) });
    P.push(...chevrons(P.filter((p) => !p.sub), rays, PLATE));
  }
  return P;
}

/**
 * One part of the figure, ready to skin. Positions are in the model's bind pose; `info` is [open, horn, tip, dark] (the leather
 * tag puts 2 in x); each point hangs on up to four bones.
 */
export interface SkinPart {
  position: Float32Array; normal: Float32Array; info: Float32Array; uv: Float32Array | null; skinIndex: Uint8Array; skinWeight: Float32Array; index: Uint32Array;
  /** body only: the first `solid` indices are everything but the crystal parts. */
  solid?: number;
}
export interface DemonSkin { body: SkinPart; tail: SkinPart; tubes: SkinPart; web: SkinPart; cloth: SkinPart; blade: SkinPart; iron: SkinPart }

/** Area-weighted point normals, step for step as three's `computeVertexNormals` (same float roundings). */
function normalsOf(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const cbx = pos[c] - pos[b], cby = pos[c + 1] - pos[b + 1], cbz = pos[c + 2] - pos[b + 2];
    const abx = pos[a] - pos[b], aby = pos[a + 1] - pos[b + 1], abz = pos[a + 2] - pos[b + 2];
    const x = cby * abz - cbz * aby, y = cbz * abx - cbx * abz, z = cbx * aby - cby * abx;
    for (const v of [a, b, c]) { n[v] += x; n[v + 1] += y; n[v + 2] += z; }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.sqrt(n[v] * n[v] + n[v + 1] * n[v + 1] + n[v + 2] * n[v + 2]) || 1, k = 1 / l;
    n[v] *= k; n[v + 1] *= k; n[v + 2] *= k;
  }
  return n;
}
function part(position: Float32Array, index: Uint32Array, info: Float32Array, si: ArrayLike<number>, skinWeight: Float32Array, uv: Float32Array | null, normal = normalsOf(position, index)): SkinPart {
  return { position, normal, info, uv, skinIndex: Uint8Array.from(si), skinWeight, index };
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
  part(): SkinPart {
    return part(new Float32Array(this.pos), new Uint32Array(this.idx), new Float32Array(this.info), this.si, new Float32Array(this.sw), new Float32Array(this.uv));
  }
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
function sheet(b: Buf, A: Curve, Bc: Curve, panel: number, scallop: number, bulge: number, NS = 40, NT = 44) {
  const v0 = b.n;
  for (let it = 0; it <= NT; it++) for (let is = 0; is <= NS; is++) {
    const s = is / NS, t = it / NT, tt = t * (1 - scallop * Math.sin(Math.PI * s));
    const a = A.at(tt), c = Bc.at(tt), p = a.p.lerp(c.p, s);
    p.z -= bulge * Math.sin(Math.PI * s) * t;
    b.push(p, panel + s, t, [0, 0, 0, 0], [...a.w.map(([i, w]): [number, number] => [i, w * (1 - s)]), ...c.w.map(([i, w]): [number, number] => [i, w * s])]);
  }
  for (let it = 0; it < NT; it++) for (let is = 0; is < NS; is++) {
    const a = v0 + it * (NS + 1) + is;
    b.idx.push(a, a + 1, a + NS + 1, a + 1, a + NS + 2, a + NS + 1);
  }
}

/** Moves the triangles that are crystal (horn-tagged, not the spine's plates, the crest or the tail's blade) behind the rest; returns the new index and where they start. */
function splitCrystal(position: Float32Array, info: Float32Array, index: Uint32Array): { index: Uint32Array; solid: number } {
  const flat = (v: number) => Math.abs(position[v * 3]) <= 0.03 + 0.01;
  const onBlade = (v: number, pts: [number, number][]) => flat(v) && outline(pts, position[v * 3 + 2], position[v * 3 + 1]) < 0.01;
  const crystal = (t: number): boolean => {
    const v = [index[t], index[t + 1], index[t + 2]];
    if (!v.every((i) => info[i * 4 + 1] > 0.5)) return false;
    // the plates are tagged 0.9, a horn 1: a triangle with no point above that is armour
    if (!v.some((i) => info[i * 4 + 1] > 0.95)) return false;
    return !v.every((i) => onBlade(i, CREST)) && !v.every((i) => onBlade(i, TAIL_BLADE));
  };
  const rest: number[] = [], last: number[] = [];
  for (let t = 0; t < index.length; t += 3) (crystal(t) ? last : rest).push(index[t], index[t + 1], index[t + 2]);
  return { index: Uint32Array.from([...rest, ...last]), solid: rest.length };
}

/** The scimitar in the right hand: the blade's edge in the hand bone's own frame (z along the blade, its back up). */
const LEN = 1.9, BEND = 0.46;
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spine = (u: number) => new THREE.Vector3(0, BEND * u * u, LEN * u);
const bladeWidth = (u: number) => (0.08 + 0.085 * sm(0, 0.6, u)) * (1 - sm(0.62, 1.0, u) ** 1.6) ** 0.8 + 0.0015;
/** Barbs on the blade's back, growing toward the point: each rises slowly and drops off sharply. */
const barb = (u: number) => { if (u < 0.3 || u > 0.93) return 0; const f = ((u - 0.3) * 9.5) % 1; return 0.05 * sm(0.3, 0.6, u) * (1 - sm(0.8, 0.93, u)) * (f < 0.8 ? f / 0.8 : (1 - f) / 0.2); };
/** Small teeth along the edge. */
const tooth = (u: number) => { const f = (u * 34) % 1; return 0.012 * sm(0.1, 0.3, u) * (1 - sm(0.85, 0.97, u)) * Math.abs(f - 0.5) * 2; };
function edgeAt(u: number): THREE.Vector3 {
  const t = new THREE.Vector3(0, 2 * BEND * u, LEN).normalize();
  return spine(u).add(new THREE.Vector3(0, -t.z, t.y).multiplyScalar(bladeWidth(u)));
}
// the sword sits in the hand at the grip point, its blade running forward and a little down, its back up
const GRIP = new THREE.Vector3(0.0, -0.2, 0);
const SWORD = (() => {
  const D = new THREE.Vector3(-0.12, -0.2, 1).normalize(), X = new THREE.Vector3(1, 0, 0), U = new THREE.Vector3().crossVectors(D, X).normalize();
  X.crossVectors(U, D);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, U, D));
  return new THREE.Matrix4().compose(GRIP, q, new THREE.Vector3(1, 1, 1));
})();
const BLADE_AT = new THREE.Matrix4().makeTranslation(0, 0, 0.15);
export const BLADE: { readonly len: 1.9; readonly bend: 0.46; edge(u: number): V } = {
  len: 1.9, bend: 0.46,
  edge(u) { const p = edgeAt(u).applyMatrix4(BLADE_AT).applyMatrix4(SWORD); return [p.x, p.y, p.z]; },
};
const HAND_R: V = mx(-1, W);

/** Merges placed three.js shapes, each on one bone, into one part; `to` is where the bone's frame lies in the model. */
function placed(shapes: { g: THREE.BufferGeometry; m: THREE.Matrix4; bone: number; to: V }[], keepUv: boolean): SkinPart {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [];
  for (const { g, m, bone, to } of shapes) {
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(to[0], to[1], to[2]).multiply(m));
    const v0 = pos.length / 3, p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, ix = g.index;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(u.getX(i), u.getY(i)); si.push(bone, 0, 0, 0); sw.push(1, 0, 0, 0); }
    // the icosahedron has no index: its points are already triangle after triangle
    for (let i = 0; i < (ix ? ix.count : p.count); i++) idx.push(v0 + (ix ? ix.getX(i) : i));
  }
  return part(new Float32Array(pos), Uint32Array.from(idx), new Float32Array(pos.length / 3 * 4), si, new Float32Array(sw), keepUv ? new Float32Array(uv) : null, new Float32Array(nor));
}

function bladeGeometry(): THREE.BufferGeometry {
  const N = 220, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, s = spine(u), e = edgeAt(u), th = 0.02 * (1 - 0.8 * u), b = barb(u), t = tooth(u);
    pos.push(th, s.y + b, s.z, -th, s.y + b, s.z, 0, e.y - t, e.z); uv.push(u, 0, u, 0, u, 1);
    if (i) { const a = (i - 1) * 3, b = i * 3; idx.push(a, a + 2, b, b, a + 2, b + 2, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2, a, b, a + 1, b, b + 1, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function ironShapes(): { g: THREE.BufferGeometry; m: THREE.Matrix4; bone: number; to: V }[] {
  const hand = id('handR'), at = (x: number, y: number, z: number, rx = 0) => new THREE.Matrix4().multiplyMatrices(SWORD, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1)));
  const out: { g: THREE.BufferGeometry; m: THREE.Matrix4; bone: number; to: V }[] = [
    { g: new THREE.CylinderGeometry(0.036, 0.042, 0.4, 10), m: at(0, 0, -0.06, Math.PI / 2), bone: hand, to: HAND_R },
    { g: new THREE.BoxGeometry(0.07, 0.34, 0.05), m: at(0, -0.04, 0.14, 0.25), bone: hand, to: HAND_R },
    { g: new THREE.ConeGeometry(0.035, 0.16, 6), m: at(0, 0.17, 0.2, 1.1), bone: hand, to: HAND_R },
    { g: new THREE.ConeGeometry(0.035, 0.16, 6), m: at(0, -0.25, 0.14, 2.3), bone: hand, to: HAND_R },
    { g: new THREE.IcosahedronGeometry(0.06, 0), m: at(0, 0, -0.29), bone: hand, to: HAND_R },
  ];
  // the shackle on the left forearm and the chain's links, each on its own bone; link i hangs from link i - 1
  const cuffQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...CUFF_ALONG).normalize());
  out.push({ g: new THREE.TorusGeometry(0.105, 0.03, 8, 20), m: new THREE.Matrix4().compose(new THREE.Vector3(...CUFF_AT), cuffQ, new THREE.Vector3(1, 1, 2.2)), bone: id('foreArmL'), to: E });
  for (let i = 0; i < CHAIN_LINKS; i++) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i % 2 ? Math.PI / 2 : 0);
    const pivot: V = [HANG_AT[0], HANG_AT[1] - 0.03 - 0.075 * i, HANG_AT[2]];
    out.push({ g: new THREE.TorusGeometry(0.036, 0.011, 6, 14, i === 5 ? Math.PI * 1.35 : Math.PI * 2), m: new THREE.Matrix4().compose(new THREE.Vector3(pivot[0], pivot[1] - 0.04, pivot[2]), q, new THREE.Vector3(1, 1.45, 1)), bone: id(`chain${i}`), to: E });
  }
  return out;
}

/** Builds every part of the demon. `cell` is the skin's fineness (0.008 for the game, coarser for tests). */
export function buildDemonSkin(cell = 0.008): DemonSkin {
  const sk = skin(prims(), [-1.2, -0.06, -0.5], [1.2, 3.12, 0.7], cell);
  const split = splitCrystal(sk.position, sk.info, sk.index);
  const body = { ...part(sk.position, split.index, sk.info, sk.skinIndex, sk.skinWeight, null), solid: split.solid };

  const tubes = new Buf(), web = new Buf(), cloth = new Buf();
  const LEATHER: Tag = [2, 0, 0, 0];
  const tk = skin(tailPrims(), [-0.3, 0, -2.3], [0.3, 1.5, -0.05], cell);
  const tail = part(tk.position, tk.index, tk.info, tk.skinIndex, tk.skinWeight, null);
  // the strap round the hips that the cloth hangs from
  const strap: V[] = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; strap.push([0.262 * Math.sin(a), 1.41 - 0.035 * Math.cos(a), 0.225 * Math.cos(a) - 0.01]); }
  tube(tubes, strap, strap.map(() => 0.04), strap.slice(1).map(() => id('hips')), () => LEATHER, 3, 8);
  // teeth: pointed fangs along the grin, the upper ones on the skull, the lower ones on the jaw, meshing when the mouth shuts
  for (const s of [1, -1]) {
    const at = (t: number): V => { const f = Math.min(2.999, t * 3), i = Math.floor(f); return lerp(SMILE[i], SMILE[i + 1], f - i); };
    const toothAt = (t: number, up: boolean, len: number) => {
      const p = at(t), n = norm([p[0], 0, p[2] - 0.2]), dy = up ? 1 : -1;
      const base: V = [s * (p[0] - n[0] * 0.017), p[1] + dy * 0.02, p[2] - n[2] * 0.017], tip: V = [s * (p[0] - n[0] * 0.006), p[1] - dy * len, p[2] - n[2] * 0.006];
      tube(tubes, [base, tip], [0.013 + len * 0.1, 0.0012], [id(up ? 'head' : 'jaw')], () => [1, 1, 0, 1], 5, 12);
    };
    [[0.07, 0.03], [0.24, 0.034], [0.42, 0.056], [0.58, 0.036], [0.73, 0.03], [0.87, 0.024]].forEach(([t, l]) => { if (s > 0 || t > 0.02) toothAt(t, true, l); });
    [[0.155, 0.03], [0.33, 0.046], [0.5, 0.034], [0.655, 0.03], [0.8, 0.024]].forEach(([t, l]) => toothAt(t, false, l));
  }
  for (const [side, s] of [['L', 1], ['R', -1]] as const) {
    const n = (name: string) => id(name + side), m = (v: V) => mx(s, v);
    const w1 = n('wing1'), w2 = n('wing2');
    // bones with thick joint ends: upper arm, forearm, thumb claw, and fingers with a knuckle
    tube(tubes, [WR, HM, WE].map(m), [0.1, 0.06, 0.085], [w1, w1], () => LEATHER, 8, 10);
    tube(tubes, [WE, FM, WW].map(m), [0.09, 0.05, 0.075], [w2, w2], () => LEATHER, 8, 10);
    tube(tubes, [WW, add(WW, [0.06, 0.2, 0.08]), add(WW, [0.02, 0.4, 0.14])].map(m), [0.05, 0.03, 0.004], [w2, w2], (u) => [1, 1, u > 0.7 ? 1 : 0, 0], 4, 8);
    // knobbly joints: a swelling at the elbow, the wrist and every knuckle
    const knob = (p: V, to: V, rad: number, bone: number) => { const d = norm([to[0] - p[0], to[1] - p[1], to[2] - p[2]]), o = (k: number): V => [p[0] + d[0] * rad * k, p[1] + d[1] * rad * k, p[2] + d[2] * rad * k]; tube(tubes, [o(-1.5), o(-0.7), o(0), o(0.7), o(1.5)].map(m), [0.3 * rad, 0.85 * rad, rad, 0.85 * rad, 0.3 * rad], [bone, bone, bone, bone], () => LEATHER, 3, 10); };
    knob(WE, FM, 0.12, w2); knob(WW, FM, 0.105, w2); FINGER.forEach((f, i) => { knob(f[0], f[1], 0.06 - i * 0.004, n(`wf${i}b`)); knob(lerp(WW, f[0], 0.12), f[0], 0.05, n(`wf${i}a`)); });
    const fingers = FINGER.map((f, i) => {
      const pts = [WW, lerp(WW, f[0], 0.5), f[0], lerp(f[0], f[1], 0.5), f[1]].map(m), a = n(`wf${i}a`), b = n(`wf${i}b`);
      pts[1][1] += 0.04; pts[3][0] += s * 0.05;
      tube(tubes, pts, [0.055, 0.028, 0.04, 0.02, 0.005], [a, a, b, b], () => LEATHER, 6, 8);
      return chain(pts, [a, a, b, b]);
    });
    for (let i = 0; i < 3; i++) sheet(web, fingers[i], fingers[i + 1], i, 0.2, 0.07);
    const arm = [WW, FM, WE, HM, WR].map(m);
    sheet(web, fingers[3], chain([...arm, m(WHIP)], [w2, w2, w1, w1, id('chest')], (f) => [[id('chest'), 1 - f], [id('hips'), f]]), 3, 0.12, 0.05);
    // the skin in front of the elbow, from the shoulder to the wrist
    sheet(web, chain([...arm].reverse(), [w1, w1, w2, w2]), chain([WR, [0.74, 2.95, -0.38] as V, WW].map(m), [w1, w2]), 4, 0, 0, 8, 24);
  }
  // loincloth, front and back: hangs from the hips
  const hips: Wt = [[id('hips'), 1]];
  for (const [z, panel] of [[0.235, 0], [-0.25, 1]] as const) {
    const v0 = cloth.n, NS = 12, NT = 22;
    for (let it = 0; it <= NT; it++) for (let is = 0; is <= NS; is++) {
      const s = is / NS, t = it / NT, half = 0.17 - 0.05 * t, x = (s * 2 - 1) * half;
      cloth.push(new THREE.Vector3(x, 1.4 - 0.86 * t, z + Math.sign(z) * (0.03 * Math.sin(t * 2.5) - 1.6 * x * x * (1 - t))), panel + s, t, [0, 0, 0, 0], hips);
    }
    for (let it = 0; it < NT; it++) for (let is = 0; is < NS; is++) { const a = v0 + it * (NS + 1) + is; cloth.idx.push(a, a + 1, a + NS + 1, a + 1, a + NS + 2, a + NS + 1); }
  }
  const bladeShape = { g: bladeGeometry(), m: new THREE.Matrix4().multiplyMatrices(SWORD, BLADE_AT), bone: id('handR'), to: HAND_R };
  return { body, tail, tubes: tubes.part(), web: web.part(), cloth: cloth.part(), blade: placed([bladeShape], true), iron: placed(ironShapes(), false) };
}

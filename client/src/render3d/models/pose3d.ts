// The pose of one figure, frame by frame (#338): the game's per-entity state (`ViewState`) becomes a bone matrix per bone, the turn
// of each loose piece and the root's shift. A port of the approved try-out page (`figures.html`: `pose`, `attackPose` and the hit)
// with the skip (two legs) and the bound (four legs) at the approved `GAIT` values. What the game decides, not the page: the
// times of the attacks, their reach and arc, the lunge, the speed and which weapon.
//
// Frames. The model is in sprite px with the front along +x, up along +y and the figure's right along +z. The pose is in that
// frame; the instance turns it by `yaw` (see `skinVertex` in rig.ts). The page turns its figures with three.js's rotation.y, which
// takes +x to -z; the game's yaw takes +x to +z (the game's y axis is the world's z axis), so the page's turn rate is `-mem.turn`.
//
// Purity: `poseFigure` changes only `mem`. The `Pose3d` it returns is owned by `mem` (it is written into the same object every
// call, to save allocations): it is valid until the next call with that memory, and a caller that keeps one (a vanish copy) must
// `copyPose` it. A held pose (stone, frozen) is a copy kept in `mem.held`. The module-level scratch objects hold nothing between calls.

import { ANIM, EFFECT, FLAG } from '../../generated/defs';
import { has } from '../../game/effectBits';
import type { FigureDef } from '../../game/anim/defs';
import { MELEE_T, type ViewState } from '../../game/anim/pose';
import { BONES, MAX_BENDS, MAX_BONES, type FigureModel } from './model';
import { composeBones, identityLocal, type BoneLocal } from './rig';

/** The approved skip; the bound uses the same numbers. */
export const GAIT = { rate: 1.4, stride: 1, armSwing: 1.2, bounce: 1, loose: 1.5 } as const;
export const TURN_RATE = 12, HIT_SECS = 0.26;
/** The walk blends in and out by `dt * 9` per frame, as on the page (the page wins over the brief's 0.2 s): an exponential, 83 % after 0.2 s. */
const BLEND_RATE = 9;
/** A strike's pose is blended in over this long, unless the figure was already holding the wound-up pose (a Windup before it). */
export const ATTACK_IN_SECS = 0.04;
/** The slam without a `FigureDef.slam`: how long the Slam animation is taken to last (s). Arms are up by 0.75 of it, down at its end. */
export const SLAM_DEFAULT_SECS = 0.4;
const SLAM_UP_AT = 0.75;

export interface Pose3dMemory { clock: number; phi: number; walk: number; yaw: number; faced: boolean; lastX: number; lastY: number; speed: number; turn: number; hitT: number; wasHurt: boolean; held: Pose3d | null;
  /** The pose `poseFigure` returns (written anew each call), and its attack object. */
  out: Pose3d | null; atk: { style: AttackStyle; u: number };
  /** A Windup came before this attack (the figure already holds the wound-up pose): no blend-in. */
  woundUp: boolean }
export function newPose3dMemory(): Pose3dMemory {
  return { clock: 0, phi: 0, walk: 0, yaw: 0, faced: false, lastX: 0, lastY: 0, speed: 0, turn: 0, hitT: -1, wasHurt: false, held: null, out: null, atk: { style: 'swing', u: 0 }, woundUp: false };
}

export type AttackStyle = 'swing' | 'shot' | 'cast' | 'bite';
export interface Pose3d {
  /** World heading, radians (0 = +x; the game's y is the world's z). */
  yaw: number;
  /**
   * In the figure's frame, before the yaw. `x` (jolt, lunge) and `z` (shiver) are unscaled sprite px; `y` (hop height, or the
   * lift of a lying figure) is ALREADY multiplied by the model's `scale`, so the instance must not scale it again; `roll` is
   * about x; `sx, sy, sz` are the dash stretch and the fall shrink, WITHOUT the model's `scale` (`skinVertex` multiplies it in).
   */
  root: { x: number; y: number; z: number; roll: number; sx: number; sy: number; sz: number };
  /** MAX_BONES x 12, from `composeBones`. */
  bones: Float32Array;
  /** MAX_BENDS x 4: axis x, y, z and the angle at the tip. */
  bends: Float32Array;
  /** dx, dz, and the dip the hem makes up for (the robe's y shift, 0 or more). */
  robe: [number, number, number];
  /** 0 on the ground, 1 at the top of a hop: the ground shadow shrinks by it. */
  air: number;
  /**
   * The attack the figure is in the middle of (not its wind-up), for the effects: `u` is the page's normalised time of that
   * style's pose (0 to 1; the strike comes at 0.2 to 0.56 of a swing, 0.55 of a shot, 0.42 of a cast, 0.3 to 0.46 of a bite).
   */
  attack: null | { style: AttackStyle; u: number };
  asleep: boolean; channel: boolean;
}

// ---- small maths ----

type V3 = [number, number, number];
type Q4 = [number, number, number, number];
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const ease = (v: number): number => { v = clamp01(v); return v * v * (3 - 2 * v); };
const num = (v: number | undefined, or = 0): number => (v !== undefined && Number.isFinite(v) ? v : or);
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };
const set3 = (v: V3, x: number, y: number, z: number): V3 => { v[0] = x; v[1] = y; v[2] = z; return v; };

/** three.js's Quaternion.setFromEuler for the order XYZ. */
function eulerQ(x: number, y: number, z: number, out: Q4): Q4 {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  out[0] = s1 * c2 * c3 + c1 * s2 * s3; out[1] = c1 * s2 * c3 - s1 * c2 * s3; out[2] = c1 * c2 * s3 + s1 * s2 * c3; out[3] = c1 * c2 * c3 - s1 * s2 * s3;
  return out;
}
/** three.js's Quaternion.setFromUnitVectors for the vector pointing straight down as `from`. */
function fromDown(to: V3, out: Q4): Q4 {
  let r = -to[1] + 1;
  if (r < Number.EPSILON) { r = 0; out[0] = 0; out[1] = 0; out[2] = -1; out[3] = r; }   // from = (0, -1, 0): |x| > |z| is false
  else { out[0] = -to[2]; out[1] = 0; out[2] = to[0]; out[3] = r; }
  const l = Math.hypot(out[0], out[1], out[2], out[3]);
  out[0] /= l; out[1] /= l; out[2] /= l; out[3] /= l;
  return out;
}
/** three.js's Quaternion.slerp: `a` moves towards `b` by `t`. */
function slerp(a: Q4, b: Q4, t: number): Q4 {
  if (t === 0) return a;
  if (t === 1) { a[0] = b[0]; a[1] = b[1]; a[2] = b[2]; a[3] = b[3]; return a; }
  const [x, y, z, w] = a;
  let cos = w * b[3] + x * b[0] + y * b[1] + z * b[2];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
  if (cos >= 1) return a;
  const sqrSin = 1 - cos * cos;
  if (sqrSin <= Number.EPSILON) {
    const s = 1 - t;
    a[3] = s * w + t * bw; a[0] = s * x + t * bx; a[1] = s * y + t * by; a[2] = s * z + t * bz;
    const l = Math.hypot(a[0], a[1], a[2], a[3]);
    a[0] /= l; a[1] /= l; a[2] /= l; a[3] /= l;
    return a;
  }
  const sin = Math.sqrt(sqrSin), half = Math.atan2(sin, cos), ra = Math.sin((1 - t) * half) / sin, rb = Math.sin(t * half) / sin;
  a[3] = w * ra + bw * rb; a[0] = x * ra + bx * rb; a[1] = y * ra + by * rb; a[2] = z * ra + bz * rb;
  return a;
}
/** conj(a) * b, for unit quaternions: the turn that, after `a`, gives `b`. */
function relQ(a: Q4, b: Q4, out: Q4): Q4 {
  const ax = -a[0], ay = -a[1], az = -a[2], aw = a[3];
  out[0] = ax * b[3] + aw * b[0] + ay * b[2] - az * b[1];
  out[1] = ay * b[3] + aw * b[1] + az * b[0] - ax * b[2];
  out[2] = az * b[3] + aw * b[2] + ax * b[1] - ay * b[0];
  out[3] = aw * b[3] - ax * b[0] - ay * b[1] - az * b[2];
  return out;
}
/** The page's `basisQ`: the turn that lays a weapon's length along `b` with its face towards `n`. False if `n` lies along `b`. */
function basisQ(b: V3, n: V3, out: Q4): boolean {
  const d = n[0] * b[0] + n[1] * b[1] + n[2] * b[2];
  let zx = n[0] - b[0] * d, zy = n[1] - b[1] * d, zz = n[2] - b[2] * d;
  if (zx * zx + zy * zy + zz * zz < 1e-3) return false;
  const l = Math.hypot(zx, zy, zz);
  zx /= l; zy /= l; zz /= l;
  // x = b cross z; the matrix has the columns x, b, z.
  const xx = b[1] * zz - b[2] * zy, xy = b[2] * zx - b[0] * zz, xz = b[0] * zy - b[1] * zx;
  const m11 = xx, m21 = xy, m31 = xz, m12 = b[0], m22 = b[1], m32 = b[2], m13 = zx, m23 = zy, m33 = zz;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out[3] = 0.25 / s; out[0] = (m32 - m23) * s; out[1] = (m13 - m31) * s; out[2] = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    out[3] = (m32 - m23) / s; out[0] = 0.25 * s; out[1] = (m12 + m21) / s; out[2] = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    out[3] = (m13 - m31) / s; out[0] = (m12 + m21) / s; out[1] = 0.25 * s; out[2] = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    out[3] = (m21 - m12) / s; out[0] = (m13 + m31) / s; out[1] = (m23 + m32) / s; out[2] = 0.25 * s;
  }
  return true;
}

// ---- the bones ----

const bi = (n: (typeof BONES)[number]): number => BONES.indexOf(n);
const BODY = bi('body'), HEAD = bi('head'), HAT = bi('hat'), ARM = [bi('armR'), bi('armL')], HAND = [bi('handR'), bi('handL')], LEG0 = bi('leg0'), WEAPON = [bi('weaponR'), bi('weaponL')];

// ---- the attacks: the page's `attackPose` ----

/** How a weapon is carried, in the body's frame (x forwards, y up, z to the right): its length. Its face is `SIDE`. */
const REST: Record<'melee' | 'bow' | 'cast', V3> = { melee: norm([0.42, 0.9, 0.1]), bow: norm([0.15, 1, 0]), cast: norm([0.08, 1, 0]) };
const UP: V3 = [0, 1, 0], SIDE: V3 = [0, 0, 1];

interface AttackScratch {
  k: number; right: V3; left: V3; useRight: boolean; useLeft: boolean; b: V3; n: V3; twist: number; lean: number;
  longR: number; longL: number; lunge: number; head: number;
  /** Which hand the pose's weapon basis (`b`, `n`) is for: 0 right, 1 left. */
  hand: 0 | 1;
}
const AP: AttackScratch = { k: 0, right: [0, 0, 0], left: [0, 0, 0], useRight: false, useLeft: false, b: [0, 1, 0], n: [0, 0, 1], twist: 0, lean: 0, longR: 1, longL: 1, lunge: 0, head: 0, hand: 0 };

/**
 * The attack at `u` (0 = it starts, 1 = back in the carrying pose): where each arm points, how the weapon lies, and `k`, how much
 * of this pose is mixed into the walking pose. `arc` is the swing's arc (rad).
 */
function attackPose(style: AttackStyle, u: number, arc: number): void {
  AP.k = 0; AP.useRight = AP.useLeft = false; AP.twist = AP.lean = 0; AP.longR = AP.longL = 1; AP.lunge = AP.head = 0; AP.hand = 0;
  if (u < 0) return;
  u = Math.min(1, u);
  if (style === 'bite') {
    // Rear the head, snap down, come back (the lunge is the game's own, see `lungeOf`).
    AP.k = u < 0.2 ? ease(u / 0.2) : 1 - ease((u - 0.7) / 0.3);
    AP.head = 0.4 * ease(u / 0.25) - 0.8 * ease((u - 0.25) / 0.15) + 0.4 * ease((u - 0.5) / 0.4);
  } else if (style === 'swing') {
    // Wind up to the right, sweep across the front to the left, come back.
    AP.k = u < 0.22 ? ease(u / 0.22) : 1 - ease((u - 0.64) / 0.36);
    const s = ease((u - 0.2) / 0.36), a0 = arc / 2 + 0.45, a1 = -arc / 2 - 0.25, al = a0 + (a1 - a0) * s, e = 0.3 - 0.45 * s;
    norm(set3(AP.right, Math.cos(al), e, Math.sin(al))); AP.useRight = true;
    norm(set3(AP.b, Math.cos(al - 0.2 * s), e * 0.5, Math.sin(al - 0.2 * s))); AP.n[0] = UP[0]; AP.n[1] = UP[1]; AP.n[2] = UP[2];
    AP.twist = -0.22 * al; AP.lean = 0.12 * s; AP.longR = 1.6;
  } else if (style === 'shot') {
    // Lift the bow, draw, let go at 0.55, lower.
    AP.k = u < 0.2 ? ease(u / 0.2) : 1 - ease((u - 0.72) / 0.28);
    const dr = u < 0.55 ? ease((u - 0.18) / 0.3) : 1;
    norm(set3(AP.left, 1, 0.12, 0.1)); AP.useLeft = true;
    norm(set3(AP.right, 1 - 1.25 * dr, 0.12 + 0.1 * dr, -0.45 + 0.9 * dr)); AP.useRight = true;
    set3(AP.b, 0, 1, 0); set3(AP.n, Math.sin(0.5), 0, Math.cos(0.5)); AP.twist = -0.5;   // the archer's stance: the left shoulder turns to the front
    AP.lean = -0.03; AP.longL = 2.3; AP.longR = 2.3 - 1.3 * dr; AP.hand = 1;
  } else {
    // Lift the arm and tip the staff forward; the light leaves its head at 0.42.
    AP.k = u < 0.3 ? ease(u / 0.3) : 1 - ease((u - 0.62) / 0.38);
    const push = Math.sin(Math.PI * Math.min(1, u / 0.7));
    norm(set3(AP.right, 1, 0.3 + 0.25 * push, 0.2)); AP.useRight = true;
    norm(set3(AP.b, 0.55 + 0.3 * push, 0.75, 0)); AP.n[0] = SIDE[0]; AP.n[1] = SIDE[1]; AP.n[2] = SIDE[2]; AP.lean = 0.06 * push; AP.longR = 1.5;
  }
}

/**
 * The slam (new, not on the page), fitted to `d.slam.t`, the length of the Slam animation (it ends as the blow lands): both arms
 * raise the weapon by 0.75 of it, smash it down between 0.75 and 1, and hold it down after.
 */
function slamPose(d: FigureDef, t: number): void {
  const total = d.slam ? d.slam.t : SLAM_DEFAULT_SECS;
  const up = ease(t / (SLAM_UP_AT * total)), down = ease((t - SLAM_UP_AT * total) / ((1 - SLAM_UP_AT) * total));
  AP.k = up; AP.useRight = AP.useLeft = true; AP.hand = 0;
  norm(set3(AP.right, 0.3 + 0.9 * down, 1 - 1.5 * down, 0.1)); norm(set3(AP.left, 0.3 + 0.9 * down, 1 - 1.5 * down, -0.1));
  norm(set3(AP.b, 0.3 + 0.6 * down, 1 - 1.5 * down, 0)); AP.n[0] = SIDE[0]; AP.n[1] = SIDE[1]; AP.n[2] = SIDE[2];
  AP.twist = 0; AP.lean = -0.12 * (1 - 2 * down) * up;   // leaning back (the negative lean) while it is up, forward as it comes down
  AP.longR = AP.longL = 1.4; AP.lunge = 0; AP.head = 0;
}

/**
 * Each style's clock: the page's normalised time `u` at `animT = 0`, how long the rest of the page's curve (1 - u0) lasts here
 * (s; for the swing see `uOf`), and the `u` a wind-up holds.
 */
const TIMING: Record<AttackStyle, { u0: number; secs: number; hold: number }> = {
  swing: { u0: 0.2, secs: 2 * MELEE_T, hold: 0.2 },   // starts at the wound-up pose (page u 0.2, which a Windup holds)
  shot: { u0: 0.55, secs: 0.25, hold: 0.55 },          // the shot starts at the release and the figure recovers in 0.25 s
  cast: { u0: 0.42, secs: 0.25, hold: 0.42 },          // the cast starts as the light leaves
  bite: { u0: 0.25, secs: 0.3, hold: 0.25 },           // the head is reared; the snap and the return last 0.3 s
};
/** The page's `u` at `animT` seconds into a style's attack. The swing: u 0.2 to 0.56 (the sweep) over `MELEE_T`, then 0.56 to 1 (the return) over `MELEE_T`. */
function uOf(style: AttackStyle, animT: number): number {
  const T = TIMING[style];
  if (style === 'swing') return animT <= MELEE_T ? 0.2 + 0.36 * animT / MELEE_T : 0.56 + 0.44 * (animT - MELEE_T) / MELEE_T;
  return T.u0 + (1 - T.u0) * animT / T.secs;
}
const LUNGE_SECS = 0.15;
const ATTACK_ANIMS = new Set<number>([ANIM.Melee, ANIM.Shoot, ANIM.Cast, ANIM.Bite]);
const FACE_AIM = new Set<number>([ANIM.Melee, ANIM.Shoot, ANIM.Cast, ANIM.Channel, ANIM.Windup, ANIM.Slam, ANIM.Bite]);

function styleOf(m: FigureModel, d: FigureDef, anim: number): AttackStyle {
  if (m.armLength === 0) return 'bite';
  if (anim === ANIM.Melee && (d.swing || d.mount === 'bow')) return 'swing';
  if (d.mount === 'bow') return 'shot';
  if (d.mount === 'staff' || d.attack === 'caster') return 'cast';
  return 'swing';
}

// ---- lying ----

const lieHeights = new WeakMap<FigureModel, number>();
/** How far the figure reaches to the side (z): lying on that side it needs this much room under it. A pure function of the model; memoised. */
export function sideReach(m: FigureModel): number {
  let r = lieHeights.get(m);
  if (r === undefined) {
    r = 0;
    for (let i = 0; i < m.position.length / 3; i++) if (m.skin[i * 4 + 1] === 0) r = Math.max(r, Math.abs(m.position[i * 3 + 2]));
    lieHeights.set(m, r);
  }
  return r;
}

// ---- the pose ----

const locals: BoneLocal[] = Array.from({ length: MAX_BONES }, identityLocal);
const qa: Q4 = [0, 0, 0, 1], qt: Q4 = [0, 0, 0, 1], qr: Q4 = [0, 0, 0, 1], qw: Q4 = [0, 0, 0, 1], qrel: Q4 = [0, 0, 0, 1];
/** An angle turned into [-PI, PI). */
const wrapPi = (a: number): number => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

/** One preallocated quaternion per bone, for the bones that take a quaternion (`useQ` hands it to the local). */
const qStore: Q4[] = Array.from({ length: MAX_BONES }, () => [0, 0, 0, 1] as Q4);
function useQ(b: number, q: Q4): void {
  const s = qStore[b];
  s[0] = q[0]; s[1] = q[1]; s[2] = q[2]; s[3] = q[3];
  locals[b].q = s;
}

function resetLocals(): void {
  for (const L of locals) { L.rx = L.ry = L.rz = L.tx = L.ty = L.tz = 0; L.sx = L.sy = L.sz = 1; L.q = undefined; }
}

function newPose(yaw: number): Pose3d {
  return { yaw, root: { x: 0, y: 0, z: 0, roll: 0, sx: 1, sy: 1, sz: 1 }, bones: new Float32Array(MAX_BONES * 12), bends: new Float32Array(MAX_BENDS * 4), robe: [0, 0, 0], air: 0, attack: null, asleep: false, channel: false };
}

/** A pose back to "nothing happens", in place. */
function clearPose(p: Pose3d, yaw: number): Pose3d {
  p.yaw = yaw;
  const R = p.root;
  R.x = R.y = R.z = R.roll = 0; R.sx = R.sy = R.sz = 1;
  p.bends.fill(0);
  p.robe[0] = p.robe[1] = p.robe[2] = 0;
  p.air = 0; p.attack = null; p.asleep = false; p.channel = false;
  return p;
}

/** A copy of a pose into `dst` (a new one when it is omitted): for callers that keep a pose past the next `poseFigure` of its memory. */
export function copyPose(src: Pose3d, dst: Pose3d = newPose(0)): Pose3d {
  dst.yaw = src.yaw;
  Object.assign(dst.root, src.root);
  dst.bones.set(src.bones); dst.bends.set(src.bends);
  dst.robe[0] = src.robe[0]; dst.robe[1] = src.robe[1]; dst.robe[2] = src.robe[2];
  dst.air = src.air; dst.asleep = src.asleep; dst.channel = src.channel;
  dst.attack = src.attack ? { style: src.attack.style, u: src.attack.u } : null;
  return dst;
}

/** The standing figure without any life in it: identity bones, no bends, on the ground (the skull, tests). A new pose each call. */
export function restPose(m: FigureModel, yaw: number): Pose3d {
  const p = newPose(yaw);
  resetLocals();
  composeBones(m, locals, p.bones);
  return p;
}

export function poseFigure(m: FigureModel, d: FigureDef, s: ViewState, dt: number, mem: Pose3dMemory): Pose3d {
  dt = Math.max(0, num(dt));
  mem.clock += dt;
  const sx0 = num(s.x), sy0 = num(s.y), first = !mem.faced;
  const dx = first ? 0 : sx0 - mem.lastX, dy = first ? 0 : sy0 - mem.lastY, moved = Math.hypot(dx, dy);
  mem.speed = first ? 0 : mem.speed * 0.8 + (dt > 0 ? moved / dt : 0) * 0.2;
  mem.lastX = sx0; mem.lastY = sy0;

  const fx = s.effects ?? 0, flags = s.flags;
  const asleep = has(fx, EFFECT.Sleep), stone = has(fx, EFFECT.Petrified), iced = has(fx, EFFECT.Frozen), entangled = has(fx, EFFECT.Entangled);
  const hurt = (flags & FLAG.HURT) !== 0;
  // Turned to stone or frozen: the pose of the frame it began in is held, whatever happens (also a hit).
  if (stone || iced) {
    if (mem.held) { mem.wasHurt = hurt; return mem.held; }
  } else mem.held = null;

  // ---- the clocks ----
  const anim = s.anim, animT = Math.max(0, num(s.animT));
  if (hurt && !mem.wasHurt) mem.hitT = 0;
  mem.wasHurt = hurt;
  if (mem.hitT >= 0) { mem.hitT += dt; if (mem.hitT > HIT_SECS) mem.hitT = -1; }
  const hu = mem.hitT < 0 ? -1 : mem.hitT / HIT_SECS;
  const HJ = hu < 0 ? 0 : hu < 0.2 ? ease(hu / 0.2) : Math.cos((hu - 0.2) / 0.8 * Math.PI * 1.5) * (1 - (hu - 0.2) / 0.8);   // the page's jolt (HS = 1: back from the heading)

  const moving = anim === ANIM.Move || anim === ANIM.Dash || mem.speed > 8;
  const go = moving && !asleep && !entangled;
  const pace = (has(fx, EFFECT.Slowed) ? 0.5 : has(fx, EFFECT.Accelerated) ? 1.5 : 1) * (has(fx, EFFECT.Chilled) ? 0.7 : 1);
  mem.walk += ((go ? 1 : 0) - mem.walk) * Math.min(1, dt * BLEND_RATE);
  if (mem.walk < 0.02 && !go) mem.phi = 0;
  else { mem.phi += 2 * Math.PI * GAIT.rate * dt * pace; if (mem.phi > 2 * Math.PI) mem.phi -= 2 * Math.PI; }

  // ---- facing: towards the walking direction, towards the aim in an attack, otherwise it stays ----
  const aim = num(s.aim, mem.yaw);
  let target: number | null = null;
  if (first) mem.yaw = aim;
  else if (!asleep && FACE_AIM.has(anim)) target = aim;
  else if (!asleep && go && dt > 0 && moved > 1e-4) target = Math.atan2(dy, dx);
  let step = 0;
  if (target !== null) {
    const lim = TURN_RATE * dt;
    step = Math.max(-lim, Math.min(lim, wrapPi(target - mem.yaw)));
    mem.yaw = wrapPi(mem.yaw + step);
  }
  mem.turn += (step / Math.max(dt, 1e-3) - mem.turn) * Math.min(1, dt * 12);
  mem.faced = true;

  // ---- the attack ----
  // A sleeper does not attack. Stone and ice are posed like anything else on the frame they begin (that frame is then held).
  const style = styleOf(m, d, anim);
  const arc = s.swingArc ?? d.swing?.arc ?? 1.75;
  let u = -1, windup = false, slam = false, struck = false;
  if (!asleep) {
    const T = TIMING[style];
    if (ATTACK_ANIMS.has(anim)) { u = uOf(style, animT); struck = u < 1; if (!struck) u = -1; }
    else if (anim === ANIM.Windup) { u = T.hold; windup = true; }
    else if (anim === ANIM.Channel) u = T.hold;
    else if (anim === ANIM.Slam) { slam = true; windup = true; }
  }
  // Remember a wind-up for the strike after it: the pose is held already, so the strike needs no blend-in.
  if (anim === ANIM.Windup) mem.woundUp = true;
  else if (!ATTACK_ANIMS.has(anim)) mem.woundUp = false;
  const weight = struck && !mem.woundUp ? Math.min(1, animT / ATTACK_IN_SECS) : 1;
  if (slam) slamPose(d, animT); else attackPose(style, u, arc);
  AP.k *= weight; AP.head *= weight;
  // The game's lunge: out and back over 0.15 s at the start of a melee animation.
  const lunge = !asleep && anim === ANIM.Melee && d.lunge ? Math.sin(Math.min(animT / LUNGE_SECS, 1) * Math.PI) * weight : 0;
  AP.lunge = lunge;
  const leanBack = windup ? 0.12 : 0;

  // ---- the gait ----
  const t = mem.clock, w = mem.walk, idle = 1 - w, phi = mem.phi;
  const sP = Math.sin(phi), cos2 = Math.cos(2 * phi), breath = asleep ? 0 : Math.sin(t * 2.6);
  const A = 0.62 * GAIT.stride, th = A * sP * w, air = Math.abs(sP), lim = Math.min(1, GAIT.bounce);
  const rise = asleep ? 0.03 * (0.5 + 0.5 * Math.sin(t * 1.5)) : 0;   // a sleeper does not breathe; its body slowly swells and sinks
  const k = AP.k;
  let bob = 0;
  resetLocals();
  const body = locals[BODY], head = locals[HEAD];
  if (m.quad) {
    // Bounding: the front pair and the hind pair each move together; highest with the legs stretched, nose up at the take-off.
    const ext = -Math.cos(2 * phi);
    bob = 2.0 * GAIT.bounce * air * w;
    let pitch = 0.17 * Math.sin(2 * phi) * w * lim;
    for (let j = 0; j < 4; j++) {
      const b = LEG0 + j, sgn = Math.sign(m.pivots[b * 3]), L = locals[b];
      L.rz = A * 1.1 * ext * sgn * w; L.sy = 1 - 0.3 * Math.max(0, -ext) * w;
    }
    body.sx = 1 + 0.07 * lim * (air - 0.45) * w;
    body.sy = 1 + 0.02 * breath * idle - 0.05 * lim * (air - 0.45) * w + rise;
    pitch -= 0.1 * AP.lunge;   // the bite: the front dips into the lunge
    pitch += 0.18 * HJ;        // a hit rocks it away from the blow
    pitch += leanBack;
    body.rz = pitch;
    for (let j = 0; j < 4; j++) locals[LEG0 + j].ty = Math.sin(pitch) * m.pivots[(LEG0 + j) * 3];   // the legs stay under the rocking body
    head.rz = -0.75 * pitch + 0.04 * cos2 * w + 0.02 * breath * idle + AP.head + 0.25 * HJ;   // the head stays level
    head.ty = 0.1 * breath * idle;
    body.sy *= 1 - 0.1 * Math.abs(HJ);
  } else {
    // Skipping: one hop per step. Landing with the legs together, highest with them apart, a little stretch in the air.
    bob = 2.4 * GAIT.bounce * air * w;
    for (let j = 0; j < 4; j++) {
      const b = LEG0 + j, sd = Math.sign(m.pivots[b * 3 + 2]), L = locals[b];
      L.rz = th * sd; L.sy = 1 - 0.38 * Math.max(0, sP * sd) * w;
    }
    body.rx = 0.08 * sP * w; body.ry = -0.16 * sP * w; body.rz = -0.03 * w;
    body.sy = 1 + 0.02 * breath * idle + 0.09 * lim * (air - 0.45) * w + rise;
    head.ry = 0.11 * sP * w; head.rz = 0.05 * cos2 * w + 0.015 * breath * idle;   // the head keeps looking ahead and nods a little
    head.ty = 0.12 * breath * idle;
    if (k > 0) { body.ry += AP.twist * k; body.rz -= AP.lean * k; head.ry -= 0.8 * AP.twist * k; }   // the body twists and leans, the head keeps looking at the target
    body.rz += leanBack;
    if (HJ) { body.rz += 0.32 * HJ; head.rz += 0.22 * HJ; body.sy *= 1 - 0.1 * Math.abs(HJ); }
  }

  // ---- the arms and what they hold ----
  if (m.armLength > 0) {
    for (let side = 0; side < 2; side++) {
      const sd = side === 0 ? 1 : -1;
      eulerQ(-sd * (0.16 + 0.05 * w + 0.3 * air * w), 0, -sd * th * 1.15 * GAIT.armSwing + 0.04 * breath * idle, qa);
      if (k > 0 && (side === 0 ? AP.useRight : AP.useLeft)) slerp(qa, fromDown(side === 0 ? AP.right : AP.left, qt), k);
      const long = 1 + ((side === 0 ? AP.longR : AP.longL) - 1) * k, more = (long - 1) * (m.armLength - m.armRadius);
      const arm = locals[ARM[side]], hand = locals[HAND[side]];
      useQ(ARM[side], qa); arm.sy = long;                   // the arm grows ...
      hand.sy = 1 / long; hand.ty = -more / long;           // ... and the hand moves out with its end, at its own size
      // The weapon keeps its carrying pose in the body's frame while the hand under it swings; an attack turns it from there.
      const kind = side === 1 ? 'bow' : d.mount === 'staff' ? 'cast' : 'melee';
      basisQ(REST[kind], SIDE, qr);
      if (k > 0 && AP.hand === side && basisQ(AP.b, AP.n, qw)) slerp(qr, qw, k);
      useQ(WEAPON[side], relQ(qa, qr, qrel));
    }
  }

  // ---- loose parts ----
  const loose = GAIT.loose, turn = -mem.turn, hat = locals[HAT];
  {
    const kk = m.hatSway * loose;   // the hat rocks about the top of the head
    hat.rx = kk * 0.14 * Math.sin(phi - 0.8) * w;
    hat.ry = Math.max(-0.5, Math.min(0.5, -turn * 0.04 * kk));
    hat.rz = kk * (0.12 * w + 0.2 * Math.sin(2 * phi - 1.1) * w + 0.03 * Math.sin(t * 1.7) * idle) - 0.35 * HJ;
  }

  // ---- the root: shift, hop, lying, stretch ----
  const fall = clamp01(num(s.fall));
  const pose = clearPose(mem.out ??= newPose(mem.yaw), mem.yaw);
  const R = pose.root, fallK = 1 - fall * 0.2;
  R.sx = fallK; R.sy = fallK; R.sz = fallK;
  if (!asleep && anim === ANIM.Dash) { R.sx *= 1.25; R.sy *= 0.9; }
  R.x = num(d.lunge) * lunge - 1.6 * HJ;
  R.y = bob * m.scale;
  if (windup) R.z = Math.floor(t * 40) % 2 ? 1 : -1;   // the shiver of a wind-up: 1 px to either side at 20 Hz
  if (asleep) {
    R.roll = Math.PI / 2;
    R.y = sideReach(m) * m.scale * R.sy;   // on its side, on the ground
  }
  pose.air = asleep ? 0 : air * w * lim;
  pose.asleep = asleep; pose.channel = anim === ANIM.Channel;
  if (struck && !asleep) { mem.atk.style = style; mem.atk.u = u; pose.attack = mem.atk; }

  // ---- bends and the robe ----
  for (let i = 0; i < m.bends.length && i < MAX_BENDS; i++) {
    const B = m.bends[i], kk = B.k * loose * 1.5;
    const wx = kk * 0.14 * Math.sin(phi - 0.8) * w + B.wag * 0.4 * Math.sin(t * 7) * idle, wy = Math.max(-0.6, Math.min(0.6, -turn * 0.04 * kk));
    const wz = kk * (B.up * 0.12 * w + 0.2 * Math.sin(2 * phi - 1.1) * w + 0.03 * Math.sin(t * 1.7) * idle) - B.up * 0.5 * HJ;   // a hit: the loose end lags behind the knocked body
    // The turn at the tip: its axis and its angle, which levels off so that a strong setting cannot fold the piece over.
    const raw = Math.hypot(wx, wy, wz) || 1e-6, ang = 0.75 * Math.tanh(raw / 0.75);
    pose.bends[i * 4] = wx / raw; pose.bends[i * 4 + 1] = wy / raw; pose.bends[i * 4 + 2] = wz / raw; pose.bends[i * 4 + 3] = ang;
  }
  if (m.robeTop !== null) {
    // The hem trails, swings and (the dip) stays on the ground.
    pose.robe[0] = loose * (-0.9 + 0.5 * Math.sin(2 * phi - 0.9)) * w;
    pose.robe[1] = loose * (1.1 * Math.sin(phi - 0.6) * w + 0.12 * Math.sin(t * 1.3) * idle);
    pose.robe[2] = Math.max(0, -bob);
  }

  composeBones(m, locals, pose.bones);
  if (stone || iced) return (mem.held = copyPose(pose));   // the frame it began in (an attack and all), kept
  return pose;
}

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
import { AMBUSH_WARNING } from '../../game/shadeHaze';
import { BONES, MAX_BENDS, MAX_BONES, weaponBoneOf } from './bones';
import type { FigureModel } from './model';
import { composeBones, identityLocal, type BoneLocal } from './rig';

/** The approved skip; the bound uses the same numbers. */
export const GAIT = { rate: 1.4, stride: 1, armSwing: 1.2, bounce: 1, loose: 1.5 } as const;
/** The walk of a two-legged tube model (`gait: 'walk'`): how far a leg swings at the hip, and how far the knee bends back (rad). */
export const WALK = { swing: 0.5, knee: 0.9 } as const;
/**
 * The floating gait of the spectres (`gait: 'float'`, #359): nothing steps; the limbs hang limp and trail behind it by how fast it goes, following the
 * speed late. `hover`: game px over the ground; `bob`: three slow sines of the height, [px, rad/s, share of the entity's phase]; `rate`: 1/s, how late
 * `drag` (the legs and arms trailing) and `lean` (the whole body, at the hips) follow the speed; `drag`, `lean`: rad per tile/s and their ceiling;
 * `knee`, `arm`: [at rest, extra at full drag] (rad); `head`: the head droops; `spread`: the legs hang a little apart; `sway`: the limbs' slow sway at
 * rest; `hitLean`: the hips' lean into a hit. First values, those of the approved try-out.
 */
export const FLOAT = {
  hover: 1.5,
  bob: [[0.55, 0.9, 1], [0.3, 2.3, 1.7], [0.15, 3.7, 0.6]],
  rate: 3,
  drag: { per: 0.6, max: 0.85 },
  lean: { per: 0.12, max: 0.22 },
  knee: [0.1, 0.45], arm: [0.06, 0.5], head: 0.22, spread: 0.06, sway: 0.04, hitLean: 0.2,
} as const;
/** Floating parts (`FigureModel.apart`, #359 round 2): the approved try-out's numbers. Lengths in model px, angles in rad. */
export const APART = {
  hover: 2,                               // game px; replaces FLOAT.hover for such a model (the bob stays FLOAT.bob)
  // drift of each part: [amplitude, rad/s, share of the phase] for x, y, z; the arms use the phase `ph + side * arm.phase`
  head: { at: [[0.3, 0.7, 1], [0.35, 1.1, 2], [0.25, 0.9, 3]], turn: [[0.06, 0.8, 1], [0.12, 0.5, 2], [0.07, 0.6, 1]], droop: -0.12 },
  arm: { at: [[0.35, 0.6, 1], [0.45, 0.9, 2], [0.35, 0.7, 3]], turn: [[0.08, 0.5, 1], [0, 0, 0], [0.1, 0.8, 1]], elbow: [0.12, 1.0, 2], phase: 1.3 },
  // the blow, as factors of wind (W), swing (S) and reach (R); `side` is +1 for the striking arm's side
  body: { yaw: [-0.45, 0.6], lean: [0.2, -0.3], back: 1.5, lift: [1.2, -0.8] },          // hips: ry = yaw[0] W + yaw[1] S; rz += lean[0] W + lean[1] R; root x -= back W; root y += lift[0] W + lift[1] R
  headBlow: [1.8, -0.3],                                                                  // head x += 1.8 R, y -= 0.3 R
  strike: { at: [[-2.6, 0, 6.5], [3.2, 0, 0.8], [2.4, -4.2, 0]], turn: [[-0.55, 0.2, 0], [-1.3, 2.2, 0], [-0.9, 0, 1.25]], elbow: [0.9, 0, -0.8] },   // rows x, y, z; columns W, S, R; z rows times `side`; turn order YXZ
  other: { at: [-2.2, 0, 1.5], turn: -0.7 },                                              // the other arm in a blow, times R: x, y, z (z times its side), and its turn about z
  // the blow's clock, in units of MELEE_T: the sweep is 0..1, held to `hold`, back by `back`; the reach lasts `reach`
  time: { hold: 1.5, back: 5, reach: 4, reachPow: 0.6, windIn: 12, windOut: 0.4, carry: 12 },
  form: [0.45, 0.95], inside: [0.5, 13.0, 0],                                             // the ambush: the parts drift in from this point of the smoke
  asleep: { hover: 0.5, droop: -0.35 },
} as const;
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
  woundUp: boolean;
  /** The scale of the hat bone (the antlers of a stag): 1 unless the caller sets it. */
  crest: number;
  /** The floating gait (`FLOAT`): the entity's own phase (the caller sets it; 0 by default), and how far the limbs trail and the body leans (rad; they follow the speed late). */
  phase: number; drag: number; lean: number;
  /** Floating parts (`APART`): seconds since the last melee began (-1: none); how far the wind-up pose is held (0..1); what is left of the swing and the reach of the blow before, which a new blow starts from (it decays; the wind is continuous by its own follow, so it has no carry). */
  blowT: number; wind: number; carry: [number, number];
  /** Floating parts: the wind when the current melee began, and the last frame's animation and its time (to tell a new blow from the same one). */
  windStart: number; prevAnim: number; prevAnimT: number }
export function newPose3dMemory(): Pose3dMemory {
  return { clock: 0, phi: 0, walk: 0, yaw: 0, faced: false, lastX: 0, lastY: 0, speed: 0, turn: 0, hitT: -1, wasHurt: false, held: null, out: null, atk: { style: 'swing', u: 0 }, woundUp: false, crest: 1, phase: 0, drag: 0, lean: 0,
    blowT: -1, wind: 0, carry: [0, 0], windStart: 0, prevAnim: -1, prevAnimT: 0 };
}

export type AttackStyle = 'swing' | 'shot' | 'cast' | 'bite' | 'butt';
export interface Pose3d {
  /** World heading, radians (0 = +x; the game's y is the world's z). */
  yaw: number;
  /**
   * In the figure's frame, before the yaw. `x` (jolt, lunge) and `z` (shiver) are sprite px already multiplied by the game's `FigureDef.scale` (and the fall shrink), not by the model's `scale`; `y` (hop height, or the
   * lift of a lying figure) is ALREADY multiplied by the model's `scale`, so the instance must not scale it again (a floating model's `y` is the hover in game px and is
   * NOT multiplied by `m.scale`, as the lunge is not); `roll` is
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
/** a * b: the turn `b`, then the turn `a`. `out` must be neither of them. */
function mulQ(a: Q4, b: Q4, out: Q4): Q4 {
  out[0] = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
  out[1] = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
  out[2] = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
  out[3] = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
  return out;
}
/** The turn about z by `a`: it swings a hanging arm forwards. */
function aboutZ(a: number, out: Q4): Q4 {
  out[0] = 0; out[1] = 0; out[2] = Math.sin(a / 2); out[3] = Math.cos(a / 2);
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
const HIPS = bi('hips'), BODY = bi('body'), HEAD = bi('head'), HAT = bi('hat'), ARM = [bi('armR'), bi('armL')], HAND = [bi('handR'), bi('handL')], LEG0 = bi('leg0'), WEAPON = [bi('weaponR'), bi('weaponL')];

// ---- the attacks: the page's `attackPose` ----

/** How a weapon is carried, in the body's frame (x forwards, y up, z to the right): its length. Its face is `SIDE`. */
const REST: Record<'melee' | 'bow' | 'cast', V3> = { melee: norm([0.42, 0.9, 0.1]), bow: norm([0.15, 1, 0]), cast: norm([0.08, 1, 0]) };
const UP: V3 = [0, 1, 0], SIDE: V3 = [0, 0, 1];

/**
 * Arms with an elbow (`FigureModel.elbow`; the description's `arms.elbow`). Angles in rad, lengths as shares of the arm's length; first values.
 * `carry`: how far forward of the hanging upper arm the forearm is held while its hand holds that kind of weapon, so the weapon stands in
 * front of the body and not inside the arm; `free`: an empty hand's forearm (a model's own `elbowFree` replaces it). `carrySwing`: the share of the walk's arm swing a carrying
 * arm keeps. `swing`, `cast`: how far the forearm is bent up from the upper arm's line in those poses (the bow arm is straight). `string`: the string's
 * place behind the bow hand before the draw; `anchor`: how far from its shoulder the drawing hand stops at full draw (the arm is then bent);
 * `clear`: how far ahead of its shoulder, along the line of the shot, the drawing hand stays at least.
 */
export const ELBOW = { carry: { melee: 0.95, bow: 1.2, cast: 1.0 }, free: 0.15, carrySwing: 0.3, swing: 0.3, cast: 0.5, string: 0.2, anchor: 0.8, clear: 0.3 } as const;
/** How the hand of a bent arm carries its weapon, in the body's frame: its length and its face. Blade and bow are turned a little, so they are edge-on neither from the front nor from the side. */
const CARRY: Record<'melee' | 'bow' | 'cast', { b: V3; n: V3 }> = {
  melee: { b: norm([0.42, 0.9, 0.1]), n: [Math.sin(0.5), 0, Math.cos(0.5)] },
  bow: { b: norm([0.1, 1, 0]), n: [Math.sin(0.5), 0, Math.cos(0.5)] },
  cast: { b: norm([0.08, 1, 0]), n: [0, 0, 1] },
};

interface AttackScratch {
  k: number; right: V3; left: V3; useRight: boolean; useLeft: boolean; b: V3; n: V3; twist: number; lean: number;
  longR: number; longL: number; lunge: number; head: number;
  /** The butt: how far the animal is reared back, and how far forward into the strike (0 to 1; 0 for every other style). */
  back: number; fwd: number;
  /** Which hand the pose's weapon basis (`b`, `n`) is for: 0 right, 1 left. */
  hand: 0 | 1;
  /** For arms with an elbow only: how far each forearm is bent up from its upper arm's line (rad). */
  flexR: number; flexL: number;
  /** For arms with an elbow only: the right hand is on the string of the left hand's bow, drawn this far (0 to 1); -1: it is not. */
  draw: number;
}
const AP: AttackScratch = { k: 0, right: [0, 0, 0], left: [0, 0, 0], useRight: false, useLeft: false, b: [0, 1, 0], n: [0, 0, 1], twist: 0, lean: 0, longR: 1, longL: 1, lunge: 0, head: 0, back: 0, fwd: 0, hand: 0, flexR: 0, flexL: 0, draw: -1 };

/**
 * The attack at `u` (0 = it starts, 1 = back in the carrying pose): where each arm points, how the weapon lies, and `k`, how much
 * of this pose is mixed into the walking pose. `arc` is the swing's arc (rad).
 */
function attackPose(style: AttackStyle, u: number, arc: number): void {
  AP.k = 0; AP.useRight = AP.useLeft = false; AP.twist = AP.lean = 0; AP.longR = AP.longL = 1; AP.lunge = AP.head = 0; AP.back = AP.fwd = 0; AP.hand = 0;
  AP.flexR = AP.flexL = 0; AP.draw = -1;
  if (u < 0) return;
  u = Math.min(1, u);
  if (style === 'butt') {
    // Rear up, throw the head down (or up) into the strike, come back.
    AP.k = 1;
    AP.back = ease(u / BUTT.back) * (1 - ease((u - BUTT.back) / BUTT.strike));
    AP.fwd = ease((u - BUTT.back) / BUTT.strike) * (1 - ease((u - 0.6) / 0.4));
  } else if (style === 'bite') {
    // Rear the head, snap down, come back (the lunge is the game's own, see `lungeOf`).
    AP.k = u < 0.2 ? ease(u / 0.2) : 1 - ease((u - 0.7) / 0.3);
    AP.head = 0.4 * ease(u / 0.25) - 0.8 * ease((u - 0.25) / 0.15) + 0.4 * ease((u - 0.5) / 0.4);
  } else if (style === 'swing') {
    // Wind up to the right, sweep across the front to the left, come back.
    AP.k = u < 0.22 ? ease(u / 0.22) : 1 - ease((u - 0.64) / 0.36);
    const s = ease((u - 0.2) / 0.36), a0 = arc / 2 + 0.45, a1 = -arc / 2 - 0.25, al = a0 + (a1 - a0) * s, e = 0.3 - 0.45 * s;
    norm(set3(AP.right, Math.cos(al), e, Math.sin(al))); AP.useRight = true;
    norm(set3(AP.b, Math.cos(al - 0.2 * s), e * 0.5, Math.sin(al - 0.2 * s))); AP.n[0] = UP[0]; AP.n[1] = UP[1]; AP.n[2] = UP[2];
    AP.twist = -0.22 * al; AP.lean = 0.12 * s; AP.longR = 1.6; AP.flexR = ELBOW.swing;
  } else if (style === 'shot') {
    // Lift the bow, draw, let go at 0.55, lower.
    AP.k = u < 0.2 ? ease(u / 0.2) : 1 - ease((u - 0.72) / 0.28);
    const dr = u < 0.55 ? ease((u - 0.18) / 0.3) : 1;
    norm(set3(AP.left, 1, 0.12, 0.1)); AP.useLeft = true;
    norm(set3(AP.right, 1 - 1.25 * dr, 0.12 + 0.1 * dr, -0.45 + 0.9 * dr)); AP.useRight = true;
    set3(AP.b, 0, 1, 0); set3(AP.n, Math.sin(0.5), 0, Math.cos(0.5)); AP.twist = -0.5;   // the archer's stance: the left shoulder turns to the front
    AP.lean = -0.03; AP.longL = 2.3; AP.longR = 2.3 - 1.3 * dr; AP.hand = 1; AP.draw = dr;
  } else {
    // Lift the arm and tip the staff forward; the light leaves its head at 0.42.
    AP.k = u < 0.3 ? ease(u / 0.3) : 1 - ease((u - 0.62) / 0.38);
    const push = Math.sin(Math.PI * Math.min(1, u / 0.7));
    norm(set3(AP.right, 1, 0.3 + 0.25 * push, 0.2)); AP.useRight = true;
    norm(set3(AP.b, 0.55 + 0.3 * push, 0.75, 0)); AP.n[0] = SIDE[0]; AP.n[1] = SIDE[1]; AP.n[2] = SIDE[2]; AP.lean = 0.06 * push; AP.longR = 1.5; AP.flexR = ELBOW.cast;
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
  AP.longR = AP.longL = 1.4; AP.lunge = 0; AP.head = 0; AP.back = AP.fwd = 0;
  AP.flexR = AP.flexL = ELBOW.swing; AP.draw = -1;
}

/** The butt's curve (the page's): reared back by `u` 0.35, the strike takes `strike` of it; a wind-up holds `hold`, the strike and return last `secs` (s). */
export const BUTT = { back: 0.35, strike: 0.12, hold: 0.35, secs: 0.36 } as const;
/** How far a lower leg folds back at most (rad). */
export const LEG_FOLD = 0.95;

/**
 * Each style's clock: the page's normalised time `u` at `animT = 0`, how long the rest of the page's curve (1 - u0) lasts here
 * (s; for the swing see `uOf`), and the `u` a wind-up holds.
 */
const TIMING: Record<AttackStyle, { u0: number; secs: number; hold: number }> = {
  swing: { u0: 0.2, secs: 2 * MELEE_T, hold: 0.2 },   // starts at the wound-up pose (page u 0.2, which a Windup holds)
  shot: { u0: 0.55, secs: 0.25, hold: 0.55 },          // the shot starts at the release and the figure recovers in 0.25 s
  cast: { u0: 0.42, secs: 0.25, hold: 0.42 },          // the cast starts as the light leaves
  bite: { u0: 0.25, secs: 0.3, hold: 0.25 },           // the head is reared; the snap and the return last 0.3 s
  butt: { u0: BUTT.hold, secs: BUTT.secs, hold: BUTT.hold },   // reared up (a wind-up holds it); the strike and the return last 0.36 s
};
/** The page's `u` at `animT` seconds into a style's attack. The swing: u 0.2 to 0.56 (the sweep) over `MELEE_T`, then 0.56 to 1 (the return) over `MELEE_T`. */
function uOf(style: AttackStyle, animT: number): number {
  const T = TIMING[style];
  if (style === 'swing') return animT <= MELEE_T ? 0.2 + 0.36 * animT / MELEE_T : 0.56 + 0.44 * (animT - MELEE_T) / MELEE_T;
  return T.u0 + (1 - T.u0) * animT / T.secs;
}
export const LUNGE_SECS = 0.15;
/** The legs of a model: its own list (the tube models), else the four leg bones, the front ones by the sign of the pivot's x, none with a lower bone. */
const legLists = new WeakMap<FigureModel, { upper: number; lower: number; front: boolean }[]>();
function legsOf(m: FigureModel): { upper: number; lower: number; front: boolean }[] {
  if (m.legs) return m.legs;
  let l = legLists.get(m);
  if (!l) legLists.set(m, (l = [0, 1, 2, 3].map((j) => ({ upper: LEG0 + j, lower: -1, front: m.pivots[(LEG0 + j) * 3] > 0 }))));
  return l;
}

const ATTACK_ANIMS = new Set<number>([ANIM.Melee, ANIM.Shoot, ANIM.Cast, ANIM.Bite]);
const FACE_AIM = new Set<number>([ANIM.Melee, ANIM.Shoot, ANIM.Cast, ANIM.Channel, ANIM.Windup, ANIM.Slam, ANIM.Bite]);

function styleOf(m: FigureModel, d: FigureDef, anim: number): AttackStyle {
  if (m.apart) return 'swing';
  if (m.armLength === 0) return m.butt ? 'butt' : 'bite';
  if (anim === ANIM.Melee && (d.swing || d.mount === 'bow')) return 'swing';
  if (d.mount === 'bow') return 'shot';
  if (d.mount === 'staff' || d.attack === 'caster') return 'cast';
  return 'swing';
}

// ---- lying ----

/** How much of its side reach a lying figure sinks below the ground (the softness of the body); the floor's depth hides the part below. A first guess. */
export const LIE_SINK = 0.3;

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
/** An angle wrapped into [-π, π). */
const wrapPi =(a: number): number => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

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

const qf: Q4 = [0, 0, 0, 1], qu: Q4 = [0, 0, 0, 1], qv: Q4 = [0, 0, 0, 1], qz: Q4 = [0, 0, 0, 1], qhand: Q4 = [0, 0, 0, 1];
const dirU: V3 = [0, 0, 0], dirF: V3 = [0, 0, 0], bowDir: V3 = [0, 0, 0];

/**
 * The drawing arm of a shot, for an arm with an elbow: the right hand lies on the line of the shot behind the bow hand, at the string
 * before the draw and, at full draw, where that line comes within `ELBOW.anchor` of the right shoulder; the elbow points back along the
 * line and a little up and out. All in the body's frame at the full twist of the stance. Writes the upper arm's direction to `dirU` and
 * the forearm's to `dirF`.
 */
function drawArm(m: FigureModel, up: number, fore: number): void {
  const P = m.pivots, sR = ARM[0] * 3, sL = ARM[1] * 3, L = up + fore;
  // The bow hand at the end of the straight left arm, seen from the right shoulder.
  const rx = P[sL] + L * bowDir[0] - P[sR], ry = P[sL + 1] + L * bowDir[1] - P[sR + 1], rz = P[sL + 2] + L * bowDir[2] - P[sR + 2];
  // The line of the shot: the figure's heading, in the frame of the twisted body.
  const ax = Math.cos(AP.twist), az = Math.sin(AP.twist);
  const along = rx * ax + rz * az, off2 = rx * rx + ry * ry + rz * rz - along * along, reach = ELBOW.anchor * L;
  // At full draw: where the line comes within reach, but never nearer the shoulder's own place along the line than `clear` (the hand stays in front of the chest).
  const rest = ELBOW.string * L, full = Math.max(rest, Math.min(along - Math.sqrt(Math.max(0, reach * reach - off2)), along - ELBOW.clear * L));
  const s = rest + (full - rest) * clamp01(AP.draw);
  const tx = rx - s * ax, ty = ry, tz = rz - s * az, dist = Math.hypot(tx, ty, tz) || 1e-6;
  const ux = tx / dist, uy = ty / dist, uz = tz / dist;
  // Two bones to a point: the angle at the shoulder from the three lengths (an unreachable point straightens the arm).
  const dc = Math.max(Math.abs(up - fore) + 1e-3, Math.min((up + fore) * 0.999, dist));
  const cosA = Math.max(-1, Math.min(1, (up * up + dc * dc - fore * fore) / (2 * up * dc))), sinA = Math.sqrt(1 - cosA * cosA);
  // The elbow's side: back along the line, a little up and out, squared against the line to the hand.
  let px = -ax, py = 0.35, pz = -az + 0.35;
  const along2 = px * ux + py * uy + pz * uz;
  px -= along2 * ux; py -= along2 * uy; pz -= along2 * uz;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-4) { px = 0; py = 1; pz = 0; } else { px /= pl; py /= pl; pz /= pl; }
  set3(dirU, cosA * ux + sinA * px, cosA * uy + sinA * py, cosA * uz + sinA * pz);
  norm(set3(dirF, dc * ux - up * dirU[0], dc * uy - up * dirU[1], dc * uz - up * dirU[2]));
}

/**
 * The arms of a model with elbows (`m.elbow`): the upper arm hangs and swings as any arm, the forearm (the hand bone, which turns about
 * the elbow) is held forward while its hand carries a weapon, and bends in an attack; the drawing hand of a shot goes to the string
 * (`drawArm`). These arms are never lengthened. `lift`: how far the arms stand off the sides (rad); `stride`: the walk's arm swing (rad);
 * `sway`: the breathing. `limp`: for a floating model (the Ghost's swipe): the turn about z of a limp arm, from which the arm the attack uses
 * is blended and at which the other arm hangs, with its forearm straight on and its hand and weapon bones at rest; absent: the walk's arms.
 */
function elbowArms(m: FigureModel, d: FigureDef, k: number, lift: number, stride: number, sway: number, limp?: number): void {
  const up = m.elbow!, fore = m.armLength - up;
  const held = d.weapon ? (weaponBoneOf(d.weapon) === 'weaponR' ? 0 : 1) : -1;
  // Where the left arm points in an attack: the pose's own direction, or in a shot of a `bowAhead` model the line of the shot (the figure's heading in the twisted body's frame), lifted as the pose lifts it.
  if (AP.draw >= 0 && m.bowAhead) norm(set3(bowDir, Math.cos(AP.twist), AP.left[1], Math.sin(AP.twist)));
  else set3(bowDir, AP.left[0], AP.left[1], AP.left[2]);
  for (let side = 0; side < 2; side++) {
    const sd = side === 0 ? 1 : -1, holds = held === side;
    const kind = side === 1 ? 'bow' : d.mount === 'staff' ? 'cast' : 'melee';
    if (limp !== undefined) {
      if (!(k > 0 && (side === 0 ? AP.useRight : AP.useLeft))) { useQ(ARM[side], aboutZ(limp, qa)); continue; }
      aboutZ(limp, qa); qf[0] = qa[0]; qf[1] = qa[1]; qf[2] = qa[2]; qf[3] = qa[3];
    } else {
      eulerQ(-sd * lift, 0, -sd * stride * (holds ? ELBOW.carrySwing : 1) + sway, qa);
      mulQ(qa, aboutZ(holds ? ELBOW.carry[kind] : m.elbowFree ?? ELBOW.free, qz), qf);
    }
    if (k > 0 && (side === 0 ? AP.useRight : AP.useLeft)) {
      if (side === 0 && AP.draw >= 0) { drawArm(m, up, fore); fromDown(dirU, qu); fromDown(dirF, qv); }
      else { fromDown(side === 0 ? AP.right : bowDir, qu); mulQ(qu, aboutZ(side === 0 ? AP.flexR : AP.flexL, qz), qv); }
      slerp(qa, qu, k); slerp(qf, qv, k);
    }
    useQ(ARM[side], qa); useQ(HAND[side], relQ(qa, qf, qhand));
    // The weapon keeps its carrying pose in the body's frame while the hand under it moves; an attack turns it from there.
    if (holds) basisQ(CARRY[kind].b, CARRY[kind].n, qr); else basisQ(REST[kind], SIDE, qr);
    if (k > 0 && AP.hand === side && basisQ(AP.b, AP.n, qw)) slerp(qr, qw, k);
    useQ(WEAPON[side], relQ(qf, qr, qrel));
  }
}

// ---- floating parts (`APART`) ----

/** The blow of a model whose parts float apart, for the root: wind W, swing S, reach R, and the height over the ground in game px. */
const BLOW = { W: 0, S: 0, R: 0, y: 0 };
const smooth = (a: number, b: number, x: number): number => ease((x - a) / (b - a));
const sweepOf = (tau: number): number => {
  if (tau < 0) return 0;
  const K = APART.time;
  return tau < MELEE_T ? smooth(0, MELEE_T, tau) : 1 - smooth(K.hold * MELEE_T, K.back * MELEE_T, tau);
};
const reachOf = (tau: number): number => (tau < 0 ? 0 : Math.sin(Math.pow(Math.min(1, tau / (APART.time.reach * MELEE_T)), APART.time.reachPow) * Math.PI));

/**
 * The clocks of the blow: `mem.blowT`, `mem.wind` and `mem.carry` for this frame's animation, and the result in `BLOW`. A melee or a
 * wind-up that begins takes what is left of the blow before it as `carry`, so the swing and the reach do not jump (a second blow in
 * the drift back starts where the parts are); `carry` then decays.
 */
function blowClock(mem: Pose3dMemory, anim: number, animT: number, dt: number): void {
  const K = APART.time, melee = anim === ANIM.Melee, windup = anim === ANIM.Windup;
  const wasWind = mem.prevAnim === ANIM.Windup;
  const meleeStarts = melee && (mem.prevAnim !== ANIM.Melee || animT < mem.prevAnimT);   // its time began (again)
  // A wind-up begins (the frame before was not one: a melee included) or a melee begins out of anything but a wind-up (which holds the carry): the swing and the reach are carried on.
  if ((windup && !wasWind) || (meleeStarts && !wasWind)) {
    const tau = melee ? animT : -1;
    mem.carry[0] = sweepOf(mem.blowT) + mem.carry[0] - sweepOf(tau);
    mem.carry[1] = reachOf(mem.blowT) + mem.carry[1] - reachOf(tau);
  }
  if (meleeStarts) mem.windStart = mem.wind;
  if (melee) mem.blowT = animT;
  else if (windup) { if (!wasWind) mem.blowT = -1; }
  else if (mem.blowT >= 0) { mem.blowT += dt; if (mem.blowT > K.back * MELEE_T) mem.blowT = -1; }
  const follow = 1 - Math.exp(-dt * K.windIn);
  if (windup) mem.wind += (1 - mem.wind) * follow;
  else if (melee) mem.wind = mem.windStart * (1 - smooth(0, K.windOut * MELEE_T, animT));
  else mem.wind -= mem.wind * follow;
  BLOW.W = mem.wind; BLOW.S = sweepOf(mem.blowT) + mem.carry[0]; BLOW.R = reachOf(mem.blowT) + mem.carry[1];
  const keep = Math.exp(-dt * K.carry);
  mem.carry[0] *= keep; mem.carry[1] *= keep;
  mem.prevAnim = anim; mem.prevAnimT = animT;
}

/** three.js's Quaternion.setFromEuler for the order YXZ (the try-out's order for the arms). */
function eulerYXZ(x: number, y: number, z: number, out: Q4): Q4 {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  out[0] = s1 * c2 * c3 + c1 * s2 * s3; out[1] = c1 * s2 * c3 - s1 * c2 * s3; out[2] = c1 * c2 * s3 - s1 * s2 * c3; out[3] = c1 * c2 * c3 + s1 * s2 * s3;
  return out;
}
type Drift = readonly (readonly [number, number, number])[];
const dv: V3 = [0, 0, 0], tv: V3 = [0, 0, 0];
/** One part's slow drift: `[amplitude, rad/s, share of the phase]` per axis, at clock `t` and phase `ph`, into `out`. */
function driftOf(spec: Drift, t: number, ph: number, out: V3): V3 {
  for (let i = 0; i < 3; i++) out[i] = spec[i][0] * Math.sin(spec[i][1] * t + spec[i][2] * ph);
  return out;
}

/**
 * The pose of a model whose parts float apart (`FigureModel.apart`): the hips lean and turn into the blow, the head and each arm drift
 * on their own (a loose shift and a small turn), a blow moves the striking arm's root as well as turning it, and in the ambush the parts
 * drift in from `APART.inside`. A sleeper does not lie down: it hangs lower, the head drooped. The root's height goes to `BLOW.y`.
 */
function apartPose(m: FigureModel, mem: Pose3dMemory, asleep: boolean, anim: number, animT: number, HJ: number, t: number): void {
  const B = APART.body, ST = APART.strike, ph = mem.phase;
  const W = asleep ? 0 : BLOW.W, S = asleep ? 0 : BLOW.S, R = asleep ? 0 : BLOW.R;
  locals[HIPS].rz = -mem.lean + FLOAT.hitLean * HJ + B.lean[0] * W + B.lean[1] * R;
  locals[HIPS].ry = B.yaw[0] * W + B.yaw[1] * S;
  // The ambush: how far each part has come out of the smoke (1: at its place).
  const form = anim === ANIM.Ambush ? smooth(APART.form[0], APART.form[1], animT / AMBUSH_WARNING) : 1;
  const place = (L: BoneLocal, b: number): void => {
    if (form >= 1) return;
    L.tx = APART.inside[0] - m.pivots[b * 3] + (L.tx - (APART.inside[0] - m.pivots[b * 3])) * form;
    L.ty = APART.inside[1] - m.pivots[b * 3 + 1] + (L.ty - (APART.inside[1] - m.pivots[b * 3 + 1])) * form;
    L.tz = APART.inside[2] - m.pivots[b * 3 + 2] + (L.tz - (APART.inside[2] - m.pivots[b * 3 + 2])) * form;
  };
  const head = locals[HEAD];
  if (asleep) head.rz = APART.asleep.droop;
  else {
    driftOf(APART.head.at, t, ph, dv);
    head.tx = dv[0] + APART.headBlow[0] * R; head.ty = dv[1] + APART.headBlow[1] * R; head.tz = dv[2];
    driftOf(APART.head.turn, t, ph, tv);
    head.rx = tv[0]; head.ry = tv[1]; head.rz = tv[2] + APART.head.droop;
    place(head, HEAD);
  }
  if (!asleep) for (let side = 0; side < 2; side++) {
    const sd = side === 0 ? 1 : -1, aph = ph + sd * APART.arm.phase, arm = locals[ARM[side]], hand = locals[HAND[side]];
    driftOf(APART.arm.at, t, aph, dv); driftOf(APART.arm.turn, t, aph, tv);
    let rx = tv[0], ry = tv[1], rz = tv[2], ex = APART.arm.elbow[0] * Math.sin(APART.arm.elbow[1] * t + APART.arm.elbow[2] * aph);
    if (side === 0) {
      dv[0] += ST.at[0][0] * W + ST.at[0][1] * S + ST.at[0][2] * R;
      dv[1] += ST.at[1][0] * W + ST.at[1][1] * S + ST.at[1][2] * R;
      dv[2] += sd * (ST.at[2][0] * W + ST.at[2][1] * S + ST.at[2][2] * R);
      rx += sd * (ST.turn[0][0] * W + ST.turn[0][1] * S + ST.turn[0][2] * R);
      ry += sd * (ST.turn[1][0] * W + ST.turn[1][1] * S + ST.turn[1][2] * R);
      rz += ST.turn[2][0] * W + ST.turn[2][1] * S + ST.turn[2][2] * R;
      ex += ST.elbow[0] * W + ST.elbow[1] * S + ST.elbow[2] * R;
    } else {
      dv[0] += APART.other.at[0] * R; dv[1] += APART.other.at[1] * R; dv[2] += sd * APART.other.at[2] * R;
      rz += APART.other.turn * R;
    }
    arm.tx = dv[0]; arm.ty = dv[1]; arm.tz = dv[2];
    place(arm, ARM[side]);
    useQ(ARM[side], eulerYXZ(rx, ry, rz, qa));
    hand.rz = ex;
  }
  BLOW.y = asleep ? APART.asleep.hover : APART.hover + B.lift[0] * W + B.lift[1] * R;
  if (!asleep) for (const b of FLOAT.bob) BLOW.y += b[0] * Math.sin(b[1] * t + b[2] * ph);
}

export function newPose(yaw: number): Pose3d {
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
  AP.k *= weight; AP.head *= weight; AP.back *= weight; AP.fwd *= weight;
  // The game's lunge: out and back over 0.15 s at the start of a melee animation.
  const lunge = !asleep && anim === ANIM.Melee && d.lunge ? Math.sin(Math.min(animT / LUNGE_SECS, 1) * Math.PI) * weight : 0;
  AP.lunge = lunge;
  const leanBack = windup ? 0.12 : 0;

  // ---- the gait ----
  // A floating model does not read the walk's clock: nothing on it moves in time with its speed.
  const floating = m.gait === 'float' && !m.quad;
  const t = mem.clock, w = floating ? 0 : mem.walk, idle = 1 - w, phi = floating ? 0 : mem.phi;
  const sP = Math.sin(phi), cos2 = Math.cos(2 * phi), breath = asleep ? 0 : Math.sin(t * 2.6);
  const walking = m.gait === 'walk' && !m.quad;
  const A = 0.62 * GAIT.stride, th = (walking ? WALK.swing : A) * sP * w, air = Math.abs(sP), lim = Math.min(1, GAIT.bounce);
  const armAir = walking ? 0 : air;   // the walk does not lift the arms sideways
  const rise = asleep ? 0.03 * (0.5 + 0.5 * Math.sin(t * 1.5)) : 0;   // a sleeper does not breathe; its body slowly swells and sinks
  const k = AP.k;
  let bob = 0;
  /** A floating model: its height over the ground in game px (not scaled by the model), and the limp turn of its arms. */
  let floatY = 0, limp = 0;
  resetLocals();
  const body = locals[BODY], head = locals[HEAD];
  const neck = m.neckBend !== undefined && m.neckBend >= 0 ? m.bends[m.neckBend] : null;
  let nbend = 0;
  if (m.quad) {
    // Bounding: the front pair and the hind pair each move together; highest with the legs stretched, nose up at the take-off.
    const ext = -Math.cos(2 * phi);
    bob = 2.0 * GAIT.bounce * air * w * (m.hop ?? 1);
    let pitch = 0.17 * Math.sin(2 * phi) * w * lim;
    body.sx = 1 + 0.07 * lim * (air - 0.45) * w;
    body.sy = 1 + 0.02 * breath * idle - 0.05 * lim * (air - 0.45) * w + rise;
    pitch -= 0.1 * AP.lunge;   // the bite: the front dips into the lunge
    pitch += 0.18 * HJ;        // a hit rocks it away from the blow
    pitch += leanBack;
    pitch += 0.07 * AP.back - 0.09 * AP.fwd;   // the butt: reared up, then down into the blow
    body.rz = pitch;
    for (const l of legsOf(m)) {
      const sgn = l.front ? 1 : -1, L = locals[l.upper];
      L.rz = A * 1.1 * ext * sgn * w;
      L.ty = Math.sin(pitch) * m.pivots[l.upper * 3];   // the legs stay under the rocking body
      if (l.lower < 0) L.sy = 1 - 0.3 * Math.max(0, -ext) * w;
      else locals[l.lower].rz = -LEG_FOLD * Math.max(0, Math.sin(2 * phi) * sgn) * w;   // the lower leg folds back as the leg swings forward
    }
    if (neck) {
      // The neck bends as a whole; the head follows its end.
      nbend = -0.8 * pitch + 0.05 * GAIT.loose * Math.sin(2 * phi) * w - 0.2 * w + 0.3 * AP.back - 1.05 * AP.fwd;
      const tilt = -0.4 * AP.fwd, look = asleep ? 0 : 0.4 * Math.sin(t * 0.5) * idle * (1 - Math.max(AP.back, AP.fwd));
      const hp = HEAD * 3, vx = m.pivots[hp] - neck.origin[0], vy = m.pivots[hp + 1] - neck.origin[1], c = Math.cos(nbend), sn = Math.sin(nbend);
      head.rz = 0.6 * nbend + tilt + 0.25 * HJ; head.ry = look;
      head.tx = vx * c - vy * sn - vx; head.ty = vx * sn + vy * c - vy;
    } else {
      head.rz = -0.75 * pitch + 0.04 * cos2 * w + 0.02 * breath * idle + AP.head + 0.25 * HJ - 0.3 * AP.back + 0.45 * AP.fwd;   // the head stays level (a butt tilts it)
      head.ty = 0.1 * breath * idle;
    }
    body.sy *= 1 - 0.1 * Math.abs(HJ);
  } else if (floating) {
    // Floating: nothing steps. The legs hang from the hips and trail behind when it moves, bent a little more at the knee; the arms hang and trail less;
    // the head droops; the body leans into its movement. The trailing and the lean follow the speed late.
    const v = mem.speed / 16, kf = 1 - Math.exp(-dt * FLOAT.rate);
    mem.drag += ((asleep ? 0 : Math.min(FLOAT.drag.max, v * FLOAT.drag.per)) - mem.drag) * kf;
    mem.lean += ((asleep ? 0 : Math.min(FLOAT.lean.max, v * FLOAT.lean.per)) - mem.lean) * kf;
    const ph = mem.phase, sway = FLOAT.sway * Math.sin(1.1 * t + ph), D = mem.drag;
    for (const l of m.legs ?? []) {
      const right = m.pivots[l.upper * 3 + 2] > 0;
      locals[l.upper].rz = right ? -(0.03 + D) + FLOAT.spread + sway : -(0.03 + 0.8 * D) - FLOAT.spread - sway;
      if (l.lower >= 0) locals[l.lower].rz = -(FLOAT.knee[0] + FLOAT.knee[1] * D);
    }
    limp = -(FLOAT.arm[0] + FLOAT.arm[1] * D) + 0.03 * Math.sin(0.8 * t + 2 * ph);
    if (m.apart) {
      // Parts that float apart: their own pose and blow (`apartPose`); no legs, no limp arms.
      if (asleep) { mem.blowT = -1; mem.wind = 0; mem.carry[0] = mem.carry[1] = 0; mem.prevAnim = -1; BLOW.W = BLOW.S = BLOW.R = 0; }
      else blowClock(mem, anim, animT, dt);
      apartPose(m, mem, asleep, anim, animT, HJ, t);
      floatY = BLOW.y;
    } else {
      head.rz = -FLOAT.head;
      locals[HIPS].rz = -mem.lean + FLOAT.hitLean * HJ;
      body.sy = 1 + rise;
      if (!asleep) { floatY = FLOAT.hover; for (const b of FLOAT.bob) floatY += b[0] * Math.sin(b[1] * t + b[2] * ph); }
      // The swipe: the body twists and leans into the blow, the head keeps looking at the target.
      if (m.swipe && k > 0) { body.ry += AP.twist * k; body.rz -= AP.lean * k; head.ry -= 0.8 * AP.twist * k; }
      if (HJ) body.sy *= 1 - 0.1 * Math.abs(HJ);
    }
  } else {
    if (walking) {
      // Walking: the legs swing in turn, the knee of the leg coming forward bends back, the body dips as the legs spread (no hop).
      const cP = Math.cos(phi), legs = m.legs ?? [];
      for (const l of legs) {
        const sd = Math.sign(m.pivots[l.upper * 3 + 2]);
        locals[l.upper].rz = WALK.swing * sP * sd * w;
        if (l.lower >= 0) locals[l.lower].rz = -(l.knee ?? 1) * WALK.knee * Math.max(0, cP * sd) * w;
      }
      if (legs.length > 0) bob = (Math.cos(WALK.swing * sP * w) - 1) * m.pivots[legs[0].upper * 3 + 1];
      body.ry = -0.10 * sP * w; body.rz = -0.04 * w;
      body.sy = 1 + 0.02 * breath * idle + rise;
      head.ry = 0.08 * sP * w;
      head.ty = 0.12 * breath * idle;
      if (legs.length === 0) { body.rx = 0.03 * sP * w; body.rz = -0.06 * w; }   // a robe glides: it leans and rocks instead of stepping
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
    }
    if (k > 0) { body.ry += AP.twist * k; body.rz -= AP.lean * k; head.ry -= 0.8 * AP.twist * k; }   // the body twists and leans, the head keeps looking at the target
    body.rz += leanBack;
    if (HJ) { body.rz += 0.32 * HJ; head.rz += 0.22 * HJ; body.sy *= 1 - 0.1 * Math.abs(HJ); }
  }

  // ---- the arms and what they hold ----
  // A floating model's arms hang limp, hand and weapon bones at rest; only a model with the swipe raises the arm its attack uses.
  const apart = floating && !!m.apart;   // its arms are posed by `apartPose`
  const limpArms = floating && !(m.swipe && k > 0);
  if (apart) { /* done above */ }
  else if (limpArms) {
    if (m.armLength > 0) for (let side = 0; side < 2; side++) locals[ARM[side]].rz = limp;
  } else if (m.armLength > 0 && m.elbow !== undefined) elbowArms(m, d, k, 0.16 + 0.05 * w + 0.3 * armAir * w, th * 1.15 * GAIT.armSwing, 0.04 * breath * idle, floating ? limp : undefined);
  else if (m.armLength > 0) {
    for (let side = 0; side < 2; side++) {
      const sd = side === 0 ? 1 : -1;
      if (floating) {
        aboutZ(limp, qa);
        if (!(k > 0 && (side === 0 ? AP.useRight : AP.useLeft))) { useQ(ARM[side], qa); continue; }
      } else eulerQ(-sd * (0.16 + 0.05 * w + 0.3 * armAir * w), 0, -sd * th * 1.15 * GAIT.armSwing + 0.04 * breath * idle, qa);
      if (k > 0 && (side === 0 ? AP.useRight : AP.useLeft)) slerp(qa, fromDown(side === 0 ? AP.right : AP.left, qt), k);
      const long = 1 + ((side === 0 ? AP.longR : AP.longL) - 1) * k * (m.armStretch ?? 1), more = (long - 1) * (m.armLength - m.armRadius);
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
  hat.sx = hat.sy = hat.sz = mem.crest;
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
  // The steps (lunge, jolt, shiver) are the game's px, scaled by the game's figure scale and the fall shrink as the card scales its own.
  const gameScale = (d.scale ?? 1) * fallK;
  R.x = (num(d.lunge) * lunge - 1.6 * HJ - 1.5 * AP.back - (apart ? APART.body.back * BLOW.W : 0)) * gameScale;   // the butt rears back, the lunge goes forward; a wind-up draws the floating body back
  R.y = floating ? floatY : bob * m.scale;   // the hover is the game's px, as the lunge is
  if (windup && !apart) R.z = (Math.floor(t * 40) % 2 ? 1 : -1) * gameScale;   // the shiver of a wind-up: 1 px to either side at 20 Hz
  if (asleep && !apart) {
    R.roll = Math.PI / 2;
    R.y = sideReach(m) * m.scale * (1 - LIE_SINK) * R.sy;   // on its side, sunk a little into the ground
  }
  pose.air = asleep || walking || floating ? 0 : air * w * lim;
  pose.asleep = asleep; pose.channel = anim === ANIM.Channel;
  if (struck && !asleep) { mem.atk.style = style; mem.atk.u = u; pose.attack = mem.atk; }

  // ---- bends and the robe ----
  for (let i = 0; i < m.bends.length && i < MAX_BENDS; i++) {
    const B = m.bends[i];
    if (B.neck) { pose.bends[i * 4] = 0; pose.bends[i * 4 + 1] = 0; pose.bends[i * 4 + 2] = 1; pose.bends[i * 4 + 3] = nbend; continue; }
    const kk = B.k * loose * 1.5;
    let wx = kk * 0.14 * Math.sin(phi - 0.8) * w + B.wag * 0.4 * Math.sin(t * 7) * idle;
    let wy = Math.max(-0.6, Math.min(0.6, -turn * 0.04 * kk));
    let wz = kk * (B.up * 0.12 * w + 0.2 * Math.sin(2 * phi - 1.1) * w + 0.03 * Math.sin(t * 1.7) * idle) - B.up * 0.5 * HJ;   // a hit: the loose end lags behind the knocked body
    if (B.flutter && !asleep) {   // a wing or pennant, also standing
      const beat = B.flutter.angle * Math.sin(2 * Math.PI * B.flutter.rate * t), ax = B.flutter.axis;
      if (ax) { wx += ax[0] * beat; wy += ax[1] * beat; wz += ax[2] * beat; }   // about the axis the description names: a wing beats across its surface
      else wx += Math.sign(B.dir[2] || 1) * beat;   // about the line of sight, the two sides opposite ways
    }
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

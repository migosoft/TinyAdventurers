// The demon's pose (#379): what a snapshot says about the demon (anim, animT, flags, effects, aim, look, its place) turned into what the
// builder reads: the skeleton's joints, a target for each wing (the wing follows it as a chain, wings.ts), the tail's links, the lift.
// Every clock is the memory's own. Pure; a frame allocates nothing.
//
// How a frame is made (`demonPose`): the facing follows the aim as a critically damped spring and the walk phase moves with the way the
// foot point really travelled; the anim's target pose is built on the standing (or the hovering) one, so every attack starts at it; a
// new anim keeps how far the pose shown last was off its target and lets that difference die away (the cross-fade); the wings, the
// tail and the hanging legs follow as chains; on top come the head's turn, the flinch and the settling after a landing.
// The demon is massive: every row leans the other way first, moves the hips before the trunk and the arms, and carries past its end.
import { ANIM, CONST, EFFECT, FLAG } from '../../generated/defs';
import { has } from '../../game/effectBits';
import type { BuiltIn } from '../built';
import { ARM, FOOT, J, JOINTS, LEAN, RIG, ROLL, TURN } from './skeleton';
import { beatTarget, chainStep, newWing, WING, wingStep, type WingState, type WingTarget } from './wings';

/** The tail's links: a swing travels down them. */
export const TAIL_LINKS = 6;

export interface DemonPose {
  /** The skeleton's joint values, by `J` (skeleton.ts): rad, and builder units for the hips' place and the foot points. */
  joints: Float32Array;
  wingR: WingState; wingL: WingState;
  /** Per link [yaw (+ to the demon's right), pitch (+ up)]: rad away from the link's rest direction, in the hips' frame. All equal: the tail turns as a whole. */
  tail: Float32Array;
  /** Builder units the body hangs above the floor, without the beat's bob (that is in the hips). The view lifts the figure; the builder reads it only for the feet (the toes hang in the air). */
  lift: number;
  /** The glow of the eyes and the mouth: 1 at rest. */
  heat: number;
  /** The hand the `hand` anchor follows: 1 the right, -1 the left. */
  caster: 1 | -1;
}

const DEG = Math.PI / 180;

/**
 * Every tuning number of the poses. Angles rad, lengths builder units, times s.
 * - `armOut`, `elbow`: the standing arms. `px`: builder units per game px.
 * - `ease`: the cross-fade after a new anim; `easeFrom`: the same after the anim named (a heavy move is caught slowly).
 * - `lift`: how high the body hangs in the air; `liftAtTakeoff`: its share at the take-off's end; `bob`: the rise and fall with the
 *   beat, crest to trough, highest at the beat's phase `bobAt`; `labour`: the first beats after a take-off (how many, their share of
 *   the beat's length, how much deeper they reach and bob).
 * - `faceRate`: 1/s of the facing's spring; `turnMax`: the most turning speed (rad/s) the wings and the tail feel; `headRate`, `neck`,
 *   `headShare` (chest, neck, head), `headRoll` (per rad of turn), `headKeep` (how much of the trunk's own turn the head takes back),
 *   `airLook`: the look down in the air.
 * - `hurt`: the flinch's length; `hurtHead`, `hurtChest`: how far the blow pushes the head's middle (at the height `headMid`) and the
 *   shoulders; `hurtWing`: how far the wings flick open.
 * - `stride`: the body's way per footfall; `turnStep`: rad turned per footfall; `gait`: 1/s the stride comes and goes, and the footfalls a
 *   second below which it stands.
 * - `stand`, `walk`, `claws`, `tail`, `swoop`, `cast`, `breath`, `air`, `takeoff`, `land`, `settle`: the rows' angles and times (the
 *   server's times are `CONST.DEMON_*`).
 */
export const DEMON_POSE = {
  armOut: 0.16, elbow: 0.5, px: 31.7 / 54,
  ease: 0.15,
  easeFrom: { [ANIM.Land]: 0.45, [ANIM.Dash]: 0.5, [ANIM.Melee]: 0.4, [ANIM.Tail]: 0.4, [ANIM.Cast]: 0.3, [ANIM.Breath]: 0.45, [ANIM.TakeOff]: 0.3 } as Record<number, number>,
  lift: (17 * 31.7) / 54, liftAtTakeoff: 0.6, bob: 2.4, bobAt: 0.46, labour: { beats: 2, pace: 0.85, deep: 1.15, bob: 1.8 },
  faceRate: 4, turnMax: 2.5, headRate: 5, neck: 1.4, headShare: [0.15, 0.35, 0.5], headRoll: 0.12, headKeep: 0.8, airLook: 20 * DEG,
  hurt: 0.22, hurtHead: 1.2, hurtChest: 0.4, hurtWing: 0.08, headMid: 29.8,
  stride: 20, turnStep: Math.PI / 2, gait: { rate: 5, min: 0.08 },
  stand: {
    breath: 3.4, breathHips: 0.22, breathChest: 0.035, breathArms: 0.03, breathWing: [0.045, 0.025],
    shift: 9, shiftZ: 1.1, shiftRoll: 0.035, tail: [0.2, 5.3], tailDroop: 0.04,
    drift: [0.03, 0.025], resettle: [7.5, 1.5, 0.5, 0.3],
  },
  walk: {
    /** The share of a leg's cycle its foot stands; how far ahead of the hips the stride's middle lies; the swinging foot's height. */
    stance: 0.5, ahead: 2.5, up: 3.2, toeOff: 0.55,
    low: 1.4, drop: 1.5, dropAt: 0.07, lean: 6 * DEG, sway: 1.3, roll: 0.04, twist: 0.1, arms: 0.3, elbows: 0.15,
    nod: 0.06, nodAt: 0.16, tail: 0.28, tailBounce: 0.1, wings: 0.14, wingsAt: 0.12,
  },
  claws: {
    /** The strike's length (it is at its middle when the server's blow lands); how far the wind-up reaches. */
    strike: 0.12, back: 2.4, into: 3.4, low: 1.2, hipsTurn: [0.28, 0.2], chestTurn: [0.5, 0.5], lean: [0.1, 0.3],
    arm: { back: [-0.5, 1.9, -1.3, 1.3], through: [1.25, 0.35, 0.9, 0.35], other: [0.35, -0.5] }, spread: -0.7,
    step: 4.5, stepUp: 1.6, wing: { fold: 0.3, sweep: 0.3, jerk: 0.35 },
  },
  tail: {
    coil: 1.0, whip: 1.9, up: 0.22, hips: [0.3, 0.55], chest: 0.5, low: 1.6, wide: 1.6, hop: 0.9,
    wing: { raise: 25 * DEG, fold: 0.5 }, arms: 0.35, rates: [44, 38, 32, 27, 22, 18],
  },
  swoop: {
    crouch: 4.8, bow: 0.3, armsBack: 0.6, wingUp: { fold: 0.05, raise: 35 * DEG },
    lean: 0.95, low: 3.2, legs: [-9, 3.4], arms: [1.75, 0.3, 0.15], head: 0.75, tail: 0.45,
    glide: { fold: 0, raise: 8 * DEG, sweep: 15 * DEG, pitch: -75 * DEG },
    brake: { fold: 0, raise: 60 * DEG, sweep: -8 * DEG, pitch: 12 * DEG }, back: 0.22, knees: 6.2, feet: 4.5,
  },
  cast: { rise: 0.46, hold: 0.62, arm: [1.08, 0.12, 0, 0.1], airArm: [0.8, 0.12, 0, 0.1], wrist: -0.35, spread: -0.8, dip: 0.07, turn: 0.12, wing: 0.34 },
  breath: {
    back: [0.2, 0.3, 0.32], hips: 1.2, fill: 0.14, heat: 1.8, forward: [0.2, 0.16, 0.08], head: -0.18, into: 1.8,
    tremble: [0.02, 38, 0.035, 31], wing: { raise: 25 * DEG, fold: 0.25 }, arms: [0.3, 0.25], flicker: 0.12,
  },
  air: {
    /** The hanging right foot (off the standing foot point) and how much higher and further forward the left is drawn up. */
    hang: [-1.6, -3.2], tuck: [2, 4], swing: 11, legRates: [7, 5], legSwing: 0.03, legLean: 0.8,
    rock: 0.07, arms: [0.12, 0.24, 0.7], head: [0.14, 0.2], tail: [-0.3, 0.035],
    lean: 12 * DEG, leanAt: 30, velRate: 4, sweep: 0.5,
  },
  takeoff: {
    gather: 0.28, crouch: 5.2, bow: [0.3, 0.16], arms: [0.25, 1.35], tail: 0.3, wing: { raise: 70 * DEG, low: -40 * DEG, lead: 0.06 },
    slow: 1.3, throwArms: [-0.75, 0.2], whip: -0.75, toes: 2.6, look: 0.22,
  },
  land: {
    wing: { fold: 0, raise: 22 * DEG, sweep: 0.12, pitch: -75 * DEG }, fall: 2.2, reach: [0.18, 0.55], stand: 2.6, arms: [0.55, 0.3],
    bow: 0.14, look: 0.25, tail: 0.35,
  },
  settle: {
    /** The knees give `deep` within `in` and come up until `up`; the second, smaller settling `again` around `at` for `for`; the whole is over at `end`. */
    deep: 6, in: 0.3, up: 1.05, again: 1.4, at: 1.35, for: 0.6, end: 1.8,
    bow: 0.3, nod: 0.42, nodLate: 0.06, tail: 0.65, wing: { down: 0.6, open: 0.3, shake: [0.07, 42, 5] },
  },
} as const;

/** The dev page's hand on the wings (the act `wings`, demonStage.ts): a fold their target takes instead of the pose's. null in a run. */
export const DEMON_DEV: { fold: number | null } = { fold: null };

export function restPose(): DemonPose {
  const joints = new Float32Array(JOINTS);
  for (const [a, f, sd] of [[J.armR, J.footR, 1], [J.armL, J.footL, -1]] as const) {
    joints[a + ARM.out] = DEMON_POSE.armOut; joints[a + ARM.elbow] = DEMON_POSE.elbow;
    joints[f + FOOT.x] = RIG.sole[0]; joints[f + FOOT.y] = RIG.sole[1]; joints[f + FOOT.z] = sd * RIG.legZ;
  }
  return { joints, wingR: newWing(WING.rest), wingL: newWing(WING.rest), tail: new Float32Array(TAIL_LINKS * 2), lift: 0, heat: 1, caster: 1 };
}

/**
 * What one demon keeps between frames. `t`: its clock; `face`, `faceV`: the drawn facing and its speed; `head`, `headV`: the head's
 * turn; `walk`: the walk phase in cycles (two footfalls each); `gait`, `go`: how much it steps, and how much of that is a stride;
 * `beat`: the wings' phase; `climb`: s in the air since a take-off (large: at full height); `landT`: s since it touched down;
 * `from`: how far the pose shown last was off the new anim's target (joints, lift, heat), fading for `easeFor` since `fromT`;
 * `base`: the faded joints, under the head, the flinch and the settling; `turn`: which arm is next (claws and casts take turns),
 * `side`: the one in use; `vx`, `vz`: the eased speed over the floor (units/s); `legs`: the hanging legs' swing ([right, left] pairs
 * of chainStep); `wr`, `wl`: scratch, the wings' targets.
 */
export interface DemonMem {
  started: boolean; t: number; face: number; faceV: number; head: number; headV: number; walk: number; gait: number; go: number; lastX: number; lastZ: number;
  lastAnim: number; lastAnimT: number; airborne: boolean; beat: number; climb: number; landT: number; fromT: number; from: DemonPose; easeFor: number;
  hurtT: number; hurtDir: number; lastHurt: boolean; turn: 1 | -1; side: 1 | -1; vx: number; vz: number;
  base: Float32Array; tailV: Float32Array; legs: Float32Array; legsV: Float32Array; wr: WingTarget; wl: WingTarget;
  pose: DemonPose; target: DemonPose;
}

export function newDemonMem(): DemonMem {
  return {
    started: false, t: 0, face: 0, faceV: 0, head: 0, headV: 0, walk: 0, gait: 0, go: 0, lastX: 0, lastZ: 0,
    lastAnim: ANIM.Idle, lastAnimT: 0, airborne: false, beat: 0, climb: 99, landT: 99, fromT: 99, from: restPose(), easeFor: DEMON_POSE.ease,
    hurtT: -1, hurtDir: 0, lastHurt: false, turn: 1, side: 1, vx: 0, vz: 0,
    base: new Float32Array(JOINTS), tailV: new Float32Array(TAIL_LINKS * 2), legs: new Float32Array(4), legsV: new Float32Array(4), wr: { ...WING.rest }, wl: { ...WING.rest },
    pose: restPose(), target: restPose(),
  };
}

const P = DEMON_POSE;
const REST = restPose().joints;
const TAU = 2 * Math.PI;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const S = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const bell = (x: number): number => { const s = Math.sin(Math.PI * clamp(x, 0, 1)); return s * s; };
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const frac = (x: number): number => x - Math.floor(x);
const hash = (n: number): number => frac(Math.sin(n * 12.9898 + 4.1) * 43758.5453);
/** A footfall's jolt over the step's phase `w`: 1 at the lowest point, a little after the foot lands. */
const dip = (w: number, at: number): number => Math.pow(0.5 + 0.5 * Math.cos(TAU * (w - at)), 1.5);

/** A critically damped spring's step, exact for any `dt`: `x` (and its speed `v`) towards 0. The result is in `SX`, `SV`. */
let SX = 0, SV = 0;
function spring(x: number, v: number, rate: number, dt: number): void {
  const k = (v + rate * x) * dt, e = Math.exp(-rate * dt);
  SX = (x + k) * e; SV = (v - rate * k) * e;
}

/** The tail's root this frame (the links follow it). */
let tailYaw = 0, tailPitch = 0;
/** A wing's target goes `w` of the way to what `to` names. */
const wing = (T: WingTarget, w: number, to: { readonly fold?: number; readonly raise?: number; readonly sweep?: number; readonly pitch?: number }): void => {
  if (to.fold !== undefined) T.fold += (to.fold - T.fold) * w;
  if (to.raise !== undefined) T.raise += (to.raise - T.raise) * w;
  if (to.sweep !== undefined) T.sweep += (to.sweep - T.sweep) * w;
  if (to.pitch !== undefined) T.pitch += (to.pitch - T.pitch) * w;
};
/** An arm's swing, out, twist and elbow go `w` of the way to `to`. */
const arm = (q: Float32Array, a: number, w: number, to: readonly number[]): void => {
  q[a + ARM.swing] += (to[0] - q[a + ARM.swing]) * w; q[a + ARM.out] += (to[1] - q[a + ARM.out]) * w;
  q[a + ARM.twist] += (to[2] - q[a + ARM.twist]) * w; q[a + ARM.elbow] += (to[3] - q[a + ARM.elbow]) * w;
};

// ---------------------------------------------------------------- the rows
/** Standing: slow deep breaths, the weight shifting from leg to leg, the tail swaying; the wings never still. */
function stand(q: Float32Array, m: DemonMem): void {
  const A = P.stand, t = m.t, b = Math.sin((TAU * t) / A.breath), sh = Math.sin((TAU * t) / A.shift), shift = sh * Math.abs(sh);
  q.set(REST);
  q[J.hipsY] -= A.breathHips * b; q[J.chest + LEAN] -= A.breathChest * b; q[J.spine + LEAN] -= A.breathChest * 0.5 * b;
  q[J.armR + ARM.out] += A.breathArms * b; q[J.armL + ARM.out] += A.breathArms * b;
  q[J.hipsZ] += A.shiftZ * shift; q[J.hips + ROLL] += A.shiftRoll * shift; q[J.spine + ROLL] -= A.shiftRoll * shift;
  tailYaw = A.tail[0] * Math.sin((TAU * t) / A.tail[1]); tailPitch = -A.tailDroop * b;
  // each wing rises and opens a little with the breath, drifts on its own, and resettles now and then
  const R = A.resettle, n = Math.floor(t / R[0]), since = t - n * R[0] - hash(n) * R[1], re = bell(since / R[2]);
  for (let i = 0; i < 2; i++) {
    const T = i === 0 ? m.wr : m.wl;
    T.fold = WING.rest.fold - A.breathWing[1] * b + A.drift[1] * Math.sin(t * (0.31 + i * 0.09) + i * 2.1); T.raise = WING.rest.raise + A.breathWing[0] * b + A.drift[0] * Math.sin(t * (0.43 - i * 0.11) + 1 + i);
    T.sweep = WING.rest.sweep + A.drift[0] * Math.sin(t * (0.23 + i * 0.07) + 3 * i); T.pitch = WING.rest.pitch;
    T.fold += (R[3] - T.fold) * re;
  }
}

/** Walking, and stepping round in a turn: slow long steps, the body dropping onto each footfall, the jolt running up to the head, the wings and the tail. */
function gait(q: Float32Array, m: DemonMem): void {
  const A = P.walk, g = m.gait, go = g * m.go, ph = m.walk, w = frac(2 * ph), c = Math.cos(TAU * ph), s = Math.sin(TAU * ph);
  if (g < 1e-4) return;
  for (let i = 0; i < 2; i++) {
    const f = i === 0 ? J.footR : J.footL, u = frac(ph + i * 0.5), half = P.stride * A.stance;
    if (u < A.stance) {
      const st = u / A.stance;
      q[f + FOOT.x] += (half * (1 - 2 * st) + A.ahead) * go; q[f + FOOT.toes] += A.toeOff * S(0.6, 1, st) * go;
    } else {
      const sw = (u - A.stance) / (1 - A.stance);
      q[f + FOOT.x] += (half * (2 * S(0, 1, sw) - 1) + A.ahead) * go; q[f + FOOT.y] += A.up * Math.sin(Math.PI * sw) * g; q[f + FOOT.toes] += A.toeOff * (1 - S(0, 0.35, sw)) * go;
    }
  }
  q[J.hipsY] -= (A.low * go + A.drop * dip(w, A.dropAt)) * g; q[J.hipsX] += A.ahead * 0.4 * go;
  // over the standing leg (the right stands in the cycle's first half)
  q[J.hipsZ] += A.sway * s * g; q[J.hips + ROLL] += A.roll * s * g; q[J.spine + ROLL] -= A.roll * s * g;
  q[J.spine + LEAN] += A.lean * go; q[J.neck + LEAN] += A.nod * dip(w, A.nodAt) * g - A.lean * 0.5 * go;
  q[J.hips + TURN] -= A.twist * c * go; q[J.chest + TURN] += 2 * A.twist * c * go;
  q[J.armR + ARM.swing] -= A.arms * c * go; q[J.armL + ARM.swing] += A.arms * c * go;
  q[J.armR + ARM.elbow] += A.elbows * (1 - c) * go; q[J.armL + ARM.elbow] += A.elbows * (1 + c) * go;
  tailYaw += A.tail * s * go; tailPitch -= A.tailBounce * dip(w, A.nodAt) * g;
  const bounce = A.wings * dip(w, A.wingsAt) * g;
  m.wr.raise -= bounce; m.wl.raise -= bounce;
}

/** Claws: the weight onto the back leg, a step into the strike, the swing carrying the trunk past the target, the recovery catching it. */
function claws(q: Float32Array, m: DemonMem, t: number, g: number): void {
  const A = P.claws, W = CONST.DEMON_CLEAVE_WINDUP, sd = m.side, a = sd > 0 ? J.armR : J.armL, o = sd > 0 ? J.armL : J.armR;
  const w = S(0, W * 0.85, t), k = S(W - A.strike / 2, W + A.strike / 2, t), r = S(W + A.strike, W + CONST.DEMON_CLEAVE_RECOVER + 0.2, t), back = w * (1 - k), thru = k * (1 - r);
  q[J.hipsX] += (-A.back * back + A.into * thru) * g; q[J.hipsY] -= A.low * (back + thru) * g;
  q[J.hips + TURN] += sd * (A.hipsTurn[0] * back - A.hipsTurn[1] * thru) * g;
  // the shoulders wind up later than the hips and swing through after them
  const late = S(W * 0.15, W * 0.95, t) * (1 - k);
  q[J.chest + TURN] += sd * (A.chestTurn[0] * late - A.chestTurn[1] * thru); q[J.spine + LEAN] += -A.lean[0] * back + A.lean[1] * thru;
  q[J.chest + ROLL] += sd * 0.12 * (late - thru);
  arm(q, a, late, A.arm.back); arm(q, a, k * (1 - r), A.arm.through);
  q[a + ARM.curl] += A.spread * Math.max(late, thru); q[a + ARM.thumb] += A.spread * Math.max(late, thru);
  q[o + ARM.swing] += A.arm.other[0] * late + A.arm.other[1] * thru;
  // the far foot steps into the strike and comes back in the recovery
  const f = sd > 0 ? J.footL : J.footR, out = S(W - 0.2, W, t), home = S(W + 0.14, W + CONST.DEMON_CLEAVE_RECOVER, t);
  q[f + FOOT.x] += A.step * (out - home) * g; q[f + FOOT.y] += A.stepUp * (bell(out) + bell(home)) * g;
  if (g > 0) {
    const T = sd > 0 ? m.wr : m.wl;
    T.fold += (A.wing.fold - T.fold) * late; T.sweep += A.wing.sweep * late;
    m.wr.sweep -= A.wing.jerk * thru; m.wl.sweep -= A.wing.jerk * thru;
  }
}

/** Tail whip: the feet set wide, the tail coils to one side with the hips turned against it, then whips round behind. */
function tailWhip(q: Float32Array, m: DemonMem, t: number): void {
  const A = P.tail, W = CONST.DEMON_TAIL_WINDUP, w = S(0, W * 0.9, t), k = S(W - 0.06, W + 0.1, t), r = S(W + 0.18, W + CONST.DEMON_TAIL_RECOVER + 0.15, t), coil = w * (1 - k), thru = k * (1 - r);
  tailYaw += A.coil * coil - A.whip * thru; tailPitch += A.up * (coil + thru);
  const hips = -A.hips[0] * coil + A.hips[1] * thru;
  q[J.hips + TURN] += hips; q[J.chest + TURN] -= A.chest * hips; q[J.hipsY] -= A.low * (w - r);
  const wide = S(0, W * 0.7, t) - S(W + 0.25, W + CONST.DEMON_TAIL_RECOVER, t), hop = bell(t / (W * 0.7)) + bell((t - W - 0.25) / (CONST.DEMON_TAIL_RECOVER - 0.25));
  q[J.footR + FOOT.z] += A.wide * wide; q[J.footL + FOOT.z] -= A.wide * wide;
  q[J.footR + FOOT.y] += A.hop * hop * (t < W ? 1 : 0.6); q[J.footL + FOOT.y] += A.hop * hop * (t < W ? 0.6 : 1);
  q[J.armR + ARM.out] += A.arms * (coil + thru); q[J.armL + ARM.out] += A.arms * (coil + thru);
  q[J.armR + ARM.swing] += A.arms * (coil - thru); q[J.armL + ARM.swing] -= A.arms * (coil - thru);
  const up = w * (1 - S(W + 0.3, W + CONST.DEMON_TAIL_RECOVER + 0.1, t));
  wing(m.wr, up, { raise: A.wing.raise, fold: A.wing.fold }); wing(m.wl, up, { raise: A.wing.raise, fold: A.wing.fold });
}

/** Swoop: a long crouch with the wings opening, the low glide with the claws ahead and the legs trailing, the braking slide into deep knees. */
function swoop(q: Float32Array, m: DemonMem, t: number): void {
  const A = P.swoop, W = CONST.DEMON_SWOOP_WINDUP, E = W + CONST.DEMON_SWOOP_TIME;
  const w = S(0, W * 0.8, t), k = S(W - 0.06, W + 0.14, t), b = S(E - 0.08, E + 0.1, t), crouch = w * (1 - k), fly = k * (1 - b);
  q[J.hipsY] -= A.crouch * crouch + A.low * fly + A.knees * b; q[J.hipsX] += -1.5 * crouch + 2 * fly - 2.5 * b;
  q[J.spine + LEAN] += A.bow * crouch - A.back * b; q[J.hips + LEAN] += A.lean * fly; q[J.chest + LEAN] += A.bow * 0.5 * crouch - A.back * 0.5 * b;
  q[J.neck + LEAN] -= A.head * 0.5 * fly; q[J.head + LEAN] -= A.head * 0.5 * fly;
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? J.armR : J.armL, f = i === 0 ? J.footR : J.footL;
    q[a + ARM.swing] += -A.armsBack * crouch + A.arms[0] * fly + 0.5 * b; q[a + ARM.out] += A.arms[1] * (fly + b);
    q[a + ARM.elbow] += 0.5 * crouch + (A.arms[2] - P.elbow) * fly; q[a + ARM.curl] -= 0.6 * fly; q[a + ARM.thumb] -= 0.6 * fly;
    // the legs trail in the glide (the left a little behind the right) and are thrown ahead to brake
    q[f + FOOT.x] += (A.legs[0] - i * 1.5) * fly + A.feet * b; q[f + FOOT.y] += A.legs[1] * fly + 1.2 * bell((t - E + 0.1) / 0.2);
  }
  tailPitch += -0.25 * crouch + A.tail * fly - 0.3 * b;
  for (let i = 0; i < 2; i++) {
    const T = i === 0 ? m.wr : m.wl;
    wing(T, w, A.wingUp); wing(T, k, A.glide); wing(T, b, A.brake);
  }
}

/** Casting: the one light thing it does; the arm still rises slowly and falls back by its weight. */
function cast(q: Float32Array, m: DemonMem, t: number, g: number): void {
  const A = P.cast, sd = m.side, a = sd > 0 ? J.armR : J.armL, end = CONST.DEMON_CAST_WINDUP + CONST.DEMON_CAST_RECOVER;
  const fall = clamp((t - A.hold) / (end + 0.12 - A.hold), 0, 1), up = S(0, A.rise, t) * (1 - fall * fall), dipped = bell(t / (A.rise * 0.7));
  arm(q, a, up, g > 0 ? A.arm : A.airArm);
  q[a + ARM.wristBend] += A.wrist * up; q[a + ARM.curl] += A.spread * up; q[a + ARM.thumb] += A.spread * up;
  // the shoulder dips away before the arm comes up, then the chest turns a little behind the arm
  q[J.chest + TURN] += sd * A.turn * (dipped * 0.8 - up); q[J.chest + ROLL] += sd * A.dip * (dipped - up * 0.5); q[J.hipsX] -= 0.6 * up * g;
  if (g > 0) { const T = sd > 0 ? m.wr : m.wl; T.fold += (A.wing - T.fold) * up; }
}

/** Fire Breath: the head back and the chest filling, then the lean into it with the jaw wide open, trembling. Returns the glow of the face. */
function breath(q: Float32Array, m: DemonMem, t: number, g: number): number {
  const A = P.breath, W = CONST.DEMON_BREATH_WINDUP, w = S(0, W * 0.85, t), c = S(W - 0.1, W + 0.12, t), back = w * (1 - c), tr = c * Math.sin(m.t * A.tremble[1]);
  q[J.spine + LEAN] += (-A.back[0] * back + A.forward[0] * c) * (0.4 + 0.6 * g); q[J.chest + LEAN] += -A.fill * back + A.forward[1] * c;
  q[J.neck + LEAN] += -A.back[1] * back + A.forward[2] * c; q[J.head + LEAN] += -A.back[2] * back + A.head * c + A.tremble[0] * tr;
  q[J.head + ROLL] += A.tremble[0] * c * Math.sin(m.t * A.tremble[1] * 0.73);
  q[J.hipsX] += (-A.hips * back + A.into * c) * g; q[J.hipsY] -= 0.8 * c * g;
  q[J.jaw] = Math.max(q[J.jaw], 0.25 * S(W * 0.5, W * 0.9, t), c);
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? J.armR : J.armL;
    q[a + ARM.out] += A.arms[0] * w; q[a + ARM.swing] += -A.arms[1] * back + A.arms[1] * c; q[a + ARM.curl] -= 0.4 * c;
    if (g > 0) { const T = i === 0 ? m.wr : m.wl; wing(T, w, A.wing); T.raise += A.tremble[2] * c * Math.sin(m.t * A.tremble[3] + i * 1.7); }
  }
  return 1 + (A.heat - 1) * w + A.flicker * tr;
}

/** How far the body is above (+) or below its mean height at the beat's phase, and how fast it rises (units per beat), for `deep` times the bob. */
let BOB = 0, BOBV = 0;
function bob(phase: number, deep: number): void {
  const a = (P.bob / 2) * deep, x = TAU * (phase - P.bobAt);
  BOB = a * Math.cos(x); BOBV = -a * TAU * Math.sin(x);
}

/** In the air: hanging on the wings, sagging between the strokes; one leg drawn up, the other long; leaning into the way it flies. */
function hover(q: Float32Array, m: DemonMem, labour: number): void {
  const A = P.air, t = m.t, b = Math.sin((TAU * t) / P.stand.breath);
  q.set(REST);
  bob(m.beat, 1 + (P.labour.bob - 1) * labour);
  q[J.hipsY] += BOB;
  // the trunk rocks back on the down stroke; the arms hang a little forward and bent
  const down = Math.cos(TAU * (m.beat - WING.down / 2));
  q[J.spine + LEAN] -= A.rock * (0.4 + 0.6 * down); q[J.chest + LEAN] -= P.stand.breathChest * b;
  q[J.neck + LEAN] += A.head[0] + A.rock * 0.5 * down; q[J.head + LEAN] += A.head[1];
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? J.armR : J.armL, f = i === 0 ? J.footR : J.footL;
    q[a + ARM.swing] += A.arms[0] + 0.05 * down; q[a + ARM.out] += A.arms[1] * (0.6 + 0.4 * i) - 0.04 * down; q[a + ARM.elbow] += (A.arms[2] - P.elbow) * (1 - 0.3 * i);
    q[f + FOOT.x] += A.hang[0] + i * A.tuck[0]; q[f + FOOT.y] += A.hang[1] + i * A.tuck[1];
  }
  // flying, it leans into its way and the wings sweep with it
  const cf = Math.cos(m.face), sf = Math.sin(m.face), fwd = clamp((m.vx * cf + m.vz * sf) / A.leanAt, -1, 1), side = clamp((-m.vx * sf + m.vz * cf) / A.leanAt, -1, 1);
  q[J.hips + LEAN] += A.lean * fwd; q[J.hips + ROLL] += A.lean * side;
  tailYaw = P.stand.tail[0] * Math.sin((TAU * t) / P.stand.tail[1]) - 0.5 * A.lean * side; tailPitch = A.tail[0] + A.tail[1] * BOBV + 1.2 * A.lean * fwd;
  beatTarget(m.beat, m.wr);
  if (labour > 0) { const mid = (WING.stroke.raise[0] + WING.stroke.raise[1]) / 2; m.wr.raise = mid + (m.wr.raise - mid) * (1 + (P.labour.deep - 1) * labour); }
  m.wr.sweep += A.sweep * A.lean * fwd;
  m.wl.fold = m.wr.fold; m.wl.raise = m.wr.raise; m.wl.sweep = m.wr.sweep; m.wl.pitch = m.wr.pitch;
  m.wr.raise -= 0.6 * A.lean * side; m.wl.raise += 0.6 * A.lean * side;
}

const GATHER: WingTarget = { fold: 0, raise: 0, sweep: 0, pitch: 0 };
/** Taking off: a deep crouch while the wings rise and open, then the legs and one hard down stroke push the weight off the floor. Returns the lift. */
function takeOff(q: Float32Array, m: DemonMem, t: number): number {
  const A = P.takeoff, G = A.gather, u = clamp((t - G) / (CONST.DEMON_TAKEOFF - G), 0, 1), w = S(0, G * 0.9, t), push = u * u * (3 - 2 * u), down = w * (1 - S(0, 0.7, u));
  // the body starts slowly, and at the anim's end it hangs at the top of its hop (the beat's bob takes it on from there)
  const lift = P.lift * P.liftAtTakeoff * S(0, 1, Math.pow(u, A.slow));
  if (u > 0) m.beat = WING.down * u;
  bob(WING.down * u, P.labour.bob);
  q[J.hipsY] += -A.crouch * w * (1 - push) + BOB * push; q[J.hipsX] -= 1.2 * down;
  q[J.spine + LEAN] += A.bow[0] * down - 0.06 * push; q[J.chest + LEAN] += A.bow[1] * down - 0.05 * push; q[J.neck + LEAN] += 0.1 * down - A.look * push;
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? J.armR : J.armL, f = i === 0 ? J.footR : J.footL, off = S(0.6, 1, u);
    q[a + ARM.swing] += A.arms[0] * w * (1 - push) + A.throwArms[0] * push; q[a + ARM.elbow] += (A.arms[1] - P.elbow) * w * (1 - push) + (A.throwArms[1] - P.elbow) * push; q[a + ARM.out] += 0.2 * push;
    // the feet stay on the floor while the legs stretch, and leave it last
    q[f + FOOT.y] += -lift + (A.toes + i * P.air.tuck[1] * 0.4) * off; q[f + FOOT.x] += (P.air.hang[0] + i * P.air.tuck[0] * 0.4) * off;
  }
  tailPitch += A.tail * down + A.whip * bell(u * 0.9);
  for (let i = 0; i < 2; i++) {
    const T = i === 0 ? m.wr : m.wl;
    // the stroke's target runs ahead of the push by the chain's lag, so the wing itself is down when the anim ends
    const uw = clamp((t - G + A.wing.lead) / (CONST.DEMON_TAKEOFF - G - A.wing.lead), 0, 1);
    if (uw > 0) { beatTarget(WING.down * uw, T); T.raise = A.wing.raise + (A.wing.low - A.wing.raise) * S(0, 1, uw); } else { beatTarget(0, GATHER); GATHER.raise = A.wing.raise; wing(T, S(0, (G - A.wing.lead) * 0.9, t), GATHER); }
  }
  return lift;
}

/** Landing: the wings up and broad against the air, the body dropping faster and faster, the legs reaching for the floor. Returns the lift. */
function land(q: Float32Array, m: DemonMem, t: number): number {
  const A = P.land, u = clamp(t / CONST.DEMON_LAND, 0, 1), lift = P.lift * (1 - Math.pow(u, A.fall)), w = S(0, 0.3, u), r = S(A.reach[0] / CONST.DEMON_LAND, A.reach[1] / CONST.DEMON_LAND, u);
  q[J.hipsY] += (A.stand - q[J.hipsY] + REST[J.hipsY]) * r;
  q[J.spine + LEAN] += A.bow * w; q[J.neck + LEAN] += A.look * w;
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? J.armR : J.armL, f = i === 0 ? J.footR : J.footL;
    q[a + ARM.out] += A.arms[0] * w; q[a + ARM.swing] += A.arms[1] * w;
    q[f + FOOT.x] += (REST[f + FOOT.x] - q[f + FOOT.x]) * r; q[f + FOOT.y] += (-lift - q[f + FOOT.y]) * r;
  }
  tailPitch += A.tail * w;
  wing(m.wr, w, A.wing); wing(m.wl, w, A.wing);
  return lift;
}

/** Standing and walking are one pose (the steps come and go with the way travelled): a change between them is no new anim. */
const ATTACK = (anim: number): boolean => anim !== ANIM.Idle && anim !== ANIM.Move;

/** The pose of this frame, written into the memory's own objects (no allocation). */
export function demonPose(s: BuiltIn, dt: number, m: DemonMem): DemonPose {
  const first = !m.started, pose = m.pose;
  // frozen or stone: every clock of the figure stands still
  if (!first && (has(s.effects, EFFECT.Frozen) || has(s.effects, EFFECT.Petrified))) return pose;
  // the first sight and a long frame (the tab was away) show the target at once: no spring, no fade
  const jump = first || !(dt <= WING.maxDt), air = (s.flags & FLAG.AIRBORNE) !== 0, q = m.target.joints;
  m.t += dt;

  // the facing: a spring towards the aim, so a turn starts slowly; the walk phase: the way the foot point travelled, and the angle turned
  const toUnits = CONST.TILE * P.px;
  if (jump) { m.face = wrap(s.aim); m.faceV = 0; m.vx = m.vz = 0; m.gait = 0; }
  else if (dt > 0) {
    const was = m.face;
    spring(wrap(was - s.aim), m.faceV, P.faceRate, dt);
    m.face = wrap(s.aim + SX); m.faceV = SV;
    const dx = (s.x - m.lastX) * toUnits, dz = (s.z - m.lastZ) * toUnits, went = Math.hypot(dx, dz) / (2 * P.stride), turned = Math.abs(wrap(m.face - was)) / (2 * P.turnStep);
    const e = 1 - Math.exp(-dt * P.gait.rate), stepping = (went + turned) / dt > P.gait.min / 2;
    m.walk += went + turned;
    // an attack has its own feet
    m.gait = ATTACK(s.anim) ? 0 : m.gait + ((stepping ? 1 : 0) - m.gait) * e;
    if (stepping) m.go += (went / (went + turned) - m.go) * e;
    const ev = 1 - Math.exp(-dt * P.air.velRate);
    m.vx += (dx / dt - m.vx) * ev; m.vz += (dz / dt - m.vz) * ev;
  }
  m.lastX = s.x; m.lastZ = s.z;

  // a new anim (or the same attack begun again): the arms take turns, the clocks of the flight start
  const acts = ATTACK(s.anim), again = !first && acts && s.anim === m.lastAnim && s.animT < m.lastAnimT - 1e-4;
  const changed = first || again || air !== m.airborne || (s.anim !== m.lastAnim && (acts || ATTACK(m.lastAnim)));
  if (changed && (s.anim === ANIM.Melee || s.anim === ANIM.Cast)) { m.side = m.turn; m.turn = m.turn > 0 ? -1 : 1; }
  const t = s.animT, flying = air && s.anim !== ANIM.Land;
  if (!first && m.lastAnim === ANIM.Land && s.anim !== ANIM.Land && !air && m.lastAnimT > CONST.DEMON_LAND * 0.8) m.landT = 0; else if (!jump) m.landT += dt; else m.landT = 99;
  if (flying) {
    if (!first && !m.airborne && m.lastAnim === ANIM.TakeOff) { m.climb = 0; m.beat = WING.down; } else if (jump) m.climb = 99; else m.climb += dt;
    if (first) m.beat = 0;
  }
  const labourFor = P.labour.beats * P.labour.pace * WING.beat, labour = flying ? 1 - S(labourFor * 0.6, labourFor, m.climb) : 0;
  if (flying && !jump && !(m.climb === 0)) m.beat = frac(m.beat + dt / (WING.beat * (1 + (P.labour.pace - 1) * labour)));

  // the target pose of the anim, on the standing or the hovering one
  let lift = 0, heat = 1;
  const g = flying ? 0 : 1;
  if (flying) { hover(q, m, labour); lift = P.lift * (P.liftAtTakeoff + (1 - P.liftAtTakeoff) * S(0, labourFor, m.climb)); }
  else if (s.anim === ANIM.Land) { m.beat = 0; hover(q, m, 0); q[J.hipsY] -= BOB; lift = land(q, m, t); }
  else { stand(q, m); if (s.anim === ANIM.TakeOff) lift = takeOff(q, m, t); else if (!acts) gait(q, m); }
  if (s.anim === ANIM.Melee) claws(q, m, t, g);
  else if (s.anim === ANIM.Tail) tailWhip(q, m, t);
  else if (s.anim === ANIM.Dash) swoop(q, m, t);
  else if (s.anim === ANIM.Cast) { cast(q, m, t, g); pose.caster = m.side; }
  else if (s.anim === ANIM.Breath) heat = breath(q, m, t, g);

  // the cross-fade: how far the pose shown last was off the new target dies away
  const F = m.from, base = m.base;
  if (jump) m.fromT = 99;
  else if (changed) {
    for (let i = 0; i < JOINTS; i++) F.joints[i] = base[i] - q[i];
    F.lift = pose.lift - lift; F.heat = pose.heat - heat;
    m.fromT = 0; m.easeFor = P.easeFrom[m.lastAnim] ?? P.ease;
  } else m.fromT += dt;
  const left = 1 - S(0, m.easeFor, m.fromT);
  for (let i = 0; i < JOINTS; i++) base[i] = q[i] + F.joints[i] * left;
  pose.lift = Math.max(0, lift + F.lift * left); pose.heat = heat + F.heat * left;
  pose.joints.set(base);
  const j = pose.joints;

  // the settling after a landing: the knees give deep, come up slowly, and give once more before it stands
  const C = P.settle;
  let hit = 0;
  if (m.landT < C.end && !flying) {
    // the knees take the fall at the speed it came with and slow it (no ease into the blow)
    const x = m.landT, give = 1 - clamp(x / C.in, 0, 1), deep = (1 - give * give) * (1 - S(C.in + 0.04, C.up, x)), again = bell((x - C.at + C.for / 2) / C.for);
    hit = S(0, 0.08, x) * (1 - S(0.1, 0.5, x));
    j[J.hipsY] -= C.deep * deep + C.again * again; j[J.spine + LEAN] += C.bow * deep + C.bow * 0.2 * again;
    j[J.neck + LEAN] += C.nod * S(0.03, C.in + 0.06, x) * (1 - S(C.in + 0.1, C.up, x)) + C.nodLate * bell((x - C.at + C.for / 2 - 0.08) / C.for);
    tailPitch -= C.tail * hit;
    const open = 1 - S(0.15, C.up, x), shake = C.wing.shake[0] * Math.sin(x * C.wing.shake[1]) * Math.exp(-x * C.wing.shake[2]);
    for (let i = 0; i < 2; i++) { const T = i === 0 ? m.wr : m.wl; T.raise += -C.wing.down * hit + shake; T.fold -= C.wing.open * open * (T.fold / WING.rest.fold); }
  }

  // the head: it alone follows the look (the body turns only with the aim), eased into and out of every turn
  const trunk = base[J.hips + TURN] + base[J.spine + TURN] + base[J.chest + TURN];
  const want = s.look === null ? 0 : clamp(wrap(s.look - m.face), -P.neck, P.neck);
  if (jump) { m.head = want; m.headV = 0; } else { spring(m.head - want, m.headV, P.headRate, dt); m.head = want + SX; m.headV = SV; }
  j[J.chest + TURN] += P.headShare[0] * m.head; j[J.neck + TURN] += P.headShare[1] * m.head - P.headKeep * 0.5 * trunk; j[J.head + TURN] += P.headShare[2] * m.head - P.headKeep * 0.5 * trunk;
  j[J.head + ROLL] += P.headRoll * m.head;

  // the flinch: the head clearly, the chest hardly, the way the blow travelled
  const hurtNow = (s.flags & FLAG.HURT) !== 0;
  if (hurtNow && !m.lastHurt && !first) { m.hurtT = s.hurtDir === null ? -1 : 0; m.hurtDir = s.hurtDir ?? m.face + Math.PI; } else if (m.hurtT >= 0) m.hurtT += dt;
  if (m.hurtT >= P.hurt || jump) m.hurtT = -1;
  m.lastHurt = hurtNow;
  let flick = 0;
  if (m.hurtT >= 0) {
    const k = Math.sin(Math.PI * m.hurtT / P.hurt), rel = m.hurtDir - m.face, fx = Math.cos(rel) * k, fz = Math.sin(rel) * k;
    const chest = P.hurtChest / (RIG.shoulder[1] - RIG.chest[1]), neck = (P.hurtHead - chest * (P.headMid - RIG.chest[1])) / (P.headMid - RIG.neck[1]);
    j[J.chest + LEAN] += chest * fx; j[J.chest + ROLL] += chest * fz; j[J.neck + LEAN] += neck * fx; j[J.neck + ROLL] += neck * fz;
    flick = P.hurtWing * k;
  }

  // the chains: the wings follow their targets, trailing a turn; the tail and the hanging legs lag
  const cdt = jump ? 1 : dt, turn = clamp(m.faceV, -P.turnMax, P.turnMax);
  for (let i = 0; i < 2; i++) {
    const T = i === 0 ? m.wr : m.wl;
    T.fold -= flick;
    if (DEMON_DEV.fold !== null) T.fold = DEMON_DEV.fold;
    T.sweep += (i === 0 ? -1 : 1) * turn * WING.turn.sweep;
    wingStep(i === 0 ? pose.wingR : pose.wingL, T, cdt);
  }
  // a whip is quick down the whole tail; any other swing takes its time to reach the tip
  chainStep(pose.tail, m.tailV, tailYaw + turn * WING.turn.tail, tailPitch, s.anim === ANIM.Tail ? P.tail.rates : WING.tailRates, cdt);
  if (flying || s.anim === ANIM.Land) {
    const A = P.air, swing = flying ? A.legSwing * BOBV - A.legLean * base[J.hips + LEAN] : 0, k = s.anim === ANIM.Land ? 1 - S(P.land.reach[0], P.land.reach[1], t) : 1;
    chainStep(m.legs, m.legsV, -A.legLean * base[J.hips + ROLL], swing, A.legRates, cdt);
    for (let i = 0; i < 2; i++) { j[(i === 0 ? J.footR : J.footL) + FOOT.x] -= Math.sin(m.legs[i * 2 + 1]) * A.swing * k; j[(i === 0 ? J.footR : J.footL) + FOOT.z] += Math.sin(m.legs[i * 2]) * A.swing * k; }
  } else { m.legs.fill(0); m.legsV.fill(0); }

  m.lastAnim = s.anim; m.lastAnimT = t; m.airborne = air; m.started = true;
  return pose;
}

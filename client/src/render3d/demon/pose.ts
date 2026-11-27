// The demon's pose (#379, #442): what a snapshot says about the demon (anim, animT, flags, effects, aim, look, its place) turned into what
// `placeBones` reads: the joints' controls on top of the spike's stances, how far the stance is the flying one, the beat's phase, a
// target for each wing (the wing follows it as a chain, wings.ts), the tail's joints, the chain's swing, and what the paint reads (the
// heart, the breath's charge, the runes, the gaze). Every clock is the memory's own. Pure; a frame allocates nothing.
//
// How a frame is made (`demonPose`): the facing follows the aim as a critically damped spring and the walk phase moves with the way the
// foot point really travelled; the anim's target pose is built on the standing (or the hovering) one, so every attack starts at it; a
// new anim keeps how far the pose shown last was off its target and lets that difference die away (the cross-fade); the wings, the
// tail and the hanging legs follow as chains; on top come the head's turn, the flinch and the settling after a landing.
// What each anim does when is #379's (the phases, the server's times, the memory); the stances, the scimitar blow, the beat, the tail's
// and the fingers' own motion and the breath's head are the spike's (#441), with its numbers.
import { ANIM, CONST, EFFECT, FLAG } from '../../generated/defs';
import { has } from '../../game/effectBits';
import type { BuiltIn } from '../built';
import { TAIL_N } from './body';
import { ARM, FLY_FEET, FOOT, J, JOINTS, LEAN, RIG, ROLL, SKEL, TURN, WINGS } from './skeleton';
import { chainStep, newWing, WING, wingStep, type WingState, type WingTarget } from './wings';

export interface DemonPose {
  /** The skeleton's joint values, by `J` (skeleton.ts): rad, and pose units for the hips' place and the foot points; what the pose adds to the stance. */
  joints: Float32Array;
  wingR: WingState; wingL: WingState;
  /** Per link [yaw (+ to the demon's right), pitch (+ up)]: rad the rows turn the tail, in the hips' frame; a swing travels down the links. */
  tail: Float32Array;
  /** Per tail joint [yaw, pitch]: rad the joint itself is turned (the tail's own curve and life, the rows' swing, the lag behind a turn). */
  tailJ: Float32Array;
  /** Per link of the chain on the left wrist [rad about the front axis, rad about the left axis]. */
  chain: Float32Array;
  /** Pose units the body hangs above the floor, without the beat's bob (that is in the hips). The view lifts the figure; the skeleton reads it only for the feet (the toes hang in the air). */
  lift: number;
  /** The glow of the eyes and the mouth: 1 at rest. */
  heat: number;
  /** The hand the `hand` anchor follows: always the left (-1); the right holds the scimitar. */
  caster: 1 | -1;
  /** 0 the standing stance, 1 the flying one. */
  fly: number;
  /** The wing beat's phase, 0..1: 0 the top of the stroke, `WING.down` its bottom. */
  beat: number;
  /** How hard the air pushes the wings' skin, -1..1: above 0 in the down stroke (0 on the ground). */
  billow: number;
  /** How far the wings are folded, 0..1, for the skin's pleats. */
  fold: number;
  /** [x, y, squint]: where the eyes look in the head's own frame, -1..1 each (x + to the demon's left, y + up), and how far they are narrowed, 0..1. */
  gaze: [number, number, number];
  /** How bright the runes burn, 0..1: up in an attack and through a breath. */
  rune: number;
  /** Heart beats since the demon was first seen (its fraction is the beat's phase): slow at rest, fast in a fight. */
  heart: number;
  /** The breath's charge in the throat: [how far it has climbed, 0..1; its strength, 0..1]. [1, 0] when it draws no breath. */
  charge: [number, number];
  /** The figure's clock, s: the fingers' and the wing fingers' own small motion runs on it. */
  clock: number;
}

const DEG = Math.PI / 180;

/**
 * Every tuning number of the poses. Angles rad, lengths pose units, times s.
 * - `elbow`: the bend the rows' elbow numbers count from. `px`: pose units per game px.
 * - `ease`: the cross-fade after a new anim; `easeFrom`: the same after the anim named (a heavy move is caught slowly).
 * - `lift`: how high the body hangs in the air; `liftAtTakeoff`: its share at the take-off's end; `bob`: the rise and fall with the
 *   beat, crest to trough, highest at the beat's phase `bobAt` (the spike's); `labour`: the first beats after a take-off (how many,
 *   their share of the beat's length, how much deeper they reach and bob).
 * - `faceRate`: 1/s of the facing's spring; `turnMax`: the most turning speed (rad/s) the wings and the tail feel; `headRate`, `neck`,
 *   `headShare` (chest, neck, head), `headRoll` (per rad of turn), `headKeep` (how much of the trunk's own turn the head takes back).
 * - `hurt`: the flinch's length; `hurtHead`, `hurtChest`: how far the blow pushes the head's middle (at the height `headMid`) and the
 *   shoulders; `hurtWing`: how far the wings flick open.
 * - `stride`: the body's way per footfall; `turnStep`: rad turned per footfall; `gait`: 1/s the stride comes and goes, and the footfalls a
 *   second below which it stands.
 * - `seen`: the longest a row's clock runs on by itself while no new animT arrives (a lost snapshot).
 * - `stand` (the spike's life), `walk`, `claws`, `scimitar` (the spike's blow), `tail`, `swoop`, `cast`, `breath`, `air`, `takeoff`,
 *   `land`, `settle`: the rows' angles and times (the server's times are `CONST.DEMON_*`). `tailOwn`, `chain`, `life`: the tail's own
 *   motion, the wrist chain's swing, and what the paint reads.
 */
export const DEMON_POSE = {
  elbow: 0.5, px: 31.7 / 54,
  ease: 0.15, easeAir: 0.4,
  easeFrom: { [ANIM.Land]: 0.45, [ANIM.Dash]: 0.5, [ANIM.Melee]: 0.4, [ANIM.Cleave]: 0.4, [ANIM.Tail]: 0.4, [ANIM.Cast]: 0.3, [ANIM.Breath]: 0.45, [ANIM.TakeOff]: 0.3 } as Record<number, number>,
  lift: (17 * 31.7) / 54, liftAtTakeoff: 0.6, bob: 0.14 / SKEL.perPose, bobAt: 0.5 + 0.4 / (2 * Math.PI), labour: { beats: 2, pace: 0.85, deep: 1.15, bob: 1.8 },
  faceRate: 4, turnMax: 2.5, headRate: 5, neck: 1.4, headShare: [0.15, 0.35, 0.5], headRoll: 0.12, headKeep: 0.8,
  hurt: 0.22, hurtHead: 1.2, hurtChest: 0.4, hurtWing: 0.08, headMid: 29.8,
  stride: 20, turnStep: Math.PI / 2, gait: { rate: 5, min: 0.08 },
  seen: 0.25,
  stand: {
    /** Breathing (rad/s): the chest fills, the waist gives, the shoulders and the hips rise. The head wanders: [rad, rad/s] its turn and its nod. */
    breath: 1.3, chest: 0.025, waist: 0.012, shrug: 0.03, hips: 0.012 / SKEL.perPose, head: [0.05, 0.43], nod: [0.03, 0.61],
    /** The weight goes from foot to foot ([rad, rad/s]; the waist, the chest and the head take a share back); the jaw works. */
    shift: [0.035, 0.5], back: [0.6, 0.5, 0.4], jaw: [0.06, 0.7],
    /** The folded wings stretch a little now and then: every `every` s (up to `late` s late) for `for` s, open to the fold `to`. */
    stretch: { every: 7.5, late: 1.5, for: 1.4, to: 0.75 },
  },
  walk: {
    /** The share of a leg's cycle its foot stands; how far ahead of the hips the stride's middle lies; the swinging foot's height. */
    stance: 0.5, ahead: 2.5, up: 3.2, toeOff: 0.55,
    low: 1.4, drop: 1.5, dropAt: 0.07, lean: 6 * DEG, sway: 1.3, roll: 0.04, twist: 0.1, arms: 0.3, elbows: 0.15,
    nod: 0.06, nodAt: 0.16, tail: 0.28, tailBounce: 0.1, wings: 0.05, wingsAt: 0.12,
  },
  claws: {
    /** The strike's length (it is at its middle when the server's blow lands); how far the wind-up reaches. */
    strike: 0.12, back: 2.4, into: 3.4, low: 1.2, hipsTurn: [0.28, 0.2], chestTurn: [0.5, 0.5], lean: [0.1, 0.3],
    arm: { back: [-0.6, 1.1, -0.4, 1.3], through: [1.45, 0.25, 0.5, 0.2], other: [0.2, -0.3] }, spread: -0.7,
    step: 4.5, stepUp: 1.6, wing: { fold: 0.8, sweep: 0.2, jerk: 0.25 },
  },
  scimitar: {
    /** The spike's blow, its own clock: drawn back until `wind`, thrown across within `strike`, held until `held`, back at rest at `end`. */
    wind: 0.5, strike: 0.12, held: 0.85, end: 1.6, late: 0.2,
    /** Drawn back, then thrown across: the hips' and the chest's turn (+ right) and lean, the sword arm [swing, out, elbow], the other arm [swing, out]. */
    back: { hips: 0.2, chest: [0.45, -0.1], arm: [-0.5, 0.8, 1.0], jaw: 0.3, wing: -0.1, hipsX: -0.05 / SKEL.perPose },
    across: { hips: [-0.25, 0.05], chest: [-0.55, 0.3], arm: [1.5, -0.35, -0.3], other: [-0.45, 0.2], jaw: 0.5, wing: 0.25, hipsX: 0.15 / SKEL.perPose, hipsY: -0.1 / SKEL.perPose },
    /** Heaving after the blow: from the spike's clock `from`, [rad, rad/s, 1/s it dies at]. */
    heave: { from: 0.9, by: [0.05, 9, 1.6] },
  },
  tail: {
    coil: 1.0, whip: 1.9, up: 0.22, hips: [0.3, 0.55], chest: 0.5, low: 1.6, wide: 1.6, hop: 0.9,
    wing: { raise: 25 * DEG, fold: 0.7 }, arms: 0.35, rates: [44, 38, 32, 27, 22, 18],
  },
  swoop: {
    crouch: 4.8, bow: 0.3, armsBack: 0.6, wingUp: { fold: 0.05, raise: 35 * DEG },
    lean: 0.95, low: 3.2, legs: [-9, 3.4], arms: [1.75, 0.3, 0.15], head: 0.75, tail: 0.45,
    glide: { fold: 0, raise: 8 * DEG, sweep: 15 * DEG, pitch: -75 * DEG },
    brake: { fold: 0, raise: 50 * DEG, sweep: -8 * DEG, pitch: 12 * DEG }, back: 0.22, knees: 6.2, feet: 4.5,
  },
  cast: { rise: 0.46, hold: 0.62, arm: [1.15, 0.2, 0, -0.1], airArm: [0.9, 0.2, 0, 0.3], wrist: -0.35, spread: -0.6, dip: 0.07, turn: 0.12, wing: 0.85 },
  breath: {
    /** The spike's breath: in (waist, chest, neck, head back; the arms [swing, out]), then out (hips, waist, chest, neck forward, the head up, the jaw wide; the arms [swing, out, elbow]); its own times `in`, `turn`, `open`, and the wings' lift. */
    inhale: { trunk: [-0.08, -0.16, -0.12, -0.2], jaw: 0.1, arms: [-0.15, 0.1] },
    out: { trunk: [0.05, 0.05, 0.06, 0.1, -0.22], jaw: 0.85, arms: [-0.3, 0.18, 0.2], wing: 0.18 },
    in: 0.5 / 0.6, turn: 0.15, open: 0.18,
    heat: 1.8, tremble: [0.02, 38, 0.035, 31], fold: 0.8, flicker: 0.12,
  },
  air: {
    swing: 11, legRates: [7, 5], legSwing: 0.03, legLean: 0.8,
    lean: 12 * DEG, leanAt: 30, velRate: 4, sweep: 0.5,
  },
  takeoff: {
    gather: 0.28, crouch: 5.2, bow: [0.3, 0.16], arms: [0.25, 1.35], tail: 0.3, wing: 0.65,
    slow: 1.3, throwArms: [-0.75, 0.2], whip: -0.75,
    /** How high the toes are off the floor at its end, how far the legs are then turned into the flying stance, and the s of the climb in which they are drawn up into it. */
    toes: 2.6, legs: 0.35, tuck: 0.5,
  },
  land: {
    wing: { fold: 0, raise: 22 * DEG, sweep: 0.12 }, flat: 1.0, fall: 2.2, reach: [0.18, 0.55], stand: 2.6, arms: [0.55, 0.3],
    bow: 0.14, look: 0.25, tail: 0.35,
  },
  settle: {
    /** The knees give `deep` within `in` and come up until `up`; the second, smaller settling `again` around `at` for `for`; the whole is over at `end`. */
    deep: 6, in: 0.3, up: 1.05, again: 1.4, at: 1.35, for: 0.6, end: 1.8,
    bow: 0.3, nod: 0.42, nodLate: 0.06, tail: 0.65, wing: { down: 0.3, open: 0.3, shake: [0.07, 42, 5] },
  },
  tailOwn: {
    /** The tail's curve as five stretches' turns upward, standing (carried, curled up toward the blade) and streaming in the air. */
    stand: [0.24, 0.12, 0.12, 0.12, 0], fly: [-0.5, -0.1, 0, 0.2, 0.3],
    /** A slow wave runs down it and grows toward the blade ([rad at the root, more at the tip, rad/s, rad along it, phase]), sideways and up. */
    wave: [0.04, 0.1, 0.6, 3.2, 0], lift: [0.015, 0.045, 0.45, 2.6, 2],
    /** Now and then the end flicks, to one side and then the other: every `every` s, `at` s into it. */
    flick: { every: 9.1, at: 6.2, yaw: 0.3, pitch: 0.1, run: 0.22, snap: 0.13, back: [0.7, 0.3, 0.2] },
    /** Every joint follows the one before on a spring of its own, softer toward the end: [stiffness, less at the tip, damping, less at the tip], the most a joint lags, and how much more the root does. */
    whip: [120, 50, 16, 4], most: 0.7, root: 1.4, chest: 0.6,
  },
  chain: { pull: 0.9, stiff: 30, damp: 2.2, wild: 20, most: 0.9, link: [0.25, 0.06], idle: [0.02, 1.1] },
  life: {
    /** Heart beats a second: at rest, flying, breathing fire, in a fight. */
    heart: [0.85, 1.2, 1.4, 1.7],
    /** The runes: how long after an attack's blow they still burn, 1/s they flare up and die down at. The eyes narrow until `squint` s after the blow, at `squintRate` 1/s. */
    runeFor: 0.5, runeRates: [5, 1.2], squint: 0.1, squintRate: 6,
    /** The gaze: how far a rad off the head's own line turns the eyes; how far down they look at a hero from the ground and from the air. */
    gaze: 1.6, down: [-0.3, -0.6],
    /** The breath's charge on the spike's breath clock: it has climbed the throat at `climbed`, and its strength rises within `up` and is gone by `gone`. */
    charge: { climbed: 0.62, up: 0.2, gone: 0.75, fall: 8 },
  },
} as const;

/** The dev page's hand on the wings (the act `wings`, demonStage.ts): a fold their target takes instead of the pose's. null in a run. */
export const DEMON_DEV: { fold: number | null } = { fold: null };

const P = DEMON_POSE;
const PER = 5 / TAIL_N;

export function restPose(): DemonPose {
  const joints = new Float32Array(JOINTS), tailJ = new Float32Array(TAIL_N * 2);
  for (const [f, sd] of [[J.footR, 1], [J.footL, -1]] as const) { joints[f + FOOT.x] = RIG.sole[0]; joints[f + FOOT.y] = RIG.sole[1]; joints[f + FOOT.z] = sd * RIG.legZ; }
  for (let i = 0; i < TAIL_N; i++) tailJ[i * 2 + 1] = P.tailOwn.stand[Math.floor(i * PER)] * PER;
  return {
    joints, wingR: newWing(WING.rest), wingL: newWing(WING.rest), tail: new Float32Array(TAIL_N * 2), tailJ, chain: new Float32Array(12), lift: 0, heat: 1, caster: -1,
    fly: 0, beat: 0, billow: 0, fold: WING.rest.fold, gaze: [0, P.life.down[0], 0], rune: 0, heart: 0, charge: [1, 0], clock: 0,
  };
}

/**
 * What one demon keeps between frames. `t`: its clock; `face`, `faceV`: the drawn facing and its speed; `head`, `headV`: the head's
 * turn; `walk`: the walk phase in cycles (two footfalls each); `gait`, `go`: how much it steps, and how much of that is a stride;
 * `beat`: the wings' phase; `climb`: s in the air since a take-off (large: at full height); `landT`: s since it touched down;
 * `from`: how far the pose shown last was off the new anim's target (joints, lift, heat, fly), fading for `easeFor` since `fromT`;
 * `base`: the faded joints, under the head, the flinch and the settling; `seen`: s since the animT last changed (a row's clock runs
 * on by it); `vx`, `vz`: the eased speed over the floor (units/s); `legs`: the hanging legs' swing ([right, left] pairs of chainStep);
 * `whip`, `whipV`: the tail joints' headings behind the body's turn; `hang`, `swing`, `swingV`: where the chain hung last frame, how
 * far it swings and how fast; `wr`, `wl`: scratch, the wings' targets.
 */
export interface DemonMem {
  started: boolean; t: number; face: number; faceV: number; head: number; headV: number; walk: number; gait: number; go: number; lastX: number; lastZ: number;
  lastAnim: number; lastAnimT: number; seen: number; airborne: boolean; beat: number; climb: number; landT: number; fromT: number; from: DemonPose; easeFor: number;
  hurtT: number; hurtDir: number; lastHurt: boolean; vx: number; vz: number;
  base: Float32Array; tailV: Float32Array; legs: Float32Array; legsV: Float32Array; whip: Float32Array; whipV: Float32Array;
  hang: [number, number] | null; swing: [number, number]; swingV: [number, number]; wr: WingTarget; wl: WingTarget;
  pose: DemonPose; target: DemonPose;
}

export function newDemonMem(): DemonMem {
  return {
    started: false, t: 0, face: 0, faceV: 0, head: 0, headV: 0, walk: 0, gait: 0, go: 0, lastX: 0, lastZ: 0,
    lastAnim: ANIM.Idle, lastAnimT: 0, seen: 0, airborne: false, beat: 0, climb: 99, landT: 99, fromT: 99, from: restPose(), easeFor: DEMON_POSE.ease,
    hurtT: -1, hurtDir: 0, lastHurt: false, vx: 0, vz: 0,
    base: new Float32Array(JOINTS), tailV: new Float32Array(TAIL_N * 2), legs: new Float32Array(4), legsV: new Float32Array(4), whip: new Float32Array(TAIL_N), whipV: new Float32Array(TAIL_N),
    hang: null, swing: [0, 0], swingV: [0, 0], wr: { ...WING.rest }, wl: { ...WING.rest },
    pose: restPose(), target: restPose(),
  };
}

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
/** The tail's ten links at the rates of #379's six: the same time root to tip. */
const overTail = (r: readonly number[]): number[] => Array.from({ length: TAIL_N }, (_, i) => (r[Math.floor((i * r.length) / TAIL_N)] * TAIL_N) / r.length);
const TAIL_RATES = overTail(WING.tailRates), WHIP_RATES = overTail(P.tail.rates);

/** A critically damped spring's step, exact for any `dt`: `x` (and its speed `v`) towards 0. The result is in `SX`, `SV`. */
let SX = 0, SV = 0;
function spring(x: number, v: number, rate: number, dt: number): void {
  const k = (v + rate * x) * dt, e = Math.exp(-rate * dt);
  SX = (x + k) * e; SV = (v - rate * k) * e;
}

/** The tail's root this frame (the links follow it), and how far the stance is the flying one. */
let tailYaw = 0, tailPitch = 0, flyT = 0;
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
/** What it does standing and flying alike (the spike's life): it breathes, the head wanders a little, the jaw works. */
function life(q: Float32Array, t: number): void {
  const A = P.stand, br = Math.sin(t * A.breath), jaw = Math.max(0, Math.sin(t * A.jaw[1]));
  q.set(REST);
  q[J.chest + LEAN] += A.chest * br; q[J.spine + LEAN] -= A.waist * br; q[J.shrug] += A.shrug * br; q[J.hipsY] += A.hips * br;
  q[J.head + TURN] -= A.head[0] * Math.sin(t * A.head[1]); q[J.head + LEAN] += A.nod[0] * Math.sin(t * A.nod[1] + 1);
  q[J.jaw] += (A.jaw[0] * jaw * jaw) / RIG.jawOpen;
}

/** Standing: slow breaths, the weight going from foot to foot; the wings folded, stretching a little now and then. */
function stand(q: Float32Array, m: DemonMem): void {
  const A = P.stand, t = m.t, roll = A.shift[0] * Math.sin(t * A.shift[1]);
  life(q, t);
  flyT = 0;
  q[J.hips + ROLL] += roll; q[J.spine + ROLL] -= A.back[0] * roll; q[J.chest + ROLL] -= A.back[1] * roll; q[J.head + ROLL] += A.back[2] * roll;
  tailYaw = 0; tailPitch = 0;
  const R = A.stretch, n = Math.floor(t / R.every), fold = WING.rest.fold + (R.to - WING.rest.fold) * bell((t - n * R.every - hash(n) * R.late) / R.for);
  for (let i = 0; i < 2; i++) { const T = i === 0 ? m.wr : m.wl; T.fold = fold; T.raise = WING.rest.raise; T.sweep = WING.rest.sweep; T.pitch = WING.rest.pitch; }
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

/** Claws, always the left hand's: the weight onto the back leg, a step into the strike, the swing carrying the trunk past the target, the recovery catching it. */
function claws(q: Float32Array, m: DemonMem, t: number, g: number): void {
  const A = P.claws, W = CONST.DEMON_CLAW_WINDUP, R = CONST.DEMON_CLAW_RECOVER, sd = -1, a = J.armL, o = J.armR;
  const w = S(0, W * 0.85, t), k = S(W - A.strike / 2, W + A.strike / 2, t), r = S(W + A.strike, W + R + 0.2, t), back = w * (1 - k), thru = k * (1 - r);
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
  const f = J.footR, out = S(W - 0.2, W, t), home = S(W + 0.14, W + R, t);
  q[f + FOOT.x] += A.step * (out - home) * g; q[f + FOOT.y] += A.stepUp * (bell(out) + bell(home)) * g;
  if (g > 0) {
    m.wl.fold += (A.wing.fold - m.wl.fold) * late; m.wl.sweep += A.wing.sweep * late;
    m.wr.sweep -= A.wing.jerk * thru; m.wl.sweep -= A.wing.jerk * thru;
  }
}

const ease = (x: number): number => S(0, 1, x);
/** The scimitar blow, the right arm's (the spike's attack on the server's times): drawn back within the wind-up, thrown across at its end, held, and heaving after it. */
function scimitar(q: Float32Array, m: DemonMem, t: number, g: number): void {
  const A = P.scimitar, W = CONST.DEMON_SCIMITAR_WINDUP, R = CONST.DEMON_SCIMITAR_RECOVER, a = J.armR, from = W - A.strike / 2;
  // the spike's clock: its wind-up stretched to the server's (the blow lands in the middle of the strike), the rest to the recovery
  const ph = t < from ? (A.wind * t) / from : t < from + A.strike ? A.wind + t - from : A.wind + A.strike + ((t - from - A.strike) * (A.end - A.wind - A.strike)) / (R + A.late - A.strike / 2);
  const wind = ph < A.wind ? ease(ph / A.wind) : 1 - ease((ph - A.wind) / A.strike);
  const strike = ph < A.wind ? 0 : ph < A.held ? 1 - Math.pow(1 - Math.min(1, (ph - A.wind) / A.strike), 3) : 1 - ease((ph - A.held) / (A.end - A.held));
  const B = A.back, X = A.across;
  q[J.hips + TURN] += B.hips * wind + X.hips[0] * strike; q[J.hips + LEAN] += X.hips[1] * strike;
  q[J.chest + TURN] += B.chest[0] * wind + X.chest[0] * strike; q[J.chest + LEAN] += B.chest[1] * wind + X.chest[1] * strike;
  q[a + ARM.swing] += B.arm[0] * wind + X.arm[0] * strike; q[a + ARM.out] += B.arm[1] * wind + X.arm[1] * strike; q[a + ARM.elbow] += B.arm[2] * wind + X.arm[2] * strike;
  q[J.armL + ARM.swing] += X.other[0] * strike; q[J.armL + ARM.out] += X.other[1] * strike;
  q[J.jaw] += (B.jaw * wind + X.jaw * strike) / RIG.jawOpen;
  q[J.hipsX] += (B.hipsX * wind + X.hipsX * strike) * g; q[J.hipsY] += X.hipsY * strike * g;
  if (ph > A.heave.from) { const h = A.heave.by[0] * Math.exp(-(ph - A.heave.from) * A.heave.by[2]) * Math.sin(ph * A.heave.by[1]); q[J.chest + LEAN] += h; q[J.shrug] += h; }
  const lift = B.wing * wind + X.wing * strike;
  m.wr.raise += lift; m.wl.raise += lift;
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
  wing(m.wr, up, A.wing); wing(m.wl, up, A.wing);
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

/** Casting, with the left hand: the one light thing it does; the arm still rises slowly and falls back by its weight. */
function cast(q: Float32Array, m: DemonMem, t: number, g: number): void {
  const A = P.cast, sd = -1, a = J.armL, end = CONST.DEMON_CAST_WINDUP + CONST.DEMON_CAST_RECOVER;
  const fall = clamp((t - A.hold) / (end + 0.12 - A.hold), 0, 1), up = S(0, A.rise, t) * (1 - fall * fall), dipped = bell(t / (A.rise * 0.7));
  arm(q, a, up, g > 0 ? A.arm : A.airArm);
  q[a + ARM.wristBend] += A.wrist * up; q[a + ARM.curl] += A.spread * up; q[a + ARM.thumb] += A.spread * up;
  // the shoulder dips away before the arm comes up, then the chest turns a little behind the arm
  q[J.chest + TURN] += sd * A.turn * (dipped * 0.8 - up); q[J.chest + ROLL] += sd * A.dip * (dipped - up * 0.5); q[J.hipsX] -= 0.6 * up * g;
  if (g > 0) m.wl.fold += (A.wing - m.wl.fold) * up;
}

/** Fire Breath (the spike's, on the server's times): a breath in with the head and the chest back, then the head thrust forward with the jaw wide open, trembling. Returns the glow of the face. */
function breath(q: Float32Array, m: DemonMem, t: number, g: number): number {
  const A = P.breath, W = CONST.DEMON_BREATH_WINDUP, I = A.inhale, O = A.out;
  const inn = t < W ? ease(t / (W * A.in)) : 1 - ease((t - W) / A.turn), out = t < W ? 0 : ease((t - W) / A.open), tr = out * Math.sin(m.t * A.tremble[1]);
  q[J.hips + LEAN] += O.trunk[0] * out; q[J.spine + LEAN] += I.trunk[0] * inn + O.trunk[1] * out; q[J.chest + LEAN] += I.trunk[1] * inn + O.trunk[2] * out;
  q[J.neck + LEAN] += I.trunk[2] * inn + O.trunk[3] * out; q[J.head + LEAN] += I.trunk[3] * inn + O.trunk[4] * out + A.tremble[0] * tr;
  q[J.head + ROLL] += A.tremble[0] * out * Math.sin(m.t * A.tremble[1] * 0.73);
  q[J.jaw] += (I.jaw * inn + O.jaw * out) / RIG.jawOpen;
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? J.armR : J.armL;
    q[a + ARM.swing] += I.arms[0] * inn + O.arms[0] * out; q[a + ARM.out] += I.arms[1] * inn + O.arms[1] * out; q[a + ARM.elbow] += O.arms[2] * out;
    if (g > 0) { const T = i === 0 ? m.wr : m.wl; T.fold += (A.fold - T.fold) * Math.max(inn, out); T.raise += O.wing * out + A.tremble[2] * out * Math.sin(m.t * A.tremble[3] + i * 1.7); }
  }
  return 1 + (A.heat - 1) * Math.max(inn, out) + A.flicker * tr;
}

/** How far the body is above (+) or below its mean height at the beat's phase, and how fast it rises (units per beat), for `deep` times the bob. */
let BOB = 0, BOBV = 0;
function bob(phase: number, deep: number): void {
  const a = (P.bob / 2) * deep, x = TAU * (phase - P.bobAt);
  BOB = a * Math.cos(x); BOBV = -a * TAU * Math.sin(x);
}

/** In the air: the spike's flying stance, riding the beat; one leg drawn up, the other trailing; leaning into the way it flies. */
function hover(q: Float32Array, m: DemonMem, labour: number): void {
  const A = P.air;
  life(q, m.t);
  flyT = 1;
  bob(m.beat, 1 + (P.labour.bob - 1) * labour);
  q[J.hipsY] += BOB;
  for (let i = 0; i < 2; i++) {
    const f = i === 0 ? J.footR : J.footL, F = FLY_FEET[i], k = P.takeoff.legs + (1 - P.takeoff.legs) * S(0, P.takeoff.tuck, m.climb);
    // after a take-off the legs are still long, the toes just off the floor: they are drawn up in the climb
    q[f + FOOT.x] += F[0] * k; q[f + FOOT.y] += F[1] + (P.takeoff.toes - P.lift * P.liftAtTakeoff - F[1]) * (1 - S(0, P.takeoff.tuck, m.climb)) + BOB; q[f + FOOT.z] += F[2] * k; q[f + FOOT.toes] += F[3] * k;
  }
  // flying, it leans into its way and the wings sweep with it
  const cf = Math.cos(m.face), sf = Math.sin(m.face), fwd = clamp((m.vx * cf + m.vz * sf) / A.leanAt, -1, 1), side = clamp((-m.vx * sf + m.vz * cf) / A.leanAt, -1, 1);
  q[J.hips + LEAN] += A.lean * fwd; q[J.hips + ROLL] += A.lean * side;
  tailYaw = -0.5 * A.lean * side; tailPitch = 1.2 * A.lean * fwd;
  // the beat itself turns the bones (skeleton.ts); the first laboured strokes reach deeper
  const deep = (P.labour.deep - 1) * labour * WINGS.beat[0][0] * Math.cos(TAU * m.beat), sweep = A.sweep * A.lean * fwd;
  m.wr.fold = m.wl.fold = 0; m.wr.pitch = m.wl.pitch = 0; m.wr.sweep = m.wl.sweep = sweep;
  m.wr.raise = deep - 0.6 * A.lean * side; m.wl.raise = deep + 0.6 * A.lean * side;
}

/** Taking off: a deep crouch while the wings open and rise, then the legs and one hard down stroke push the weight off the floor. Returns the lift. */
function takeOff(q: Float32Array, m: DemonMem, t: number): number {
  const A = P.takeoff, G = A.gather, u = clamp((t - G) / (CONST.DEMON_TAKEOFF - G), 0, 1), w = S(0, G * 0.9, t), push = u * u * (3 - 2 * u), down = w * (1 - S(0, 0.7, u));
  // the body starts slowly, and at the anim's end it hangs at the top of its hop (the beat's bob takes it on from there)
  const lift = P.lift * P.liftAtTakeoff * S(0, 1, Math.pow(u, A.slow));
  // the stroke: from the top to the bottom of the beat while the stance goes over to the flying one
  if (u > 0) m.beat = WING.down * u;
  flyT = push;
  bob(WING.down * u, P.labour.bob);
  q[J.hipsY] += -A.crouch * w * (1 - push) + BOB * push; q[J.hipsX] -= 1.2 * down;
  q[J.spine + LEAN] += A.bow[0] * down; q[J.chest + LEAN] += A.bow[1] * down; q[J.neck + LEAN] += 0.1 * down;
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? J.armR : J.armL, f = i === 0 ? J.footR : J.footL, off = S(0.6, 1, u), F = FLY_FEET[i], k = A.legs * off;
    q[a + ARM.swing] += A.arms[0] * w * (1 - push) + A.throwArms[0] * push; q[a + ARM.elbow] += (A.arms[1] - P.elbow) * w * (1 - push) + (A.throwArms[1] - P.elbow) * push; q[a + ARM.out] += 0.2 * push;
    // the feet stay on the floor while the legs stretch, and leave it last
    q[f + FOOT.x] += F[0] * k; q[f + FOOT.y] += -lift + (A.toes + BOB) * off; q[f + FOOT.z] += F[2] * k; q[f + FOOT.toes] += F[3] * k;
  }
  tailPitch += A.tail * down + A.whip * bell(u * 0.9);
  // the wings open and go up in the crouch; as the stance becomes the flying one, the beat (at its top when the push begins) carries them
  for (let i = 0; i < 2; i++) { const T = i === 0 ? m.wr : m.wl; T.fold += (0 - T.fold) * w; T.raise += A.wing * w * (1 - push); }
  return lift;
}

/** Landing: the wings held up and broad against the air, the body dropping faster and faster, the legs reaching for the floor. Returns the lift. */
function land(q: Float32Array, m: DemonMem, t: number): number {
  const A = P.land, u = clamp(t / CONST.DEMON_LAND, 0, 1), lift = P.lift * (1 - Math.pow(u, A.fall)), w = S(0, 0.3, u), r = S(A.reach[0] / CONST.DEMON_LAND, A.reach[1] / CONST.DEMON_LAND, u);
  flyT = 1 - r;
  q[J.hipsY] += (A.stand - q[J.hipsY] + REST[J.hipsY]) * r;
  q[J.spine + LEAN] += A.bow * w; q[J.neck + LEAN] += A.look * w;
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? J.armR : J.armL, f = i === 0 ? J.footR : J.footL;
    q[a + ARM.out] += A.arms[0] * w; q[a + ARM.swing] += A.arms[1] * w;
    q[f + FOOT.x] += (REST[f + FOOT.x] - q[f + FOOT.x]) * r; q[f + FOOT.z] += (REST[f + FOOT.z] - q[f + FOOT.z]) * r; q[f + FOOT.toes] += (REST[f + FOOT.toes] - q[f + FOOT.toes]) * r;
    q[f + FOOT.y] += (-lift - q[f + FOOT.y]) * r;
  }
  tailPitch += A.tail * w;
  // the wings keep their face down while the stance comes upright again
  for (let i = 0; i < 2; i++) { const T = i === 0 ? m.wr : m.wl; wing(T, w, A.wing); T.pitch = -A.flat * r; }
  return lift;
}

/** Standing and walking are one pose (the steps come and go with the way travelled): a change between them is no new anim. */
const ATTACK = (anim: number): boolean => anim !== ANIM.Idle && anim !== ANIM.Move;
const BLOW = (anim: number): number => (anim === ANIM.Cleave ? CONST.DEMON_SCIMITAR_WINDUP : anim === ANIM.Melee ? CONST.DEMON_CLAW_WINDUP : anim === ANIM.Tail ? CONST.DEMON_TAIL_WINDUP : -1);

/** The pose of this frame, written into the memory's own objects (no allocation). */
export function demonPose(s: BuiltIn, dt: number, m: DemonMem): DemonPose {
  const first = !m.started, pose = m.pose;
  // frozen or stone: every clock of the figure stands still
  if (!first && (has(s.effects, EFFECT.Frozen) || has(s.effects, EFFECT.Petrified))) { m.faceV = m.headV = 0; return pose; }
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

  // a new anim (or the same attack begun again): the clocks of the flight start
  const acts = ATTACK(s.anim), again = !first && acts && s.anim === m.lastAnim && s.animT < m.lastAnimT - 1e-4;
  const changed = first || again || air !== m.airborne || (s.anim !== m.lastAnim && (acts || ATTACK(m.lastAnim)));
  // snapshots bring a new animT every other tick, or later when one is lost: a row's clock runs on by the client's own time meanwhile (the lich's rule)
  m.seen = jump || !acts || s.anim !== m.lastAnim || s.animT !== m.lastAnimT ? 0 : Math.min(P.seen, m.seen + dt);
  const t = s.animT + m.seen, flying = air && s.anim !== ANIM.Land;
  if (!first && m.lastAnim === ANIM.Land && s.anim !== ANIM.Land && !air && m.lastAnimT > CONST.DEMON_LAND * 0.8) m.landT = 0; else if (!jump) m.landT += dt; else m.landT = 99;
  if (flying) {
    if (!first && !m.airborne && m.lastAnim === ANIM.TakeOff) { m.climb = 0; m.beat = WING.down; } else if (jump) m.climb = 99; else m.climb += dt;
    if (first) m.beat = 0;
  }
  const labourFor = P.labour.beats * P.labour.pace * WING.beat, labour = flying ? 1 - S(labourFor * 0.6, labourFor, m.climb) : 0;
  if (flying && !jump && !(m.climb === 0)) m.beat = frac(m.beat + dt / (WING.beat * (1 + (P.labour.pace - 1) * labour)));
  // landing, the beat runs on to the top of its stroke and the wings stay up there
  else if (s.anim === ANIM.Land && !jump && m.beat > 0) { m.beat += dt / WING.beat; if (m.beat >= 1) m.beat = 0; }

  // the target pose of the anim, on the standing or the hovering one
  let lift = 0, heat = 1;
  const g = flying ? 0 : 1;
  if (flying) { hover(q, m, labour); lift = P.lift * (P.liftAtTakeoff + (1 - P.liftAtTakeoff) * S(0, labourFor, m.climb)); }
  else if (s.anim === ANIM.Land) { if (jump) m.beat = 0; hover(q, m, 0); for (let i = 0; i < 2; i++) q[(i === 0 ? J.footR : J.footL) + FOOT.y] -= BOB; q[J.hipsY] -= BOB; lift = land(q, m, t); }
  else { stand(q, m); if (s.anim === ANIM.TakeOff) lift = takeOff(q, m, t); else if (!acts) gait(q, m); }
  if (s.anim === ANIM.Melee) claws(q, m, t, g);
  else if (s.anim === ANIM.Cleave) scimitar(q, m, t, g);
  else if (s.anim === ANIM.Tail) tailWhip(q, m, t);
  else if (s.anim === ANIM.Dash) swoop(q, m, t);
  else if (s.anim === ANIM.Cast) cast(q, m, t, g);
  else if (s.anim === ANIM.Breath) heat = breath(q, m, t, g);

  // the cross-fade: how far the pose shown last was off the new target dies away
  const F = m.from, base = m.base;
  if (jump) m.fromT = 99;
  else if (changed) {
    for (let i = 0; i < JOINTS; i++) F.joints[i] = base[i] - q[i];
    F.lift = pose.lift - lift; F.heat = pose.heat - heat; F.fly = pose.fly - flyT;
    // off the floor or onto it without the anim for it (the dev page; a take-off missed): caught slowly
    m.fromT = 0; m.easeFor = P.easeFrom[m.lastAnim] ?? (air !== m.airborne ? P.easeAir : P.ease);
  } else m.fromT += dt;
  const left = 1 - S(0, m.easeFor, m.fromT);
  for (let i = 0; i < JOINTS; i++) base[i] = q[i] + F.joints[i] * left;
  pose.lift = Math.max(0, lift + F.lift * left); pose.heat = heat + F.heat * left; pose.fly = clamp(flyT + F.fly * left, 0, 1);
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
  chainStep(pose.tail, m.tailV, tailYaw + turn * WING.turn.tail, tailPitch, s.anim === ANIM.Tail ? WHIP_RATES : TAIL_RATES, cdt);
  if (flying || s.anim === ANIM.Land) {
    const A = P.air, swing = flying ? A.legSwing * BOBV - A.legLean * base[J.hips + LEAN] : 0, k = s.anim === ANIM.Land ? 1 - S(P.land.reach[0], P.land.reach[1], t) : 1;
    chainStep(m.legs, m.legsV, -A.legLean * base[J.hips + ROLL], swing, A.legRates, cdt);
    for (let i = 0; i < 2; i++) { j[(i === 0 ? J.footR : J.footL) + FOOT.x] -= Math.sin(m.legs[i * 2 + 1]) * A.swing * k; j[(i === 0 ? J.footR : J.footL) + FOOT.z] += Math.sin(m.legs[i * 2]) * A.swing * k; }
  } else { m.legs.fill(0); m.legsV.fill(0); }

  tailJoints(pose, m, -(base[J.hips + TURN] + P.tailOwn.chest * base[J.chest + TURN]), jump ? 0 : dt, jump);
  alive(pose, m, s, t, flying, jump, dt);
  pose.beat = m.beat; pose.clock = m.t;
  pose.billow = pose.fly * Math.sin(TAU * m.beat); pose.fold = (pose.wingR.hand.fold + pose.wingL.hand.fold) / 2;

  m.lastAnim = s.anim; m.lastAnimT = s.animT; m.airborne = air; m.started = true;
  return pose;
}

/**
 * The tail's joints (the spike's): its own curve, standing or streaming; a slow wave that grows toward the blade and a flick of the
 * end now and then; each joint trailing the body's own turn `lead` (rad to the left) on a spring, softer toward the end, so a turn runs
 * down the tail as down a whip; and the rows' swing, link after link (`pose.tail`).
 */
function tailJoints(pose: DemonPose, m: DemonMem, lead: number, dt: number, jump: boolean): void {
  const A = P.tailOwn, N = TAIL_N, t = m.t, fly = pose.fly, J2 = pose.tailJ, L = pose.tail, K = A.flick;
  const n = Math.floor(t / K.every), ft = t - n * K.every - K.at, dir = n % 2 ? -1 : 1;
  if (jump) { m.whip.fill(lead); m.whipV.fill(0); }
  else if (dt > 0) {
    const steps = Math.ceil(dt / WING.step - 1e-6), h = dt / steps;
    for (let s = 0; s < steps; s++) for (let i = 0, to = lead; i < N; i++) {
      const u = i / N;
      m.whipV[i] += ((to - m.whip[i]) * (A.whip[0] - A.whip[1] * u) - m.whipV[i] * (A.whip[2] - A.whip[3] * u)) * h; m.whip[i] += m.whipV[i] * h;
      to = m.whip[i];
    }
  }
  for (let i = 0, to = lead; i < N; i++) {
    const u = (i + 1) / N, k = Math.floor(i * PER), a = (ft - u * K.run) / K.snap, b = (ft - K.back[1] - u * K.run) / K.back[2], flick = Math.exp(-a * a) - K.back[0] * Math.exp(-b * b);
    J2[i * 2] = PER * ((A.wave[0] + A.wave[1] * u) * Math.sin(t * A.wave[2] - u * A.wave[3] + A.wave[4]) + K.yaw * u * u * flick * dir)
      + clamp(m.whip[i] - to, -A.most, A.most) * (i ? 1 : A.root) + L[i * 2] - (i ? L[i * 2 - 2] : 0);
    J2[i * 2 + 1] = PER * (A.stand[k] + (A.fly[k] - A.stand[k]) * fly + (A.lift[0] + A.lift[1] * u) * Math.sin(t * A.lift[2] - u * A.lift[3] + A.lift[4]) + K.pitch * u * u * Math.max(0, flick))
      + L[i * 2 + 1] - (i ? L[i * 2 - 1] : 0);
    to = m.whip[i];
  }
}

/** What the paint reads (the spike's `frame()`): the heart, the breath's charge, the runes, the eyes. */
function alive(pose: DemonPose, m: DemonMem, s: BuiltIn, t: number, flying: boolean, jump: boolean, dt: number): void {
  const A = P.life, blow = BLOW(s.anim), fire = s.anim === ANIM.Breath, step = jump ? 0 : dt;
  pose.heart += step * A.heart[blow >= 0 || s.anim === ANIM.Dash ? 3 : fire ? 2 : flying ? 1 : 0];
  if (fire) {
    // the spike's breath clock: 0.6 s of breath in, on the server's wind-up
    const W = CONST.DEMON_BREATH_WINDUP, b = t < W ? (0.6 * t) / W : 0.6 + t - W, C = A.charge;
    pose.charge[0] = Math.min(1, b / C.climbed); pose.charge[1] = b < C.gone ? Math.min(1, b / C.up) * Math.min(1, (C.gone - b) * C.fall) : 0;
  } else { pose.charge[0] = 1; pose.charge[1] = 0; }
  const rune = (blow >= 0 && t < blow + A.runeFor) || (fire && t < CONST.DEMON_BREATH_WINDUP + CONST.DEMON_BREATH_TIME) ? 1 : 0;
  pose.rune = jump ? rune : pose.rune + (rune - pose.rune) * Math.min(1, dt * A.runeRates[rune ? 0 : 1]);
  // the eyes follow the hero it looks at, as far as the head has not turned to him yet, and narrow as a blow is drawn
  const squint = (s.anim === ANIM.Cleave || s.anim === ANIM.Melee) && t < blow + A.squint ? 1 : 0;
  pose.gaze[0] = s.look === null ? 0 : clamp(-Math.sin(wrap(s.look - m.face) - m.head) * A.gaze, -1, 1);
  pose.gaze[1] = A.down[0] + (A.down[1] - A.down[0]) * pose.fly;
  pose.gaze[2] = jump ? squint : pose.gaze[2] + (squint - pose.gaze[2]) * Math.min(1, dt * A.squintRate);
}

/**
 * The chain on the left wrist (the spike's): it hangs straight down and swings behind the arm's movement. `x`, `z`: where it hangs
 * from this frame, in the figure's own frame (builder units, x to the left, z to the front), read off the bones just placed; the
 * swing shows on the next frame's bones.
 */
export function chainSwing(m: DemonMem, x: number, z: number, dt: number): void {
  const A = P.chain, c = m.pose.chain, sw = m.swing, v = m.swingV;
  if (!(dt > 0)) return;
  if (m.hang === null || dt > WING.maxDt) { m.hang ??= [x, z]; sw[0] = sw[1] = v[0] = v[1] = 0; }
  else {
    const ax = (x - m.hang[0]) / Math.max(dt, 1e-3), az = (z - m.hang[1]) / Math.max(dt, 1e-3);
    // a jump of the arm (a new pose shown at once) pulls nothing
    if (Math.abs(ax) + Math.abs(az) < A.wild) { v[0] += (-ax * A.pull - sw[0] * A.stiff - v[0] * A.damp) * dt; v[1] += (-az * A.pull - sw[1] * A.stiff - v[1] * A.damp) * dt; }
    sw[0] += v[0] * dt; sw[1] += v[1] * dt;
    const far = Math.hypot(sw[0], sw[1]);
    if (far > A.most) { sw[0] *= A.most / far; sw[1] *= A.most / far; }
  }
  m.hang[0] = x; m.hang[1] = z;
  for (let i = 0; i < 6; i++) { const k = A.link[0] + A.link[1] * i; c[i * 2] = -sw[0] * k + A.idle[0] * Math.sin(m.t * A.idle[1] + i); c[i * 2 + 1] = sw[1] * k; }
}

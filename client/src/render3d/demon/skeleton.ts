// The demon's skeleton (#379, #442): the joint values a pose holds, the spike's two stances, and `placeBones`, which turns a pose into one
// skinning matrix per bone of `BONE_DEFS` (body.ts). Pure, allocates nothing.
//
// The skin's own units are the builder's (left +x, up +y, front +z, feet at 0, head top at `SKEL.crown`); the matrices turn them into the
// model frame the built path wants (front +x, up +y, right +z): model x = builder z, model z = -builder x.
// A matrix is 16 floats, column-major: a bone's rest point -> the model frame (the bone's world matrix times the inverse of its bind matrix).
//
// How a bone gets its turn: the standing stance blended to the flying one by `pose.fly`, plus what the pose's controls add (trunk, jaw,
// arms), plus its own rule: the fingers share the hand's curl, the wings fold at their joints and beat about the chest's forward axis
// (each joint further out later), the tail takes `pose.tailJ`, the chain hangs straight down and swings by `pose.chain`, the legs are
// solved to the pose's foot points.
import { BONES, BONE_DEFS, B } from './body';
import type { V } from './sdf';
import type { DemonPose } from './pose';

/** Builder units to the head's top; builder units per pose unit (the pose's lengths were made for a 31.7 units tall skeleton). */
export const SKEL = { crown: 2.68, perPose: 2.68 / 31.7 } as const;

/** The old skeleton's measures in pose units: the rows' language (foot points, the hips' place, the jaw's and the toes' angles). */
export const RIG = {
  hip: [0, 15.5], legZ: 4.3, stifle: [3.8, 11.0], hock: [-3.2, 6.2], sole: [1.1, 0],
  spine: [0.3, 17.6], chest: [1.0, 21.4], neck: [2.2, 26.4], head: [2.8, 27.2], jaw: [3.7, 27.6],
  shoulder: [1.8, 26.0], shoulderZ: 4.9 * 1.55 + 1.1, elbow: 6.3, fore: 6.5,
  /** rad the jaw drops at `jaw` 1. */ jawOpen: 0.6,
  /** rad the toes hang on a foot off the floor, and the height (units) from which they hang fully. */ toesHang: (35 * Math.PI) / 180, toesClear: 2.5,
} as const;

/**
 * Where a pose's joint values lie in `DemonPose.joints`. Angles in rad, places in pose units. All are what the pose adds to the stance.
 * - `hipsX..Z`: the hips' place, off the stance's (x front, y up, z right).
 * - `hips`, `spine`, `chest`, `neck`, `head`: three values each, `TURN` (+ to the demon's right, as a world yaw), `LEAN` (+ forward), `ROLL` (+ to its right).
 * - `jaw`: 0 the stance's, 1 wide open.
 * - `armR`, `armL`: eight values each, see `ARM`. The same values give mirrored arms.
 * - `footR`, `footL`: four values each, see `FOOT`.
 * - `shrug`: rad both collar bones lift the shoulders.
 */
export const J = { hipsX: 0, hipsY: 1, hipsZ: 2, hips: 3, spine: 6, chest: 9, neck: 12, head: 15, jaw: 18, armR: 19, armL: 27, footR: 35, footL: 39, shrug: 43 } as const;
export const JOINTS = 44;
export const TURN = 0, LEAN = 1, ROLL = 2;
/**
 * An arm's values: the upper arm `swing` (+ forward), `out` (+ away from the body), `twist` (+ the elbow's bend turns in towards the
 * body); `elbow` (+ the forearm forward); the wrist `wristBend` (+ towards the palm) and `wristTurn` (+ inward); `curl` of the four
 * fingers and of the `thumb` (rad on top of the stance's loose claw; below 0 spreads the hand). The right hand holds the scimitar: its
 * `curl` and `thumb` are not read.
 */
export const ARM = { swing: 0, out: 1, twist: 2, elbow: 3, wristBend: 4, wristTurn: 5, curl: 6, thumb: 7 } as const;
/** A foot's values: the foot point (model frame, y 0 on the floor) and `toes` (rad the toes hang down, on top of the foot rule: flat when planted, hanging `RIG.toesHang` off the floor). */
export const FOOT = { x: 0, y: 1, z: 2, toes: 3 } as const;

type E = [number, number, number];
const both = (p: Record<string, E>): Record<string, E> => {
  const o: Record<string, E> = { ...p };
  for (const k in p) if (k.endsWith('L') && !(k.slice(0, -1) + 'R' in p)) o[k.slice(0, -1) + 'R'] = [p[k][0], -p[k][1], -p[k][2]];
  return o;
};
/**
 * The spike's stances: [x, y, z] rad per bone, YXZ order (x tips a spine bone forward and swings a hanging limb back, y turns to the
 * left, z lifts the left side); a right bone not named is its left one's mirror. The right arm carries the scimitar. Standing and
 * flying; the legs, the fingers and the tail have their own rules (below, and pose.ts).
 */
export const STANCE: Record<string, E> = both({
  hips: [0.06, 0.1, 0], waist: [0.12, -0.04, 0], chest: [0.2, -0.08, 0], neck: [0.25, 0.04, 0], head: [-0.4, 0.1, 0.04], jaw: [0.12, 0, 0],
  clavL: [0, -0.06, 0], upperArmL: [-0.1, 0, -0.04], foreArmL: [-0.26, 0, -0.1], handL: [-0.05, 0, 0.03],
  upperArmR: [-0.03, 0, 0.02], foreArmR: [-0.5, 0, 0.1], handR: [-0.1, 0, -0.03],
  wing1L: [-0.42, -0.08, -0.05],
});
/** In the air the head and the neck bow a little more (`CLEAR`), which keeps the horns out of the wing arms' way. */
const CLEAR = { head: 0.14, neck: 0.06, wing: 0.44 } as const;
export const FLY: Record<string, E> = both({
  hips: [0.38, 0, 0], waist: [-0.05, 0, 0], chest: [-0.12, 0, 0], neck: [-0.05 + CLEAR.neck, 0, 0], head: [-0.25 + CLEAR.head, 0, 0], jaw: [0.25, 0, 0],
  clavL: [0, -0.1, 0.1], upperArmL: [-0.35, 0, 0.45], foreArmL: [-0.9, 0, -0.2], handL: [-0.2, 0, 0],
  wing1L: [1.0, 0, -0.45],
});
/**
 * The wings (left wing, rad). `FOLD` at full fold, as a bat's wing folds, only at its joints: the upper arm drops, the elbow closes so
 * the wrist stands up beside the shoulder, each finger swings down at the wrist into a closed bundle, the knuckles straighten.
 * `SPREAD` in the air: the arm lifts, the elbow straightens, the fingers fan out. `BEAT`: the beat's turn about the chest's forward
 * axis at the upper arm, the forearm, the fingers' roots and their knuckles ([rad, the phase it lags by]); `up`: rad the arms are carried
 * higher in the air; `sway`: the same turn's size on the ground, a slow sway (`swayRate` rad/s); `flex`: the fingers' own small motion
 * at the root and at the knuckle ([rad, rad/s, phase per finger, phase]).
 */
export const WINGS = {
  fold: { arm: -1.31, elbow: 1.52, wrist: [-1.29, -0.77, -0.45, -0.31], knuckle: [0.6, 0.3, 0, 0] },
  spread: { arm: 0.5, elbow: -0.25, wrist: [0.45, 0.3, 0.16, 0.04], knuckle: [-0.15, -0.1, -0.05, 0] },
  beat: [[0.5, 0], [0.3, 0.7], [0.18, 1.2], [0.25, 1.7]], up: 0.15, sway: 0.08, swayRate: 0.8,
  flex: [[0.03, 0.7, 1.3, 0], [0.04, 0.9, 0.8, 2]],
} as const;
/**
 * The hands (the spike's `fingers`). `loose`: the free hand's curl standing and flying; `grip`: the sword hand's, and how much it
 * tightens with the breath ([rad, rad/s]). `share`: how much of the curl each finger takes, index to little; the three joints'
 * shares; `fan`: rad the fingers spread per place off the hand's middle as it opens; `idle`: each finger's own flexing; `clench`: the
 * free hand slowly closes into a claw every `every` s (`at` s into it, for about `for` s) and opens again; `thumb`: its two joints'
 * turn in and curl per rad.
 */
export const HAND = {
  loose: [0.35, 0.7], grip: 1.25, tighten: [0.04, 1.3],
  share: [1.25, 1.1, 1, 0.85], joints: [0.55, 0.72, 0.48], fan: -0.07, open: -0.5, straight: -0.1,
  idle: [[0.1, 0.8, 1.3], [0.05, 1.9, 2.1]], clench: { deep: 0.55, every: 8.7, at: 5, for: 0.9, lead: 3 },
  thumb: [[0.25, 0.3], [0.5, 0.35]],
} as const;

// ---------------------------------------------------------------- per bone tables
const PARENT = Int16Array.from(BONE_DEFS.map((d) => (d[1] === null ? -1 : B[d[1]])));
const AT = new Float64Array(BONES * 3), OFF = new Float64Array(BONES * 3);
BONE_DEFS.forEach((d, i) => { for (let c = 0; c < 3; c++) { AT[i * 3 + c] = d[2][c]; OFF[i * 3 + c] = d[2][c] - (PARENT[i] < 0 ? 0 : BONE_DEFS[PARENT[i]][2][c]); } });
/** Each bone's stance turns, standing and flying. */
const SA = new Float64Array(BONES * 3), FA = new Float64Array(BONES * 3);
BONE_DEFS.forEach((d, i) => { for (let c = 0; c < 3; c++) { SA[i * 3 + c] = STANCE[d[0]]?.[c] ?? 0; FA[i * 3 + c] = FLY[d[0]]?.[c] ?? 0; } });
/** What turns a bone on top of its stance (`R_*`; 0 nothing), its side (+1 the demon's left, -1 its right, 0 none) and its place in its row (which finger, which joint, which link). */
const R_HEAD = 5, R_JAW = 6, R_UPPER = 7, R_FORE = 8, R_HAND = 9, R_DIGIT = 10, R_THUMB = 11, R_CLAV = 12, R_W1 = 13, R_W2 = 14, R_WFA = 15, R_WFB = 16, R_TAIL = 17, R_CHAIN = 18, R_LEG = 19;
const ROLE = new Uint8Array(BONES), SIDE = new Int8Array(BONES), IDX = new Uint8Array(BONES), SEG = new Uint8Array(BONES);
BONE_DEFS.forEach((d, i) => {
  const n = d[0], side = /[a-z0-9]L$/.test(n) ? 'L' : /[a-z0-9]R$/.test(n) ? 'R' : '', stem = side ? n.slice(0, -1) : n;
  SIDE[i] = side === 'L' ? 1 : side === 'R' ? -1 : 0;
  const trunk = ['hips', 'waist', 'chest', 'neck', 'head'].indexOf(n);
  let m: RegExpExecArray | null;
  if (trunk >= 0) ROLE[i] = trunk + 1;
  else if (n === 'jaw') ROLE[i] = R_JAW;
  else if ((m = /^tail(\d+)$/.exec(n))) { ROLE[i] = R_TAIL; IDX[i] = +m[1]; }
  else if ((m = /^chain(\d+)$/.exec(n))) { ROLE[i] = R_CHAIN; IDX[i] = +m[1]; }
  else if ((m = /^f(\d)([abc])$/.exec(stem))) { ROLE[i] = R_DIGIT; IDX[i] = +m[1]; SEG[i] = 'abc'.indexOf(m[2]); }
  else if ((m = /^th(\d)$/.exec(stem))) { ROLE[i] = R_THUMB; SEG[i] = +m[1]; }
  else if ((m = /^wf(\d)([ab])$/.exec(stem))) { ROLE[i] = m[2] === 'a' ? R_WFA : R_WFB; IDX[i] = +m[1]; }
  else ROLE[i] = ({ upperArm: R_UPPER, foreArm: R_FORE, hand: R_HAND, clav: R_CLAV, wing1: R_W1, wing2: R_W2, thigh: R_LEG, shin: R_LEG, foot: R_LEG, toes: R_LEG } as Record<string, number>)[stem] ?? 0;
});
/** Where each trunk role's TURN, LEAN, ROLL lie in the joints, by role (1 hips .. 5 head). */
const TRUNK = [0, J.hips, J.spine, J.chest, J.neck, J.head];
const CHEST = B.chest, HIPS = B.hips, FORE_L = B.foreArmL;

// ---------------------------------------------------------------- scratch (column-major 3x3 rotations, world, builder frame)
const WR = new Float64Array(BONES * 9), WP = new Float64Array(BONES * 3);
const LOCAL = new Float64Array(9), TMP = new Float64Array(9), AXIS = new Float64Array(9);

/** Rotation of Euler angles in YXZ order (three's), column-major. */
function euler(x: number, y: number, z: number, o: Float64Array): void {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  o[0] = ce + df * b; o[1] = a * f; o[2] = cf * b - de;
  o[3] = de * b - cf; o[4] = a * e; o[5] = df + ce * b;
  o[6] = a * d; o[7] = -b; o[8] = a * c;
}
/** `o = a * b`, `a` read from `a[ao..ao + 9]`, `b` from `b[bo..bo + 9]`; `o` is neither of them. */
function mul3(a: Float64Array, ao: number, b: Float64Array, bo: number, o: Float64Array): void {
  for (let j = 0; j < 9; j += 3) {
    const x = b[bo + j], y = b[bo + j + 1], z = b[bo + j + 2];
    o[j] = a[ao] * x + a[ao + 3] * y + a[ao + 6] * z; o[j + 1] = a[ao + 1] * x + a[ao + 4] * y + a[ao + 7] * z; o[j + 2] = a[ao + 2] * x + a[ao + 5] * y + a[ao + 8] * z;
  }
}
/** The turn by `angle` about the unit axis (x, y, z), into `AXIS`. */
function about(x: number, y: number, z: number, angle: number): void {
  const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  AXIS[0] = c + x * x * k; AXIS[1] = y * x * k + z * s; AXIS[2] = z * x * k - y * s;
  AXIS[3] = x * y * k - z * s; AXIS[4] = c + y * y * k; AXIS[5] = z * y * k + x * s;
  AXIS[6] = x * z * k + y * s; AXIS[7] = y * z * k - x * s; AXIS[8] = c + z * z * k;
}
/** The shortest turn from the unit vector (ax, ay, az) to (bx, by, bz), written to `o` at `at`. */
function arc(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: Float64Array, at: number): void {
  const x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, c = ax * bx + ay * by + az * bz;
  if (c < -0.999999) {
    // opposite vectors: a half turn about z (never met by a leg)
    o[at] = -1; o[at + 1] = 0; o[at + 2] = 0; o[at + 3] = 0; o[at + 4] = -1; o[at + 5] = 0; o[at + 6] = 0; o[at + 7] = 0; o[at + 8] = 1;
    return;
  }
  // I + [v]x + [v]x^2 / (1 + c)
  const k = 1 / (1 + c);
  o[at] = 1 + k * (-z * z - y * y); o[at + 1] = z + k * x * y; o[at + 2] = -y + k * x * z;
  o[at + 3] = -z + k * x * y; o[at + 4] = 1 + k * (-z * z - x * x); o[at + 5] = x + k * y * z;
  o[at + 6] = y + k * x * z; o[at + 7] = -x + k * y * z; o[at + 8] = 1 + k * (-y * y - x * x);
}

// ---------------------------------------------------------------- the legs
const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at3 = (n: string): V => BONE_DEFS[B[n]][2];
const THIGH_LEN = dist(at3('shinL'), at3('thighL')), SHIN_LEN = dist(at3('footL'), at3('shinL'));
const dirOf = (a: V, b: V, l: number): V => [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
const THIGH_DIR = dirOf(at3('thighL'), at3('shinL'), THIGH_LEN), SHIN_DIR = dirOf(at3('shinL'), at3('footL'), SHIN_LEN);
/** The ankle's height above the sole, and how far it lies behind the ball of the foot (builder units). */
const ANKLE_UP = 0.28, BALL = 0.2;
/**
 * The legs as the spike's stances have them, measured once on the spike (its `animate` at rest), [left, right]: the hips' drop on the
 * ground; the ankles standing and flying (builder frame, the flying ones with the hips at their bind place); the way the knee points,
 * in the hips' own frame; the foot's heading (rad to the left) and, flying, how far its toes point down.
 */
const LEGS = {
  drop: 0.14,
  ankle: [[0.4124, 0.28, -0.1391], [-0.4055, 0.28, -0.1238]], flyAnkle: [[0.3359, 0.7221, -0.6829], [-0.3412, 0.7774, -0.1211]],
  knee: [[0.3879, 0.0446, 0.9206], [-0.3265, -0.0574, 0.9434]], flyKnee: [[0.2439, -0.4639, 0.8517], [-0.2341, 0.2254, 0.9457]],
  heading: [0.4037, -0.1338], flyHeading: [0.06, -0.14], flyToes: [1.785, 1.382],
} as const;
/** The foot point a pose's rest names, per leg [left, right] (pose units; pose x front, z right). */
const REST_FOOT = [[RIG.sole[0], RIG.sole[1], -RIG.legZ], [RIG.sole[0], RIG.sole[1], RIG.legZ]];
/**
 * What a pose adds to a foot's rest values to hang the leg as the flying stance does, [right, left] as `J.footR`, `J.footL` (each
 * `FOOT`'s x, y, z, toes; the toes on top of the foot rule's hanging).
 */
export const FLY_FEET: readonly (readonly number[])[] = [1, 0].map((k) => {
  const A = LEGS.ankle[k], T = LEGS.flyAnkle[k], h0 = LEGS.heading[k], h = LEGS.flyHeading[k], th = LEGS.flyToes[k], c = Math.cos(th), s = Math.sin(th);
  // the ball of the foot under each ankle (`leg` below, backwards)
  const up = ANKLE_UP * c + BALL * s, along = ANKLE_UP * s - BALL * c;
  const bx = T[0] - along * Math.sin(h) - (A[0] + BALL * Math.sin(h0)), by = T[1] - up, bz = T[2] - along * Math.cos(h) - (A[2] + BALL * Math.cos(h0));
  return [bz / SKEL.perPose, by / SKEL.perPose, -bx / SKEL.perPose, th - RIG.toesHang];
});

const KNEE = new Float64Array(3);
/** Solves the leg of the thigh bone `t` (shin, foot and toes follow in `BONE_DEFS`' order) to the pose's foot point: two-bone solve from the hip, the knee where the stance points it. */
function leg(t: number, j: Float32Array, lift: number, fly: number): void {
  const left = SIDE[t] > 0, at = left ? J.footL : J.footR, k = left ? 0 : 1, pp = SKEL.perPose;
  const shin = t + 1, foot = t + 2, hips = HIPS * 9;
  const up = Math.max(0, Math.min(1, (j[at + FOOT.y] + lift) / RIG.toesClear)), toes = j[at + FOOT.toes] + RIG.toesHang * up * up * (3 - 2 * up);
  const c = Math.cos(toes), s = Math.sin(toes);
  const yaw = LEGS.heading[k] + (LEGS.flyHeading[k] - LEGS.heading[k]) * fly, cy = Math.cos(yaw), sy = Math.sin(yaw);
  // the ball of the foot: the stance's plus how far the pose moved the foot point (pose x front, y up, z right)
  const R = REST_FOOT[k], A = LEGS.ankle[k];
  const bx = A[0] + BALL * Math.sin(LEGS.heading[k]) - (j[at + FOOT.z] - R[2]) * pp, by = (j[at + FOOT.y] - R[1]) * pp, bz = A[2] + BALL * Math.cos(LEGS.heading[k]) + (j[at + FOOT.x] - R[0]) * pp;
  // the ankle: turned about the ball by the toes' angle, along the foot's heading
  const along = ANKLE_UP * s - BALL * c;
  const hx = WP[t * 3], hy = WP[t * 3 + 1], hz = WP[t * 3 + 2];
  let dx = bx + along * sy - hx, dy = by + ANKLE_UP * c + BALL * s - hy, dz = bz + along * cy - hz;
  const far = Math.hypot(dx, dy, dz) || 1e-6, d = Math.min(THIGH_LEN + SHIN_LEN - 1e-4, Math.max(Math.abs(THIGH_LEN - SHIN_LEN) + 1e-4, far));
  dx /= far; dy /= far; dz /= far;
  // the knee's side: the stance's, carried by the hips
  const S = LEGS.knee[k], F = LEGS.flyKnee[k], lx = S[0] + (F[0] - S[0]) * fly, ly = S[1] + (F[1] - S[1]) * fly, lz = S[2] + (F[2] - S[2]) * fly;
  let px = WR[hips] * lx + WR[hips + 3] * ly + WR[hips + 6] * lz, py = WR[hips + 1] * lx + WR[hips + 4] * ly + WR[hips + 7] * lz, pz = WR[hips + 2] * lx + WR[hips + 5] * ly + WR[hips + 8] * lz;
  let dot = px * dx + py * dy + pz * dz;
  // the leg points straight along it: the hips' up instead
  if (Math.abs(dot) > 0.999 * Math.hypot(px, py, pz)) { px = WR[hips + 3]; py = WR[hips + 4]; pz = WR[hips + 5]; dot = px * dx + py * dy + pz * dz; }
  px -= dx * dot; py -= dy * dot; pz -= dz * dot;
  const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
  const reach = (THIGH_LEN * THIGH_LEN - SHIN_LEN * SHIN_LEN + d * d) / (2 * d), off = Math.sqrt(Math.max(0, THIGH_LEN * THIGH_LEN - reach * reach));
  KNEE[0] = hx + dx * reach + px * off; KNEE[1] = hy + dy * reach + py * off; KNEE[2] = hz + dz * reach + pz * off;
  const ax = hx + dx * d, ay = hy + dy * d, az = hz + dz * d;
  arc(THIGH_DIR[0], THIGH_DIR[1], THIGH_DIR[2], (KNEE[0] - hx) / THIGH_LEN, (KNEE[1] - hy) / THIGH_LEN, (KNEE[2] - hz) / THIGH_LEN, WR, t * 9);
  for (let a = 0; a < 3; a++) WP[shin * 3 + a] = KNEE[a];
  arc(SHIN_DIR[0], SHIN_DIR[1], SHIN_DIR[2], (ax - KNEE[0]) / SHIN_LEN, (ay - KNEE[1]) / SHIN_LEN, (az - KNEE[2]) / SHIN_LEN, WR, shin * 9);
  // the foot: flat on the floor along its heading, turned about its own left axis by the toes' angle
  WP[foot * 3] = ax; WP[foot * 3 + 1] = ay; WP[foot * 3 + 2] = az;
  const o = foot * 9;
  WR[o] = cy; WR[o + 1] = 0; WR[o + 2] = -sy; WR[o + 3] = s * sy; WR[o + 4] = c; WR[o + 5] = s * cy; WR[o + 6] = c * sy; WR[o + 7] = -s; WR[o + 8] = c * cy;
  // the toes (the next bone) hang on the foot: its place follows
  const q = (foot + 1) * 3, f = foot * 3;
  for (let a = 0; a < 9; a++) WR[(foot + 1) * 9 + a] = WR[o + a];
  WP[q] = WP[f] + WR[o] * OFF[q] + WR[o + 3] * OFF[q + 1] + WR[o + 6] * OFF[q + 2];
  WP[q + 1] = WP[f + 1] + WR[o + 1] * OFF[q] + WR[o + 4] * OFF[q + 1] + WR[o + 7] * OFF[q + 2];
  WP[q + 2] = WP[f + 2] + WR[o + 2] * OFF[q] + WR[o + 5] * OFF[q + 1] + WR[o + 8] * OFF[q + 2];
}

// ---------------------------------------------------------------- the hands
/** This frame's hands, [left, right]: each finger's curl, how far the hand is open for it, and the thumb's curl. */
const CURL = new Float64Array(8), OPEN = new Float64Array(8), THUMB = new Float64Array(2);
function hands(j: Float32Array, fly: number, t: number): void {
  const H = HAND, C = H.clench, x = (((t + C.lead) % C.every) - C.at) / C.for;
  for (let k = 0; k < 2; k++) {
    // the sword hand only tightens its grip; the free one flexes each finger in its own time and now and then closes
    const grip = k === 1, m = grip ? 1 : -1;
    const curl = grip ? H.grip : H.loose[0] + (H.loose[1] - H.loose[0]) * fly + j[J.armL + ARM.curl], more = grip ? H.tighten[0] * Math.sin(t * H.tighten[1]) : C.deep * Math.exp(-x * x);
    for (let i = 0; i < 4; i++) {
      const idle = grip ? 0 : H.idle[0][0] * Math.sin(t * H.idle[0][1] + i * H.idle[0][2] + m) + H.idle[1][0] * Math.sin(t * H.idle[1][1] + i * H.idle[1][2]);
      const c = Math.max(H.open, (curl + more) * H.share[i] + idle);
      CURL[k * 4 + i] = c; OPEN[k * 4 + i] = Math.max(0, 1 - Math.max(0, c));
    }
    THUMB[k] = curl + more + (grip ? 0 : j[J.armL + ARM.thumb] - j[J.armL + ARM.curl]);
  }
}

// ---------------------------------------------------------------- one frame
/** The world rotations and places of every bone for the pose. */
function solve(pose: DemonPose): void {
  const j = pose.joints, pp = SKEL.perPose, fly = pose.fly, t = pose.clock, W = WINGS;
  hands(j, fly, t);
  // the beat's phase as an angle: 0 of `pose.beat` is the top of the stroke
  const phi = 2 * Math.PI * pose.beat + Math.PI / 2, sway = t * W.swayRate;
  let fx = 0, fy = 0, fz = 1;
  for (let i = 0; i < BONES; i++) {
    const p = PARENT[i], o = i * 9, q = i * 3, role = ROLE[i], side = SIDE[i], n = IDX[i];
    let x = SA[q] + (FA[q] - SA[q]) * fly, y = SA[q + 1] + (FA[q + 1] - SA[q + 1]) * fly, z = SA[q + 2] + (FA[q + 2] - SA[q + 2]) * fly;
    /** rad the bone is turned about the chest's forward axis on top (the wings). */
    let lift = 0;
    if (role === R_LEG) { if (ROLE[p] !== R_LEG) { place(i, p); leg(i, j, pose.lift, fly); } continue; }
    if (role >= 1 && role <= R_HEAD) { const a = TRUNK[role]; x += j[a + LEAN]; y -= j[a + TURN]; z += j[a + ROLL]; }
    else if (role === R_JAW) x += j[J.jaw] * RIG.jawOpen;
    else if (role === R_CLAV) z += side * j[J.shrug];
    else if (role >= R_UPPER && role <= R_HAND) {
      // the pose's arms: the spike's left (+x) is the demon's left, `armL`
      const a = side > 0 ? J.armL : J.armR;
      if (role === R_UPPER) { x -= j[a + ARM.swing]; z += side * j[a + ARM.out]; y -= side * j[a + ARM.twist]; }
      else if (role === R_FORE) x -= j[a + ARM.elbow];
      else { x -= j[a + ARM.wristBend]; y -= side * j[a + ARM.wristTurn]; }
    } else if (role === R_DIGIT) {
      const k = side > 0 ? 0 : 1, c = CURL[k * 4 + n], seg = SEG[i];
      if (seg === 0) { x = (n - 1.5) * HAND.fan * OPEN[k * 4 + n] * -side; z = -side * c * HAND.joints[0]; } else z = -side * Math.max(HAND.straight, c) * HAND.joints[seg];
    } else if (role === R_THUMB) {
      const tc = THUMB[side > 0 ? 0 : 1], T = HAND.thumb[SEG[i]];
      x = -side * tc * T[0]; z = -side * tc * T[1];
    } else if (role >= R_W1 && role <= R_WFB) {
      const w = side > 0 ? pose.wingL : pose.wingR, part = role - R_W1, b = W.beat[part];
      lift = b[0] * (W.sway * Math.sin(sway - b[1]) * (1 - fly) + fly * Math.sin(phi - b[1]));
      if (role === R_W1) { z += side * (W.fold.arm * w.arm.fold + W.spread.arm * fly); y += side * (CLEAR.wing * fly + w.arm.sweep); x -= w.arm.pitch; lift += W.up * fly + w.arm.raise; }
      else if (role === R_W2) { z += side * (W.fold.elbow * w.arm.fold + W.spread.elbow * fly); lift += w.hand.raise - w.arm.raise; }
      else {
        const F = W.flex[part - 2], late = w.tips.raise - w.hand.raise;
        if (role === R_WFA) { z += side * (W.fold.wrist[n] * w.hand.fold + W.spread.wrist[n] * fly + F[0] * Math.sin(t * F[1] + n * F[2] + F[3])); lift += 0.4 * late; }
        else { z += side * (W.fold.knuckle[n] * w.tips.fold + W.spread.knuckle[n] * fly + F[0] * Math.sin(t * F[1] + n * F[2] + F[3])); lift += 0.6 * late; }
      }
      lift *= side;
    } else if (role === R_TAIL) { y += pose.tailJ[n * 2]; x += pose.tailJ[n * 2 + 1]; }
    else if (role === R_CHAIN) {
      z = pose.chain[n * 2]; x = pose.chain[n * 2 + 1];
      if (n === 0) {
        // the chain hangs straight down whatever the arm does: the first link turns in the world, about the point the chain hangs from (`HANG` above its bind place)
        euler(x, 0, z, LOCAL);
        const pr = FORE_L * 9, pq = FORE_L * 3, ox = OFF[q], oy = OFF[q + 1] + HANG, oz = OFF[q + 2];
        for (let a = 0; a < 9; a++) WR[o + a] = LOCAL[a];
        for (let a = 0; a < 3; a++) WP[q + a] = WP[pq + a] + WR[pr + a] * ox + WR[pr + 3 + a] * oy + WR[pr + 6 + a] * oz - LOCAL[3 + a] * HANG;
        continue;
      }
    }
    euler(x, y, z, LOCAL);
    if (p < 0) {
      // the hips: the stance's place (lower on the ground, where the knees are bent) plus the pose's (pose x front, y up, z right)
      WP[q] = AT[q] - j[J.hipsZ] * pp; WP[q + 1] = AT[q + 1] - LEGS.drop * (1 - fly) + j[J.hipsY] * pp; WP[q + 2] = AT[q + 2] + j[J.hipsX] * pp;
      for (let a = 0; a < 9; a++) WR[o + a] = LOCAL[a];
      continue;
    }
    place(i, p);
    mul3(WR, p * 9, LOCAL, 0, TMP);
    if (lift !== 0) { about(fx, fy, fz, lift); mul3(AXIS, 0, TMP, 0, LOCAL); for (let a = 0; a < 9; a++) WR[o + a] = LOCAL[a]; }
    else for (let a = 0; a < 9; a++) WR[o + a] = TMP[a];
    if (i === CHEST) { fx = WR[o + 6]; fy = WR[o + 7]; fz = WR[o + 8]; }
  }
}
/** How far above its bind place the first chain link's pivot lies (builder units). */
const HANG = 0.03;
/** Bone `i`'s place: carried by its parent `p`. */
function place(i: number, p: number): void {
  const q = i * 3, pr = p * 9, pq = p * 3;
  WP[q] = WP[pq] + WR[pr] * OFF[q] + WR[pr + 3] * OFF[q + 1] + WR[pr + 6] * OFF[q + 2];
  WP[q + 1] = WP[pq + 1] + WR[pr + 1] * OFF[q] + WR[pr + 4] * OFF[q + 1] + WR[pr + 7] * OFF[q + 2];
  WP[q + 2] = WP[pq + 2] + WR[pr + 2] * OFF[q] + WR[pr + 5] * OFF[q + 1] + WR[pr + 8] * OFF[q + 2];
}

/** Fills `out` (`BONES` x 16 floats, column-major) from the pose. */
export function placeBones(pose: DemonPose, out: Float32Array): void {
  solve(pose);
  for (let i = 0; i < BONES; i++) {
    const r = i * 9, p = i * 3, m = i * 16;
    // t = P - R * at, then the builder -> model turn on every column (model (x, y, z) = (z, y, -x))
    const tx = WP[p] - (WR[r] * AT[p] + WR[r + 3] * AT[p + 1] + WR[r + 6] * AT[p + 2]);
    const ty = WP[p + 1] - (WR[r + 1] * AT[p] + WR[r + 4] * AT[p + 1] + WR[r + 7] * AT[p + 2]);
    const tz = WP[p + 2] - (WR[r + 2] * AT[p] + WR[r + 5] * AT[p + 1] + WR[r + 8] * AT[p + 2]);
    for (let c = 0; c < 3; c++) { out[m + c * 4] = WR[r + c * 3 + 2]; out[m + c * 4 + 1] = WR[r + c * 3 + 1]; out[m + c * 4 + 2] = -WR[r + c * 3]; out[m + c * 4 + 3] = 0; }
    out[m + 12] = tz; out[m + 13] = ty; out[m + 14] = -tx; out[m + 15] = 1;
  }
}

/** A builder-frame rest point carried by bone `bone`'s matrix (in `m`, from `placeBones`) into the model frame; writes `o`. */
export function onBone(m: Float32Array, bone: number, p: V, o: [number, number, number]): [number, number, number] {
  const k = bone * 16;
  o[0] = m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12];
  o[1] = m[k + 1] * p[0] + m[k + 5] * p[1] + m[k + 9] * p[2] + m[k + 13];
  o[2] = m[k + 2] * p[0] + m[k + 6] * p[1] + m[k + 10] * p[2] + m[k + 14];
  return o;
}

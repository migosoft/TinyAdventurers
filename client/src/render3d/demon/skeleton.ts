// The demon's skeleton (#379, #442): the joint values a pose holds, the stance, and `placeBones`, which turns a pose into one skinning
// matrix per bone of `BONE_DEFS` (body.ts). Pure, allocates nothing after its first call.
//
// The skin's own units are the builder's (left +x, up +y, front +z, feet at 0, head top at `SKEL.crown`); the matrices turn them into the
// model frame the built path wants (front +x, up +y, right +z): model x = builder z, model z = -builder x.
// A matrix is 16 floats, column-major: a bone's rest point -> the model frame (the bone's world matrix times the inverse of its bind matrix).
import { BONES, BONE_DEFS, B, TAIL_N } from './body';
import type { V } from './sdf';
import type { DemonPose } from './pose';

/** Builder units to the head's top; builder units per pose unit (the pose's lengths were made for a 31.7 units tall skeleton). */
export const SKEL = { crown: 2.68, perPose: 2.68 / 31.7 } as const;

/** The old skeleton's measures in pose units: the rows' language (foot points, the hips' place, the jaw's and the toes' angles) and the wings' root. */
export const RIG = {
  hip: [0, 15.5], legZ: 4.3, stifle: [3.8, 11.0], hock: [-3.2, 6.2], sole: [1.1, 0],
  spine: [0.3, 17.6], chest: [1.0, 21.4], neck: [2.2, 26.4], head: [2.8, 27.2], jaw: [3.7, 27.6],
  shoulder: [1.8, 26.0], shoulderZ: 4.9 * 1.55 + 1.1, elbow: 6.3, fore: 6.5,
  /** rad the jaw drops at `jaw` 1. */ jawOpen: 0.6,
  /** rad the toes hang on a foot off the floor, and the height (units) from which they hang fully. */ toesHang: (35 * Math.PI) / 180, toesClear: 2.5,
} as const;

/**
 * Where a pose's joint values lie in `DemonPose.joints`. Angles in rad, places in pose units.
 * - `hipsX..Z`: the hips' place, off the rest (x front, y up, z right).
 * - `hips`, `spine`, `chest`, `neck`, `head`: three values each, `TURN` (+ to the demon's right, as a world yaw), `LEAN` (+ forward), `ROLL` (+ to its right).
 * - `jaw`: 0 shut, 1 wide open.
 * - `armR`, `armL`: eight values each, see `ARM`. The same values give mirrored arms.
 * - `footR`, `footL`: four values each, see `FOOT`.
 */
export const J = { hipsX: 0, hipsY: 1, hipsZ: 2, hips: 3, spine: 6, chest: 9, neck: 12, head: 15, jaw: 18, armR: 19, armL: 27, footR: 35, footL: 39 } as const;
export const JOINTS = 43;
export const TURN = 0, LEAN = 1, ROLL = 2;
/**
 * An arm's values: the upper arm `swing` (+ forward), `out` (+ away from the body), `twist` (+ the elbow's bend turns in towards the
 * body); `elbow` (+ the forearm forward); the wrist `wristBend` (+ towards the palm) and `wristTurn` (+ inward); `curl` of the four
 * fingers and of the `thumb` (0 the rest's loose claw, 1 a fist, below 0 spread flat).
 */
export const ARM = { swing: 0, out: 1, twist: 2, elbow: 3, wristBend: 4, wristTurn: 5, curl: 6, thumb: 7 } as const;
/** A foot's values: the foot point (model frame, y 0 on the floor) and `toes` (rad the toes hang down, on top of the foot rule: flat when planted, hanging `RIG.toesHang` off the floor). */
export const FOOT = { x: 0, y: 1, z: 2, toes: 3 } as const;

type E = [number, number, number];
/** The spike's standing stance: [x, y, z] rad per bone, YXZ order (x tips a spine bone forward and swings a hanging limb back, y turns to the left, z lifts the left side). */
const STAND: Record<string, E> = {
  hips: [0.06, 0.1, 0], waist: [0.12, -0.04, 0], chest: [0.2, -0.08, 0], neck: [0.25, 0.04, 0], head: [-0.4, 0.1, 0.04], jaw: [0.12, 0, 0],
  clavL: [0, -0.06, 0], upperArmL: [-0.1, 0, -0.04], foreArmL: [-0.26, 0, -0.1], handL: [-0.05, 0, 0.03], fingersL: [0, 0, -0.35],
  upperArmR: [-0.03, 0, 0.02], foreArmR: [-0.34, 0, 0.13],
  thighL: [-0.5, 0.22, 0.16], shinL: [0.8, 0, 0], thighR: [-0.3, -0.16, -0.14], shinR: [0.6, 0, 0],
  wing1L: [-0.42, -0.08, -0.05],
};
/** `STAND` with the right side mirrored from the left where it names no right bone itself; the tail's curve shared out over its joints. */
export const STANCE: Record<string, E> = (() => {
  const o: Record<string, E> = { ...STAND };
  for (const k in STAND) if (k.endsWith('L') && !(k.slice(0, -1) + 'R' in STAND)) o[k.slice(0, -1) + 'R'] = [STAND[k][0], -STAND[k][1], -STAND[k][2]];
  const TAIL_STAND = [0.1, 0, -0.2, -0.25, -0.3], per = 5 / TAIL_N;
  for (let i = 0; i < TAIL_N; i++) o[`tail${i}`] = [TAIL_STAND[Math.floor(i * per)] * per, 0, 0];
  return o;
})();

// ---------------------------------------------------------------- scratch (column-major 3x3 rotations, world, builder frame)
const PARENT = Int16Array.from(BONE_DEFS.map((d) => (d[1] === null ? -1 : B[d[1]])));
const AT = new Float64Array(BONES * 3), OFF = new Float64Array(BONES * 3);
BONE_DEFS.forEach((d, i) => { for (let c = 0; c < 3; c++) { AT[i * 3 + c] = d[2][c]; OFF[i * 3 + c] = d[2][c] - (PARENT[i] < 0 ? 0 : BONE_DEFS[PARENT[i]][2][c]); } });
const WR = new Float64Array(BONES * 9), WP = new Float64Array(BONES * 3);
const LOCAL = new Float64Array(9), TMP = new Float64Array(9);

/** Rotation of Euler angles in YXZ order (three's), column-major. */
function euler(x: number, y: number, z: number, o: Float64Array): void {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ce = c * e, cf = c * f, de = d * e, df = d * f;
  o[0] = ce + df * b; o[1] = a * f; o[2] = cf * b - de;
  o[3] = de * b - cf; o[4] = a * e; o[5] = df + ce * b;
  o[6] = a * d; o[7] = -b; o[8] = a * c;
}
/** `o = a * b`, `a` read from `a[ao..ao + 9]`; `o` is neither of them. */
function mul3(a: Float64Array, ao: number, b: Float64Array, o: Float64Array): void {
  for (let j = 0; j < 9; j += 3) {
    const x = b[j], y = b[j + 1], z = b[j + 2];
    o[j] = a[ao] * x + a[ao + 3] * y + a[ao + 6] * z; o[j + 1] = a[ao + 1] * x + a[ao + 4] * y + a[ao + 7] * z; o[j + 2] = a[ao + 2] * x + a[ao + 5] * y + a[ao + 8] * z;
  }
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
const L = (name: string): number => B[name];
const dist = (a: V, b: V): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at3 = (n: string): V => BONE_DEFS[L(n)][2];
const THIGH_LEN = dist(at3('shinL'), at3('thighL')), SHIN_LEN = dist(at3('footL'), at3('shinL'));
const dirOf = (a: V, b: V, l: number): V => [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
const THIGH_DIR = dirOf(at3('thighL'), at3('shinL'), THIGH_LEN), SHIN_DIR = dirOf(at3('shinL'), at3('footL'), SHIN_LEN);
/** The ankle's height above the sole, and how far it lies behind the ball of the foot (builder units). */
const ANKLE_UP = 0.28, BALL = 0.2;
/** Each leg's ankle in the stance, and the foot point it stands on (builder frame; set at the first call). */
const REST_ANKLE: V[] = [[0, ANKLE_UP, 0], [0, ANKLE_UP, 0]];
let restJ: Float32Array | null = null;
/** The rest pose's joints (pose.ts hands them over when it loads): the controls add only what differs from them. */
export function setRest(j: Float32Array): void { restJ = j; restAnkles = false; }
let restAnkles = false;

const ZERO: Readonly<E> = Object.freeze([0, 0, 0]) as unknown as Readonly<E>;
/** Per bone: its stance angles, which control turns it (a `R_*` role, 0 none) and its side (+1 the demon's left, -1 right, 0 none). */
const STANCE_OF: Readonly<E>[] = BONE_DEFS.map((d) => STANCE[d[0]] ?? ZERO);
const R_HEAD = 5, R_JAW = 6, R_UPPER = 7, R_FORE = 8, R_HAND = 9, R_FINGERS = 10;
const ROLE = Uint8Array.from(BONE_DEFS.map((d) => {
  const n = d[0];
  const trunk = ['hips', 'waist', 'chest', 'neck', 'head'].indexOf(n);
  if (trunk >= 0) return trunk + 1;
  if (n === 'jaw') return R_JAW;
  return /^upperArm[LR]$/.test(n) ? R_UPPER : /^foreArm[LR]$/.test(n) ? R_FORE : /^hand[LR]$/.test(n) ? R_HAND : /^fingers[LR]$/.test(n) ? R_FINGERS : 0;
}));
const SIDE = Int8Array.from(BONE_DEFS.map((d) => (d[0].endsWith('L') ? 1 : d[0].endsWith('R') ? -1 : 0)));
/** Where each trunk role's TURN, LEAN, ROLL lie in the joints, by role (1 hips .. 5 head). */
const TRUNK = [0, J.hips, J.spine, J.chest, J.neck, J.head];

/** The stance's own turn for a bone, plus what the pose's controls add (`j` minus the rest pose's values). Writes `LOCAL`. */
function local(i: number, j: Float32Array | null): void {
  const s = STANCE_OF[i];
  let x = s[0], y = s[1], z = s[2];
  const role = ROLE[i];
  if (j && role) {
    if (role <= R_HEAD) {
      // a trunk bone: TURN, LEAN, ROLL from `TRUNK[role]` on
      const at = TRUNK[role];
      x += j[at + LEAN]; y -= j[at + TURN]; z += j[at + ROLL];
    } else if (role === R_JAW) x += j[J.jaw] * RIG.jawOpen;
    else {
      // the pose's arms: the spike's left (+1, +x) is the demon's left, `armL`
      const side = SIDE[i], a = side > 0 ? J.armL : J.armR, r = restJ!;
      if (role === R_UPPER) { x -= j[a + ARM.swing] - r[a + ARM.swing]; z += side * (j[a + ARM.out] - r[a + ARM.out]); y -= side * (j[a + ARM.twist] - r[a + ARM.twist]); }
      else if (role === R_FORE) x -= j[a + ARM.elbow] - r[a + ARM.elbow];
      else if (role === R_HAND) { x -= j[a + ARM.wristBend] - r[a + ARM.wristBend]; y -= side * (j[a + ARM.wristTurn] - r[a + ARM.wristTurn]); }
      else z -= side * (j[a + ARM.curl] - r[a + ARM.curl]);
    }
  }
  euler(x, y, z, LOCAL);
}

/** Frame of one frame's work: the world rotations and places of every bone for the pose (null: the stance alone, no leg solve). */
function solve(pose: DemonPose | null): void {
  const j = pose ? pose.joints : null, pp = SKEL.perPose;
  for (let i = 0; i < BONES; i++) {
    const p = PARENT[i], o = i * 9, q = i * 3;
    if (j && LEG_FOLLOW[i]) continue;
    local(i, j);
    if (p < 0) {
      // the hips: the pose's place (pose x front, y up, z right) in builder units
      WP[q] = AT[q] - (j ? j[J.hipsZ] * pp : 0); WP[q + 1] = AT[q + 1] + (j ? j[J.hipsY] * pp : 0); WP[q + 2] = AT[q + 2] + (j ? j[J.hipsX] * pp : 0);
      for (let k = 0; k < 9; k++) WR[o + k] = LOCAL[k];
      continue;
    }
    const pr = p * 9, pq = p * 3;
    WP[q] = WP[pq] + WR[pr] * OFF[q] + WR[pr + 3] * OFF[q + 1] + WR[pr + 6] * OFF[q + 2];
    WP[q + 1] = WP[pq + 1] + WR[pr + 1] * OFF[q] + WR[pr + 4] * OFF[q + 1] + WR[pr + 7] * OFF[q + 2];
    WP[q + 2] = WP[pq + 2] + WR[pr + 2] * OFF[q] + WR[pr + 5] * OFF[q + 1] + WR[pr + 8] * OFF[q + 2];
    mul3(WR, pr, LOCAL, TMP);
    for (let k = 0; k < 9; k++) WR[o + k] = TMP[k];
    if (j && (BONE_DEFS[i][0] === 'thighL' || BONE_DEFS[i][0] === 'thighR')) leg(i, j, pose!.lift);
  }
}

/** The bones the leg solve places itself: shin, foot and toes of both legs (solved with the thigh, when there is a pose). */
const LEG_FOLLOW = BONE_DEFS.map((d) => /^(shin|foot|toes)[LR]$/.test(d[0]));
const KNEE = new Float64Array(3);
/** Solves the leg of the thigh bone `t` (shin, foot and toes follow in `BONE_DEFS`' order) to the pose's foot point: two-bone solve from the hip, the knee forward. */
function leg(t: number, j: Float32Array, lift: number): void {
  const left = BONE_DEFS[t][0] === 'thighL', at = left ? J.footL : J.footR, side = left ? 0 : 1, pp = SKEL.perPose;
  const shin = t + 1, foot = t + 2, hips = 0;
  const up = Math.max(0, Math.min(1, (j[at + FOOT.y] + lift) / RIG.toesClear)), toes = j[at + FOOT.toes] + RIG.toesHang * up * up * (3 - 2 * up);
  const c = Math.cos(toes), s = Math.sin(toes);
  // the foot point: the rest one plus how far the pose moved it (pose x front, y up, z right); the rest pose's is `restJ`'s
  const r = restJ!;
  const fx = (j[at + FOOT.x] - r[at + FOOT.x]) * pp, fy = (j[at + FOOT.y] - r[at + FOOT.y]) * pp, fz = (j[at + FOOT.z] - r[at + FOOT.z]) * pp;
  const A = REST_ANKLE[side];
  // the ankle: the foot point turned about the ball by the toes' angle (builder: z front, x left)
  const bx = A[0] - fz, by = fy, bz = A[2] + BALL + fx;
  const hx = WP[t * 3], hy = WP[t * 3 + 1], hz = WP[t * 3 + 2];
  const tx = bx, ty = by + ANKLE_UP * c + BALL * s, tz = bz + ANKLE_UP * s - BALL * c;
  let dx = tx - hx, dy = ty - hy, dz = tz - hz;
  const far = Math.hypot(dx, dy, dz) || 1e-6, d = Math.min(THIGH_LEN + SHIN_LEN - 1e-4, Math.max(Math.abs(THIGH_LEN - SHIN_LEN) + 1e-4, far));
  dx /= far; dy /= far; dz /= far;
  // the knee's side: the hips' front, or their up when the leg points straight ahead
  let px = WR[hips * 9 + 6], py = WR[hips * 9 + 7], pz = WR[hips * 9 + 8], dot = px * dx + py * dy + pz * dz;
  if (Math.abs(dot) > 0.999) { px = WR[hips * 9 + 3]; py = WR[hips * 9 + 4]; pz = WR[hips * 9 + 5]; dot = px * dx + py * dy + pz * dz; }
  px -= dx * dot; py -= dy * dot; pz -= dz * dot;
  const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
  const along = (THIGH_LEN * THIGH_LEN - SHIN_LEN * SHIN_LEN + d * d) / (2 * d), off = Math.sqrt(Math.max(0, THIGH_LEN * THIGH_LEN - along * along));
  KNEE[0] = hx + dx * along + px * off; KNEE[1] = hy + dy * along + py * off; KNEE[2] = hz + dz * along + pz * off;
  const ax = hx + dx * d, ay = hy + dy * d, az = hz + dz * d;
  arc(THIGH_DIR[0], THIGH_DIR[1], THIGH_DIR[2], (KNEE[0] - hx) / THIGH_LEN, (KNEE[1] - hy) / THIGH_LEN, (KNEE[2] - hz) / THIGH_LEN, WR, t * 9);
  for (let k = 0; k < 3; k++) WP[shin * 3 + k] = KNEE[k];
  arc(SHIN_DIR[0], SHIN_DIR[1], SHIN_DIR[2], (ax - KNEE[0]) / SHIN_LEN, (ay - KNEE[1]) / SHIN_LEN, (az - KNEE[2]) / SHIN_LEN, WR, shin * 9);
  // the foot: flat on the floor, turned about the left axis by the toes' angle
  WP[foot * 3] = ax; WP[foot * 3 + 1] = ay; WP[foot * 3 + 2] = az;
  const o = foot * 9;
  WR[o] = 1; WR[o + 1] = 0; WR[o + 2] = 0; WR[o + 3] = 0; WR[o + 4] = c; WR[o + 5] = s; WR[o + 6] = 0; WR[o + 7] = -s; WR[o + 8] = c;
  // the toes (the next bone) hang on the foot: its place follows
  const q = (foot + 1) * 3, f = foot * 3;
  for (let k = 0; k < 9; k++) WR[(foot + 1) * 9 + k] = WR[o + k];
  WP[q] = WP[f] + WR[o] * OFF[q] + WR[o + 3] * OFF[q + 1] + WR[o + 6] * OFF[q + 2];
  WP[q + 1] = WP[f + 1] + WR[o + 1] * OFF[q] + WR[o + 4] * OFF[q + 1] + WR[o + 7] * OFF[q + 2];
  WP[q + 2] = WP[f + 2] + WR[o + 2] * OFF[q] + WR[o + 5] * OFF[q + 1] + WR[o + 8] * OFF[q + 2];
}

/** The first call: the stance's own ankles are where the feet stand when every joint is at rest. */
function init(): void {
  solve(null);
  restAnkles = true;
  for (const [name, k] of [['footL', 0], ['footR', 1]] as const) {
    const f = L(name) * 3;
    REST_ANKLE[k] = [WP[f], ANKLE_UP, WP[f + 2]];
  }
}

/**
 * Fills `out` (`BONES` x 16 floats, column-major) from the pose: forward from the hips; the controls on top of the stance; the legs by
 * two-bone solve to the pose's foot points. The finger and thumb bones, the wings, the tail's joints and the chain stay at the stance
 * (the `fingers` bone does take `curl`; `ARM.thumb` is unused until task 8).
 */
export function placeBones(pose: DemonPose, out: Float32Array): void {
  if (!restAnkles) init();
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

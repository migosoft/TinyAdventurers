// The demon's skeleton (#379): the bones, where each turns, the joint values a pose holds, and `placeBones`, which turns a pose into
// one frame per bone. Pure, allocates nothing.
//
// Model frame: builder units (the spike's description units), the front along +x, up +y, the demon's right +z, the feet at y 0.
// A frame is 12 floats: where the bone's pivot is (0..2), then the images of the x, y and z axes (3..5, 6..8, 9..11). A part's points
// are stored relative to its bone's pivot in the rest pose, so a point is `origin + X * x + Y * y + Z * z`.
// With every joint at 0 the skeleton is the spike's description; the standing demon is `restPose()` (pose.ts).
import type { DemonPose } from './pose';

export const BONE = { hips: 0, spine: 1, chest: 2, neck: 3, head: 4, jaw: 5, armR: 6, foreR: 7, handR: 8, armL: 9, foreL: 10, handL: 11,
  thighR: 12, shinR: 13, footR: 14, thighL: 15, shinL: 16, footL: 17 } as const;
export const BONES = 18;
/**
 * Frames the builder derives after the bones (shape.ts), in the same array: per hand five fingers (the thumb last) of two joints each,
 * the five plates riding on the tail, per wing the four finger claws and the thumb's.
 */
export const SLOT = { finger: 18, tailPlate: 38, wingClaw: 43 } as const;
export const SLOTS = 53;

/** The skeleton's measures in the rest pose (x, y; the legs and arms at ±z). `sole`: the foot point, on the floor under the foot. */
export const RIG = {
  hip: [0, 15.5], legZ: 4.3, stifle: [3.8, 11.0], hock: [-3.2, 6.2], sole: [1.1, 0],
  spine: [0.3, 17.6], chest: [1.0, 21.4], neck: [2.2, 26.4], head: [2.8, 27.2], jaw: [3.7, 27.6],
  shoulder: [1.8, 26.0], shoulderZ: 4.9 * 1.55 + 1.1, elbow: 6.3, fore: 6.5,
  /** rad the jaw drops at `jaw` 1. */ jawOpen: 0.6,
  /** rad the flat palm is turned in towards the body (the spike's). */ palmTurn: 0.5,
  /** rad the toes hang on a foot off the floor, and the height (units) from which they hang fully. */ toesHang: (35 * Math.PI) / 180, toesClear: 2.5,
} as const;

/**
 * Where a pose's joint values lie in `DemonPose.joints`. Angles in rad, places in builder units.
 * - `hipsX..Z`: the hips' place, off the rest.
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

/** Each bone's pivot in the rest pose. */
export const PIVOT: Float64Array = (() => {
  const p = new Float64Array(BONES * 3), R = RIG, set = (b: number, x: number, y: number, z: number): void => { p[b * 3] = x; p[b * 3 + 1] = y; p[b * 3 + 2] = z; };
  set(BONE.hips, R.hip[0], R.hip[1], 0); set(BONE.spine, R.spine[0], R.spine[1], 0); set(BONE.chest, R.chest[0], R.chest[1], 0);
  set(BONE.neck, R.neck[0], R.neck[1], 0); set(BONE.head, R.head[0], R.head[1], 0); set(BONE.jaw, R.jaw[0], R.jaw[1], 0);
  for (const [sd, arm, fore, hand, thigh, shin, foot] of [[1, BONE.armR, BONE.foreR, BONE.handR, BONE.thighR, BONE.shinR, BONE.footR], [-1, BONE.armL, BONE.foreL, BONE.handL, BONE.thighL, BONE.shinL, BONE.footL]] as const) {
    set(arm, R.shoulder[0], R.shoulder[1], sd * R.shoulderZ); set(fore, R.shoulder[0], R.shoulder[1] - R.elbow, sd * R.shoulderZ); set(hand, R.shoulder[0], R.shoulder[1] - R.elbow - R.fore, sd * R.shoulderZ);
    set(thigh, R.hip[0], R.hip[1], sd * R.legZ); set(shin, R.stifle[0], R.stifle[1], sd * R.legZ); set(foot, R.hock[0], R.hock[1], sd * R.legZ);
  }
  return p;
})();

// ---------------------------------------------------------------- rotations: 9 floats, the images of the x, y and z axes
export function rotX(a: number, o: Float64Array): Float64Array { const c = Math.cos(a), s = Math.sin(a); o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = c; o[5] = s; o[6] = 0; o[7] = -s; o[8] = c; return o; }
export function rotY(a: number, o: Float64Array): Float64Array { const c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = 0; o[2] = -s; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = s; o[7] = 0; o[8] = c; return o; }
export function rotZ(a: number, o: Float64Array): Float64Array { const c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = s; o[2] = 0; o[3] = -s; o[4] = c; o[5] = 0; o[6] = 0; o[7] = 0; o[8] = 1; return o; }
/** A turn by `a` about the unit axis (x, y, z). */
export function rotAxis(x: number, y: number, z: number, a: number, o: Float64Array): Float64Array {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  o[0] = t * x * x + c; o[1] = t * x * y + s * z; o[2] = t * x * z - s * y;
  o[3] = t * x * y - s * z; o[4] = t * y * y + c; o[5] = t * y * z + s * x;
  o[6] = t * x * z + s * y; o[7] = t * y * z - s * x; o[8] = t * z * z + c;
  return o;
}
/** `o = a * b` (`b` first); `o` is neither of them. */
export function mul(a: Float64Array, b: Float64Array, o: Float64Array): Float64Array {
  for (let j = 0; j < 9; j += 3) {
    const x = b[j], y = b[j + 1], z = b[j + 2];
    o[j] = a[0] * x + a[3] * y + a[6] * z; o[j + 1] = a[1] * x + a[4] * y + a[7] * z; o[j + 2] = a[2] * x + a[5] * y + a[8] * z;
  }
  return o;
}
/**
 * The frame `c` hangs on the frame `p` of `f`: its pivot at the point (dx, dy, dz) of `p`, turned by `local` in `p`.
 * `c` and `p` are frame numbers (12 floats each).
 */
export function hang(f: Float32Array, c: number, p: number, dx: number, dy: number, dz: number, local: Float64Array): void {
  const a = p * 12, b = c * 12;
  f[b] = f[a] + f[a + 3] * dx + f[a + 6] * dy + f[a + 9] * dz;
  f[b + 1] = f[a + 1] + f[a + 4] * dx + f[a + 7] * dy + f[a + 10] * dz;
  f[b + 2] = f[a + 2] + f[a + 5] * dx + f[a + 8] * dy + f[a + 11] * dz;
  for (let j = 0; j < 9; j += 3) {
    const x = local[j], y = local[j + 1], z = local[j + 2];
    f[b + 3 + j] = f[a + 3] * x + f[a + 6] * y + f[a + 9] * z; f[b + 4 + j] = f[a + 4] * x + f[a + 7] * y + f[a + 10] * z; f[b + 5 + j] = f[a + 5] * x + f[a + 8] * y + f[a + 11] * z;
  }
}

const A = new Float64Array(9), B = new Float64Array(9), C = new Float64Array(9), L = new Float64Array(9);
/** A trunk bone's turn: `TURN`, `LEAN`, `ROLL` from `j[at]` on. */
function trunk(j: Float32Array, at: number): Float64Array {
  return mul(mul(rotY(-j[at + TURN], A), rotZ(-j[at + LEAN], B), C), rotX(j[at + ROLL], A), L);
}
const child = (f: Float32Array, c: number, p: number, local: Float64Array): void =>
  hang(f, c, p, PIVOT[c * 3] - PIVOT[p * 3], PIVOT[c * 3 + 1] - PIVOT[p * 3 + 1], PIVOT[c * 3 + 2] - PIVOT[p * 3 + 2], local);

// The legs' rest: the thigh's and the shin's lengths and directions, and the hock off the foot point.
const THIGH = Math.hypot(RIG.stifle[0] - RIG.hip[0], RIG.stifle[1] - RIG.hip[1]), SHIN = Math.hypot(RIG.hock[0] - RIG.stifle[0], RIG.hock[1] - RIG.stifle[1]);
const T0X = (RIG.stifle[0] - RIG.hip[0]) / THIGH, T0Y = (RIG.stifle[1] - RIG.hip[1]) / THIGH, S0X = (RIG.hock[0] - RIG.stifle[0]) / SHIN, S0Y = (RIG.hock[1] - RIG.stifle[1]) / SHIN;
const HOCK_X = RIG.hock[0] - RIG.sole[0], HOCK_Y = RIG.hock[1] - RIG.sole[1];

/** A bone of the leg from (ox, oy, oz) along the unit (ax, ay, az) in the plane whose normal is the unit (sx, sy, sz); (rx, ry) its rest direction. */
function legBone(f: Float32Array, b: number, ox: number, oy: number, oz: number, ax: number, ay: number, az: number, sx: number, sy: number, sz: number, rx: number, ry: number): void {
  const o = b * 12, nx = sy * az - sz * ay, ny = sz * ax - sx * az, nz = sx * ay - sy * ax;
  f[o] = ox; f[o + 1] = oy; f[o + 2] = oz;
  f[o + 3] = ax * rx - nx * ry; f[o + 4] = ay * rx - ny * ry; f[o + 5] = az * rx - nz * ry;
  f[o + 6] = ax * ry + nx * rx; f[o + 7] = ay * ry + ny * rx; f[o + 8] = az * ry + nz * rx;
  f[o + 9] = sx; f[o + 10] = sy; f[o + 11] = sz;
}

/**
 * A leg: the foot stands on its foot point (turned about it by the toes' angle), which gives the hock; the thigh and the shin reach it
 * by two-bone IK from the hip, the knee forward (the hips' front). A hock out of reach leaves the leg straight and takes the foot along.
 * The foot rule: flat on the floor, the toes hanging the higher the foot point is above it (`lift`: how high the whole body hangs).
 */
function leg(f: Float32Array, j: Float32Array, at: number, sd: number, thigh: number, shin: number, foot: number, lift: number): void {
  const h = BONE.hips * 12, z = sd * RIG.legZ;
  const hx = f[h] + f[h + 9] * z, hy = f[h + 1] + f[h + 10] * z, hz = f[h + 2] + f[h + 11] * z;
  const up = Math.max(0, Math.min(1, (j[at + FOOT.y] + lift) / RIG.toesClear)), toes = j[at + FOOT.toes] + RIG.toesHang * up * up * (3 - 2 * up);
  const c = Math.cos(toes), s = Math.sin(toes);
  let kx = j[at + FOOT.x] + c * HOCK_X + s * HOCK_Y, ky = j[at + FOOT.y] - s * HOCK_X + c * HOCK_Y, kz = j[at + FOOT.z];
  let dx = kx - hx, dy = ky - hy, dz = kz - hz;
  const far = Math.hypot(dx, dy, dz) || 1e-6, d = Math.min(THIGH + SHIN - 1e-4, Math.max(Math.abs(THIGH - SHIN) + 1e-4, far));
  dx /= far; dy /= far; dz /= far;
  kx = hx + dx * d; ky = hy + dy * d; kz = hz + dz * d;
  // the knee's side of the hip-to-hock line: the hips' front, or their up when the leg points straight ahead
  let px = f[h + 3], py = f[h + 4], pz = f[h + 5], dot = px * dx + py * dy + pz * dz;
  if (Math.abs(dot) > 0.999) { px = f[h + 6]; py = f[h + 7]; pz = f[h + 8]; dot = px * dx + py * dy + pz * dz; }
  px -= dx * dot; py -= dy * dot; pz -= dz * dot;
  const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
  const along = (THIGH * THIGH - SHIN * SHIN + d * d) / (2 * d), off = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
  const nx = hx + dx * along + px * off, ny = hy + dy * along + py * off, nz = hz + dz * along + pz * off;   // the knee
  const sx = dy * pz - dz * py, sy = dz * px - dx * pz, sz = dx * py - dy * px;
  legBone(f, thigh, hx, hy, hz, (nx - hx) / THIGH, (ny - hy) / THIGH, (nz - hz) / THIGH, sx, sy, sz, T0X, T0Y);
  legBone(f, shin, nx, ny, nz, (kx - nx) / SHIN, (ky - ny) / SHIN, (kz - nz) / SHIN, sx, sy, sz, S0X, S0Y);
  const o = foot * 12;
  f[o] = kx; f[o + 1] = ky; f[o + 2] = kz;
  f[o + 3] = c; f[o + 4] = -s; f[o + 5] = 0; f[o + 6] = s; f[o + 7] = c; f[o + 8] = 0; f[o + 9] = 0; f[o + 10] = 0; f[o + 11] = 1;
}

/** Fills `out` (BONES x 12 floats) from the pose: forward from the hips; the legs by IK to the pose's foot points. */
export function placeBones(pose: DemonPose, out: Float32Array): void {
  const j = pose.joints, R = trunk(j, J.hips);
  out[0] = PIVOT[0] + j[J.hipsX]; out[1] = PIVOT[1] + j[J.hipsY]; out[2] = PIVOT[2] + j[J.hipsZ];
  for (let i = 0; i < 9; i++) out[3 + i] = R[i];
  child(out, BONE.spine, BONE.hips, trunk(j, J.spine));
  child(out, BONE.chest, BONE.spine, trunk(j, J.chest));
  child(out, BONE.neck, BONE.chest, trunk(j, J.neck));
  child(out, BONE.head, BONE.neck, trunk(j, J.head));
  child(out, BONE.jaw, BONE.head, rotZ(-j[J.jaw] * RIG.jawOpen, L));
  for (let side = 0; side < 2; side++) {
    const sd = side === 0 ? 1 : -1, a = side === 0 ? J.armR : J.armL, arm = side === 0 ? BONE.armR : BONE.armL;
    child(out, arm, BONE.chest, mul(mul(rotZ(j[a + ARM.swing], A), rotX(-sd * j[a + ARM.out], B), C), rotY(sd * j[a + ARM.twist], A), L));
    child(out, arm + 1, arm, rotZ(j[a + ARM.elbow], L));
    // the wrist bends about the line of the knuckles, towards the palm
    child(out, arm + 2, arm + 1, mul(rotY(sd * j[a + ARM.wristTurn], A), rotAxis(sd * Math.cos(RIG.palmTurn), 0, -Math.sin(RIG.palmTurn), j[a + ARM.wristBend], B), L));
  }
  leg(out, j, J.footR, 1, BONE.thighR, BONE.shinR, BONE.footR, pose.lift);
  leg(out, j, J.footL, -1, BONE.thighL, BONE.shinL, BONE.footL, pose.lift);
}

// SPIKE (throwaway): a many-eyed floating monster ("the watcher") as a tube model, to judge the look in the new 3D style. Page px (one wolf model
// px), the front along +x, z to the figure's right. It floats: the body's ball hangs above the ground and nothing touches it.
//
// The design (second pass): a ball under overlapping blue scales that grow into a ruff of big pointed scales round a smooth face.
// The face is one huge eye and one huge mouth. The eye is wide open and glares: white above the iris, a slit pupil, a brow that dips
// to a V over it; its lids are real shells on the eyeball that can close (a blink), and the iris turns in the eye (it looks around).
// The mouth is a grin from cheek to cheek, its corners pulled up, full of uneven fangs, two long canines in each jaw, a tongue.
// Ten thin eyestalks leave the upper half, each a snake with a small socketed eye and a mind of its own. Pack colours throughout.

import type { Bone } from '../bones';
import type { Vec3 } from '../desc';
import { HUMAN_HEIGHT, type TubeDesc, type TubePiece } from '../tubeDesc';
import { PAGE_TO_GAME } from '../tubeModel';
import type { TubePoint } from '../tubes';

// The pack's darkest blues, as dark as the reference creature: the scales and the stalks one slate blue, a near-black rim on every
// scale, the face's skin between the two, the brow, lips and sockets near black.
const SCALE = 0x314152, RIM = 0x1a222c, HIDE = 0x2b3a4c, DARK = 0x1a222c, STALK = SCALE;
const SCLERA = 0xf2e6cf, LIMBAL = 0xc56025, IRIS = 0xee8e2e, CORE = 0xfacb3e, PUPIL = 0x1c1614, GLINT = 0xfdf7ed;
const MAW = 0x1c1614, GUM = 0x62232f, TONGUE = 0x9f294e, TEETH = 0xfdf7ed;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): TubePiece => { pieces.push(p); return p; };

const C: Vec3 = [0, 9, 0], R = 6;
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const plus = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** The direction `az` rad round from the front towards +z, `el` rad up. */
const dirOf = (az: number, el: number): Vec3 => [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
/** A point `r` px from the body's middle in the direction (az, el). */
const sph = (az: number, el: number, r = R): Vec3 => plus(C, dirOf(az, el), r);
/** The point of the body's surface (times `k`) in the direction of `p` from the middle. */
const onBody = (p: Vec3, k = 1): Vec3 => plus(C, norm([p[0] - C[0], p[1] - C[1], p[2] - C[2]]), R * k);
const pt = (p: Vec3, r: number, wide?: number): TubePoint => ({ p: [p[0], p[1], p[2]], r, ...(wide === undefined ? {} : { wide }) });
const SIDE: Vec3 = [0, 0, 1];

// ================= the body: a ball under scales =================
add({ shape: { ball: [R, R, R] }, at: C, stage: 'body', bone: 'body', line: 0.45, colour: HIDE, torso: true });

/**
 * One scale: a pointed plate from `foot` along `along` (a unit vector), `len` long and `w` half wide, flat against `flat` (the side it
 * shows), its tip lifted by `lift`. Two tones, as a dragon egg's: a dark plate, and a smaller light one raised on it, so a dark rim
 * frames every scale.
 */
function scale(foot: Vec3, along: Vec3, flat: Vec3, len: number, w: number, lift: number, stage: 'body' | 'spikes' = 'body'): void {
  const at = (s: number, up: number): Vec3 => plus(plus(foot, along, s * len), flat, up);
  add({
    shape: { tube: [pt(at(-0.3, -0.05), w * 0.45, 0.4), pt(at(0.14, 0.4 * lift), w, 0.38), pt(at(0.47, 0.75 * lift), w * 0.6, 0.45), pt(at(0.72, lift), 0.08, 1)], opts: { K: 8, N: 6, ref: flat, cap: 0.5 } },
    stage, bone: 'body', line: 0, colour: RIM,
  });
  add({
    shape: { tube: [pt(at(-0.19, 0.12), w * 0.3, 0.5), pt(at(0.155, 0.14 + 0.4 * lift), w * 0.72, 0.45), pt(at(0.44, 0.12 + 0.75 * lift), w * 0.42, 0.5), pt(at(0.61, 0.1 + lift), 0.06, 1)], opts: { K: 8, N: 6, ref: flat, cap: 0.5 } },
    stage, bone: 'body', line: 0, colour: SCALE,
  });
}

// Rows round the ball, each row shifted by half a scale, every scale pointing down: its top tucked under the row above, its tip lifted
// over the row below. The face stays smooth.
const SCALE_ROW = 0.2, SCALE_W = 1.35, FACE_CONE = 0.95, FACE = Math.cos(FACE_CONE);
for (let row = 0, el = 1.5; el > -1.45; row++, el -= SCALE_ROW) {
  const n = Math.max(3, Math.round((2 * Math.PI * R * Math.cos(el)) / SCALE_W));
  for (let j = 0; j < n; j++) {
    const az = ((j + (row % 2) * 0.5) / n) * 2 * Math.PI;
    if (Math.cos(az) * Math.cos(el) > FACE) continue;
    const nn = dirOf(az, el), down: Vec3 = [Math.sin(el) * Math.cos(az), -Math.cos(el), Math.sin(el) * Math.sin(az)];
    scale(plus(C, nn, R), down, nn, 1.8, Math.min(0.85, (Math.PI * R * Math.cos(el)) / n + 0.15), 0.28);
  }
}

// The ruff: where the scales meet the face they grow big and stand off the skin, pointing outward round the face like a mane, long
// and short in turn. None on the crown, where the brow and the stalks are.
const RUFF = 18;
for (let i = 0; i < RUFF; i++) {
  const psi = (i / RUFF) * 2 * Math.PI;   // round the front axis, 0 the top
  if (Math.cos(psi) > 0.55) continue;
  const o: Vec3 = [0, Math.cos(psi), Math.sin(psi)], n = norm(plus([Math.cos(FACE_CONE + 0.06), 0, 0], o, Math.sin(FACE_CONE + 0.06)));
  const long = i % 2 === 0, along = norm(plus(o, [-0.25, 0, 0])), flat = norm(plus([1, 0, 0], o, 0.25));
  scale(plus(C, n, R * 0.96), along, flat, long ? 3.6 : 2.5, long ? 1.05 : 0.85, 0.15, 'spikes');
}

// ================= the central eye =================
// A big eyeball sunk into the upper face. Its frame: `eyeFwd` where it looks (a little below the body's own radius there, down at
// whoever stands in front), `eyeUp` across it, z to the side. A point of it is given by `z` across and the latitude `lat` round the
// side axis (0 straight ahead, up positive): the lids are bands of latitude, so turning them about the side axis closes the eye.
const EYE_EL = 0.4, EYE_R = 3.2, LOOK_EL = EYE_EL - 0.12;
const eyeAt = sph(0, EYE_EL, R - 2.2), eyeFwd = dirOf(0, LOOK_EL), eyeUp: Vec3 = [-Math.sin(LOOK_EL), Math.cos(LOOK_EL), 0];
const onEye = (z: number, lat: number, rad = EYE_R): Vec3 => {
  const rho = Math.sqrt(Math.max(0.01, rad * rad - z * z));
  return plus(plus(plus(eyeAt, SIDE, z), eyeFwd, rho * Math.cos(lat)), eyeUp, rho * Math.sin(lat));
};
const EYE_BONES = { upper: 'leg0', lower: 'leg1', gaze: 'leg2' } as const satisfies Record<string, Bone>;
add({ shape: { ball: [EYE_R, EYE_R, EYE_R] }, at: eyeAt, stage: 'head', bone: 'head', line: 0.4, colour: SCLERA });

// The iris: three rings and a slit, each a thin disc flush with the eyeball, on the gaze bone (it turns about the eye's middle, so the
// iris slides over the white). A dark outer ring, the glowing iris, a hot core, a tall slit pupil like a reptile's.
const disc = (r: number, d0: number, d1: number, colour: number, glow: boolean, wide = 1): void => {
  add({
    shape: { tube: [pt(plus(eyeAt, eyeFwd, EYE_R * d0), EYE_R * r, wide), pt(plus(eyeAt, eyeFwd, EYE_R * d1), EYE_R * r * 0.85, wide)], opts: { K: 22, N: 3, cap: 0.5, ref: SIDE } },
    stage: 'spikes', bone: EYE_BONES.gaze, line: 0, colour, ...(glow ? { glow: true as const } : {}),
  });
};
disc(0.46, 0.85, 0.905, LIMBAL, true);
disc(0.39, 0.89, 0.94, IRIS, true);
disc(0.22, 0.94, 0.98, CORE, true);
disc(0.36, 0.965, 1.005, PUPIL, false, 0.2);
// A glint: a small white dot high on the eye that stays put while the iris moves under it.
add({ shape: { ball: [0.34, 0.34, 0.34] }, at: onEye(-1.0, 0.36, EYE_R + 0.05), stage: 'spikes', bone: 'head', line: 0, colour: GLINT, glow: true });

// The lids. The open eye is an almond `ALMOND` half wide: the upper edge arches high (white shows above the iris: it stares), the
// lower edge less. Each lid is a stack of skin bands along that edge, each one further round the eyeball, so the lid reaches far behind
// the edge: when it turns down in a blink, skin follows and no white is bared. A dark line runs along each edge, heavier on top.
const ALMOND = 3.0, OPEN_UP = 2.6, OPEN_LOW = 1.5;
const arch = (z: number): number => Math.max(0, 1 - (z / ALMOND) ** 2);
/** The latitude of a lid's edge at `z` (`open` px above the eye's middle line at z 0). */
const edgeLat = (z: number, open: number): number => Math.asin(clamp((open * arch(z)) / Math.sqrt(Math.max(0.01, EYE_R * EYE_R - z * z)), -1, 1));
for (const [sign, open, bone, bands] of [[1, OPEN_UP, EYE_BONES.upper, [0.3, 0.8, 1.3, 1.8]], [-1, OPEN_LOW, EYE_BONES.lower, [0.3, 0.8, 1.3]]] as const) {
  const taper = (z: number): number => 0.3 + 0.7 * Math.sqrt(arch(z)), ZS = Array.from({ length: 13 }, (_, k) => -ALMOND + (2 * ALMOND * k) / 12);
  for (const off of bands) {
    const lat0 = sign * (edgeLat(0, open) + off), ref = plus([eyeFwd[0] * Math.cos(lat0), eyeFwd[1] * Math.cos(lat0), 0], eyeUp, Math.sin(lat0));
    add({
      shape: { tube: ZS.map((z) => pt(onEye(z, sign * (edgeLat(z, open) + off * taper(z)), EYE_R + 0.1), 0.98 * taper(z), 0.32)), opts: { K: 10, N: 44, ref, cap: 0.6 } },
      stage: 'hat', bone, line: off === bands[0] ? 0.3 : 0, colour: HIDE,   // only the lid's own edge is outlined: the bands behind it are one skin
    });
  }
  add({
    shape: { tube: ZS.map((z) => pt(onEye(z, sign * edgeLat(z, open), EYE_R + 0.2), (sign > 0 ? 0.28 : 0.17) * taper(z))), opts: { K: 8, N: 44 } },
    stage: 'hat', bone, line: 0, colour: DARK,
  });
}

// The brow: one thick dark ridge over the eye that dips to a V in the middle and overhangs the top of the eye there: the glare.
/** A point just outside whatever is in front at `z` across and `y` up the eye's face: the eyeball or the body. */
const overEye = (z: number, y: number, out: number): Vec3 => {
  const flatP = plus(plus(eyeAt, SIDE, z), eyeUp, y), d2 = EYE_R * EYE_R - z * z - y * y;
  const onBall = plus(flatP, eyeFwd, Math.sqrt(Math.max(0, d2)) + out), onSkin = onBody(plus(flatP, eyeFwd, 2), 1 + out / R);
  const far = (p: Vec3): number => Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2]);
  return d2 > 0 && far(onBall) > far(onSkin) ? onBall : onSkin;
};
add({
  shape: { tube: [pt(overEye(-4.2, 2.9, 0.2), 0.45, 0.7), pt(overEye(-2.3, 3.75, 0.35), 0.9, 0.7), pt(overEye(0, 3.0, 0.45), 0.8, 0.7), pt(overEye(2.3, 3.75, 0.35), 0.9, 0.7), pt(overEye(4.2, 2.9, 0.2), 0.45, 0.7)], opts: { K: 14, N: 28, ref: eyeFwd } },
  stage: 'hat', bone: 'head', line: 0.35, colour: DARK,
});

// ================= the mouth =================
// A grin from cheek to cheek: the corners pulled up, the lower jaw dropped. `s` runs -1..1 across it; the edges are heights above the
// mouth's middle line, laid on the body's surface.
const MOUTH_EL = -0.5, mDir = dirOf(0, MOUTH_EL), mUp: Vec3 = [-Math.sin(MOUTH_EL), Math.cos(MOUTH_EL), 0], mMid = plus(C, mDir, R);
const MOUTH_W = 4.7, GRIN = 1.5, JAW_UP = 1.1, JAW_LOW = 2.3;
const gape = (s: number): number => Math.pow(Math.max(0, 1 - s * s), 0.6);
const lipUp = (s: number): number => GRIN * s * s + JAW_UP * gape(s), lipLow = (s: number): number => GRIN * s * s - JAW_LOW * gape(s);
const onMouth = (s: number, y: number, k = 1): Vec3 => onBody(plus(plus(mMid, SIDE, s * MOUTH_W), mUp, y), k);
const SS = Array.from({ length: 17 }, (_, k) => -1 + k / 8);
// The maw: a dark plate in the grin's shape, a tongue low in it.
add({
  shape: { tube: SS.map((s) => { const r = Math.max(0.2, (lipUp(s) - lipLow(s)) / 2); return pt(onMouth(s, (lipUp(s) + lipLow(s)) / 2, 0.985), r, Math.min(1, 0.45 / r)); }), opts: { K: 12, N: 48, ref: mDir, cap: 0.3 } },
  stage: 'head', bone: 'head', line: 0, colour: MAW,
});
add({ shape: { ball: [0.6, 0.75, 1.7], turnZ: MOUTH_EL }, at: onMouth(0, lipLow(0) + 0.85, 0.985), stage: 'head', bone: 'head', line: 0, colour: TONGUE });
// The gums: a dark red line inside each lip, where the teeth are rooted. The lips: a dark ridge along each edge.
for (const [edge, inward] of [[lipUp, -1], [lipLow, 1]] as const) {
  add({ shape: { tube: SS.map((s) => pt(onMouth(s, edge(s) + inward * 0.3 * gape(s), 1.0), 0.1 + 0.3 * gape(s))), opts: { K: 8, N: 48 } }, stage: 'collar', bone: 'head', line: 0, colour: GUM });
  add({ shape: { tube: SS.map((s) => pt(onMouth(s, edge(s) - inward * 0.2, 1.03), 0.2 + 0.25 * gape(s))), opts: { K: 8, N: 48 } }, stage: 'collar', bone: 'head', line: 0.3, colour: DARK });
}
// The fangs: uneven, long and short in turn, two long canines in each jaw; the lower row stands between the upper teeth.
const fang = (s: number, edge: (s: number) => number, dirSign: number, len: number, r: number): void => {
  const root = onMouth(s, edge(s) + dirSign * 0.1, 1.05), tip = plus(plus(root, mUp, dirSign * len), mDir, 0.75);
  add({ shape: { tube: [pt(root, r), pt(plus(plus(root, mUp, dirSign * len * 0.5), mDir, 0.5), r * 0.62), pt(tip, 0.05)], opts: { K: 8, N: 8 } }, stage: 'spikes', bone: 'head', line: 0.2, colour: TEETH });
};
for (let i = 0; i < 9; i++) {
  const s = -0.84 + (i / 8) * 1.68, canine = i === 2 || i === 6;
  fang(s, lipUp, -1, (0.7 + 0.8 * gape(s)) * (canine ? 1.7 : i % 2 ? 0.65 : 1), canine ? 0.4 : 0.3);
}
for (let i = 0; i < 8; i++) {
  const s = -0.735 + (i / 7) * 1.47, canine = i === 1 || i === 6;
  fang(s, lipLow, 1, (0.6 + 0.6 * gape(s)) * (canine ? 1.8 : i % 2 ? 1 : 0.65), canine ? 0.38 : 0.28);
}

// ================= ten eyestalks =================
/**
 * A stalk's eye: the stalk's own skin widens from its tip (`neck`) into a bulb round the eyeball and ends in lids just past the ball's
 * middle, a thin dark line along their edge; in it a pale ball, a glowing iris and a round pupil facing `look`. All of it moves as one
 * solid with the stalk's tip.
 */
function stalkEye(at: Vec3, r: number, look: Vec3, stalk: TubePiece, neck: Vec3): void {
  const d = norm(look), bend = { bend: { with: stalk }, rigid: true as const };
  add({ shape: { tube: [pt(neck, 0.3), pt(plus(at, d, -r * 0.8), r * 0.72), pt(plus(at, d, -r * 0.1), r * 1.1), pt(plus(at, d, r * 0.38), r * 1.0)], opts: { K: 16, N: 14, cap: 0.3 } }, stage: 'hair', bone: 'body', line: 0.25, colour: STALK, ...bend });
  add({ shape: { tube: [pt(plus(at, d, r * 0.4), r * 0.97), pt(plus(at, d, r * 0.5), r * 0.9)], opts: { K: 16, N: 3, cap: 0.3 } }, stage: 'hair', bone: 'body', line: 0, colour: DARK, ...bend });
  add({ shape: { ball: [r, r, r] }, at, stage: 'head', bone: 'body', line: 0.3, colour: SCLERA, ...bend });
  add({ shape: { tube: [pt(plus(at, d, r * 0.8), r * 0.5), pt(plus(at, d, r * 0.94), r * 0.4)], opts: { K: 18, N: 4, cap: 0.6 } }, stage: 'spikes', bone: 'body', line: 0, colour: IRIS, glow: true, ...bend });
  add({ shape: { tube: [pt(plus(at, d, r * 0.97), r * 0.22), pt(plus(at, d, r * 1.08), r * 0.17)], opts: { K: 12, N: 4, cap: 0.6 } }, stage: 'spikes', bone: 'body', line: 0, colour: PUPIL, ...bend });
}
// Spread round the whole upper half: a pair behind the brow, the others alternating high and low round the sides and the back.
const STALKS: readonly { az: number; el: number; len: number; lean: number }[] = [
  { az: 1.15, el: 1.05, len: 0.9, lean: 0.4 }, { az: -1.15, el: 1.05, len: 0.9, lean: 0.4 },
  { az: 1.4, el: 0.5, len: 1.0, lean: 0.3 }, { az: -1.4, el: 0.5, len: 1.0, lean: 0.3 },
  { az: 1.9, el: 0.85, len: 1.1, lean: 0.2 }, { az: -1.9, el: 0.85, len: 1.1, lean: 0.2 },
  { az: 2.4, el: 0.3, len: 1.1, lean: 0.1 }, { az: -2.4, el: 0.3, len: 1.1, lean: 0.1 },
  { az: 2.9, el: 0.7, len: 1.2, lean: 0 }, { az: -2.9, el: 0.7, len: 1.2, lean: 0 },
];
for (const s of STALKS) {
  const n = dirOf(s.az, s.el), out = norm([Math.cos(s.az), 0, Math.sin(s.az)]), up: Vec3 = [0, 1, 0], fwd: Vec3 = [1, 0, 0], L = s.len;
  const root = sph(s.az, s.el, R * 0.92);
  const p1 = plus(root, n, 1.6 * L);
  const p2 = plus(plus(p1, up, 1.5 * L), out, 2.0 * L);
  const p3 = plus(plus(p2, up, 0.7 * L), out, 2.3 * L);
  const p4 = plus(plus(plus(p3, up, -0.2 * L), out, 0.9 * L), fwd, 0.9);
  // The stalk's points are relative to its root (`at`), the foot its bend turns about: the root stays put on the skin. Its motion is
  // the eye's own (pose3d.ts, `eyeStalk`), so the sway here is only what marks it as a bending piece.
  const rel = (p: Vec3): Vec3 => [p[0] - root[0], p[1] - root[1], p[2] - root[2]];
  const stalk = add({
    shape: { tube: [pt(rel(root), 0.55), pt(rel(p1), 0.4), pt(rel(p2), 0.33), pt(rel(p3), 0.29), pt(rel(p4), 0.28)], opts: { K: 10, N: 36, cap: 0.6 } },
    at: root, stage: 'hair', bone: 'body', line: 0.3, colour: STALK, bend: { sway: 0 },
  });
  // The eye looks outward, a little forward and down at the ground below.
  stalkEye(plus(plus(p4, out, 0.45), fwd, 0.45), 0.78, plus(plus(out, fwd, 1.3 + s.lean), [0, -1, 0], 0.3), stalk, p4);
}

/** The lore's body is about 8 ft (2.4 m) across: with a human of 1.75 m at HUMAN_HEIGHT game px, that is this many game px. */
const BODY_ACROSS = (2.44 / 1.75) * HUMAN_HEIGHT;
export const watcher: TubeDesc = {
  name: 'Watcher', size: BODY_ACROSS / (2 * R * PAGE_TO_GAME), outline: 0x222222, pieces,
  // The lids and the gaze turn about the eye's middle (the leg bones are free: it has no legs). pose3d.ts (`watcherEye`) moves them.
  pivots: { body: [0, 6, 0], head: [2, C[1], 0], [EYE_BONES.upper]: eyeAt, [EYE_BONES.lower]: eyeAt, [EYE_BONES.gaze]: eyeAt },
  parents: { head: 'body', [EYE_BONES.upper]: 'head', [EYE_BONES.lower]: 'head', [EYE_BONES.gaze]: 'head' },
  stance: 'two',
  legs: [],
  footprint: [5.5, 5.5],
};

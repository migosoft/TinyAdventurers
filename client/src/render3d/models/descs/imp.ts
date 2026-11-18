// The Imp (#356): the smallest figure. A slender body with a small pot belly on thin legs, a big head with two short dark horns and
// slanted glowing eyes, bat wings on the back that beat, a thin tail with a pointed end that wags, clawed hands. Page px (one wolf
// model px), the front along +x, the feet at y 0, z to the figure's right. The reds and the horn colour are the pack sprite's (imp).

import type { Vec3 } from '../desc';
import { DEMON_EYE, HEIGHT_FACTOR, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';
import type { TubePoint } from '../tubes';

const SKIN = 0xda4e38, HORN = 0x5f2d56, SHADE = 0x62232f;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): TubePiece => { pieces.push(p); return p; };

// ---- the legs: thin, a knee, a small foot ----
const hipX = -0.15, hipY = 3.0, kneeY = 1.6, legZ = 0.8;
const pivots: TubeDesc['pivots'] = { body: [hipX, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 0.3, 0], r: 0.58 }, { p: [0.2, kneeY - hipY, 0], r: 0.45 }], opts: { K: 12, N: 6 } }, at: [hipX, hipY, z], stage: 'legs', bone: upper, line: 0.35, colour: SKIN });
  add({ shape: { tube: [{ p: [0.2, 0, 0], r: 0.45 }, { p: [0, 0.42 - kneeY, 0], r: 0.38 }], opts: { K: 12, N: 6 } }, at: [hipX, kneeY, z], stage: 'legs', bone: lower, line: 0.35, colour: SKIN });
  add({ shape: { ball: [0.85, 0.38, 0.52] }, at: [hipX + 0.45, 0.38, z], stage: 'legs', bone: lower, line: 0.35, colour: SKIN });
  pivots[upper] = [hipX, hipY, z]; pivots[lower] = [hipX + 0.2, kneeY, z];
}

// ---- the torso: slender, a small belly in front, narrow shoulders ----
const shoulder: Vec3 = [0.15, 5.6, 0], shoulderR = 1.0, shoulderWide = 1.35;
add({
  shape: { tube: [{ p: [hipX, 3.0], r: 1.15, wide: 1.05 }, { p: [0.3, 4.0], r: 1.45, wide: 0.92 }, { p: [shoulder[0], shoulder[1]], r: shoulderR, wide: shoulderWide }], opts: { K: 20, N: 14, ref: [0, 0, 1], cap: 0.8 } },
  stage: 'body', bone: 'body', line: 0.4, torso: true, colour: SKIN,
});

// ---- the arms: thin and long, with hands of three claws ----
const R = 0.38, armLen = 3.0, shoulderZ = shoulderR * shoulderWide + 0.3;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const at: Vec3 = [shoulder[0] + 0.1, shoulder[1] - 0.1, sd * shoulderZ];
  add({ shape: { ball: [R * 1.3, R * 1.25, R * 1.25] }, at: [at[0], at[1] + 0.05, at[2]], stage: 'arms', bone: `arm${s}`, line: 0.35, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: R }, { p: [0, -armLen, 0], r: R * 0.95 }], opts: { K: 10, N: 8 } }, at, stage: 'arms', bone: `arm${s}`, line: 0.35, colour: SKIN });
  const hand: Vec3 = [at[0], at[1] - armLen, at[2]];
  add({ shape: { ball: [R * 1.55, R * 1.45, R * 1.45] }, at: hand, stage: 'arms', bone: `hand${s}`, line: 0.35, colour: SKIN });
  // The claws: three short dark points that hang from the hand, spread forward and to both sides.
  for (const [dx, dz] of [[0.4, 0], [0.12, 0.42], [0.12, -0.42]] as const) {
    add({ shape: { drop: { r: 0.32, len: 1.15, sink: 0.3, wide: 0.9, dir: [dx * 0.9, -1, dz * 0.9] } }, at: [hand[0] + dx, hand[1] - 0.25, hand[2] + dz], stage: 'hair', bone: `hand${s}`, line: 0.25, colour: HORN });
  }
  pivots[`arm${s}`] = at;
}

// ---- the wings: a bat's. Each is drawn flat in its own plane (`s` px along the span from the root on the shoulder blade, `h` px up
// in the plane) and stood on the back: out to the side and up, the top leaning back. The membrane is one thin flat tube whose width
// follows the wing's outline: its top the arm and the first finger, its lower edge scalloped between the finger tips. The arm and three
// finger bones lie in it, a little thicker, so they show on both faces; a claw stands on the wrist. The whole wing beats about its
// root across its own surface (the flutter's axis lies in the surface, across the span), stiff beyond the first third. ----
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const WEB = 0.36;   // the membrane's half thickness: the thinnest a tube may be
const WING = 1.2;   // the size of the wing against the outline's numbers below
/** [s, top, bottom] of the wing's outline: the root, the dip to the third finger's tip (s 2.1), the dip to the second's (s 3.9), the rise to the first's (s 5). */
const OUTLINE: readonly (readonly [number, number, number])[] = [
  [0, 0.2, -0.9], [0.7, 0.6, -0.65], [1.4, 1.05, -1.1], [1.9, 1.4, -1.75], [2.15, 1.55, -2.05], [2.45, 1.7, -1.3], [2.95, 1.65, -0.5],
  [3.5, 1.5, -0.8], [3.9, 1.35, -1.45], [4.15, 1.3, -0.6], [4.6, 1.15, 0.3], [5.0, 1.36, 0.64],
];
const WRIST: readonly [number, number] = [2.4, 1.6];
/** The bones as [s, h] lines: the arm (root, elbow, wrist) and the three fingers from the wrist to their tips, a little past the membrane's edge. */
const BONES_2D: readonly (readonly (readonly [number, number])[])[] = [
  [[0, -0.05], [1.2, 0.75], WRIST],
  [WRIST, [3.8, 1.3], [5.25, 1.0]],
  [WRIST, [3.3, 0.5], [3.95, -1.6]],
  [WRIST, [2.35, 0.2], [2.15, -2.2]],
];
for (const sd of [1, -1]) {
  // Swept well back and nearly upright: so the game's camera, which looks down from the front, the side or the back, never sees a wing edge-on.
  const S = unit([-0.6, 0.35, 0.72 * sd]);
  const lean: Vec3 = [-0.2, 0.97, 0], k = lean[0] * S[0] + lean[1] * S[1] + lean[2] * S[2];
  const U = unit([lean[0] - k * S[0], lean[1] - k * S[1], lean[2] - k * S[2]]);
  const face: Vec3 = [S[1] * U[2] - S[2] * U[1], S[2] * U[0] - S[0] * U[2], S[0] * U[1] - S[1] * U[0]];
  const on = (s: number, h: number): [number, number, number] => [(S[0] * s + U[0] * h) * WING, (S[1] * s + U[1] * h) * WING, (S[2] * s + U[2] * h) * WING];
  const root: Vec3 = [-0.75, 4.9, sd * 0.5];
  const web = add({
    shape: { tube: OUTLINE.map(([s, top, bottom]): TubePoint => { const r = (top - bottom) / 2 * WING; return { p: on(s, (top + bottom) / 2), r, wide: Math.min(1, WEB / r) }; }), opts: { K: 12, N: 44, ref: face, cap: 0.5, pow: 0.4 } },
    at: root, stage: 'hair', bone: 'body', line: 0.3, colour: SHADE,
    bend: { sway: 0.5, hinge: 0.3, flutter: { rate: 5, angle: 0.9, axis: [sd * U[0], sd * U[1], sd * U[2]] } },
  });
  BONES_2D.forEach((line, i) => {
    const r = i === 0 ? 0.5 : 0.45;
    add({ shape: { tube: line.map(([s, h], j): TubePoint => ({ p: on(s, h), r: j === 2 && i > 0 ? 0.37 : r })), opts: { K: 8, N: 10, cap: 0.6 } }, at: root, stage: 'hair', bone: 'body', line: 0.3, colour: SKIN, bend: { with: web } });
  });
  const claw = on(WRIST[0], WRIST[1]);
  add({ shape: { drop: { r: 0.34, len: 1.2, sink: 0.25, wide: 0.9, dir: [U[0] + 0.3 * S[0], U[1] + 0.3 * S[1], U[2] + 0.3 * S[2]] } }, at: [root[0] + claw[0], root[1] + claw[1], root[2] + claw[2]], stage: 'hair', bone: 'body', line: 0.25, colour: HORN, bend: { with: web } });
}

// ---- the tail: thin, out of the back of the hips, curling up to a pointed end; it wags ----
add({
  shape: { tube: [
    { p: [0, 0, 0], r: 0.4 }, { p: [-1.2, -0.6, 0], r: 0.37 }, { p: [-2.4, -0.1, 0], r: 0.36 }, { p: [-2.9, 1.2, 0], r: 0.36 },
    { p: [-2.85, 1.65, 0], r: 0.36 }, { p: [-2.75, 2.05, 0], r: 0.85, wide: 0.85 }, { p: [-2.6, 2.75, 0], r: 0.5, wide: 1 }, { p: [-2.4, 3.45, 0], r: 0.36, wide: 1 },
  ], opts: { K: 10, N: 36, cap: 0.5 } },
  at: [-1.05, 3.1, 0], stage: 'hair', bone: 'body', line: 0.3, colour: SKIN, bend: { sway: 1, wag: 1 },
});

// ---- the head: big, no neck ----
const HEAD: Vec3 = [1.8, 1.75, 1.95], HEAD_POW = 0.8;
const head = (x: number, y: number, z = 0): Vec3 => [0.75 + x, 7.45 + y, z];
/** A point of the head's surface: `turn` rad round from the front towards the side `sd`, `y` px above the head's middle, sunk by the share `sink`. */
const onHead = (turn: number, y: number, sd: number, sink = 0): Vec3 => {
  const h = Math.sqrt(Math.max(0, 1 - (y / HEAD[1]) ** 2)) * (1 - sink), pw = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), HEAD_POW);
  return head(HEAD[0] * h * pw(Math.cos(turn)), y * (1 - sink), sd * HEAD[2] * h * pw(Math.sin(turn)));
};
pivots.head = [0.35, 5.9, 0];
add({ shape: { ball: [HEAD[0], HEAD[1], HEAD[2]], pow: HEAD_POW }, at: head(0, 0), stage: 'head', bone: 'head', line: 0.45, colour: SKIN });
// The horns stand on the hat bone, so the crest varies them about their foot. Upright: a horn that leans out to the side points at
// the camera on the near side of a side view and shrinks to a dot.
pivots.hat = head(0, 1.25);
for (const sd of [1, -1]) {
  add({ shape: { drop: { r: 0.45, len: 2.3, sink: 0.5, wide: 0.85, dir: [-0.15, 1, 0] } }, at: head(-0.1, 1.25, sd * 1.2), stage: 'spikes', bone: 'hat', line: 0.3, colour: HORN });
  // The eyes: glowing slits without pupils, slanted (low by the nose, high at the temple). A tube sunk into the head, so only a narrow strip of it shows.
  const eye = [onHead(0.22, -0.15, sd, 0.17), onHead(0.55, 0.2, sd, 0.17), onHead(0.88, 0.62, sd, 0.17)];
  add({ shape: { tube: eye.map((p, i): TubePoint => ({ p: [p[0], p[1], p[2]], r: i === 1 ? 0.44 : 0.36 })), opts: { K: 10, N: 12, cap: 0.8 } }, stage: 'spikes', bone: 'head', line: 0, colour: DEMON_EYE, glow: true });
}

export const imp: TubeDesc = {
  name: 'Imp', size: fitSize(HEIGHT_FACTOR.imp, 9.988), outline: 0x222222, pieces, pivots,
  parents: { head: 'body', hat: 'head', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: armLen, radius: R, stretch: 0.3 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false }, { upper: 'leg2', lower: 'leg3', front: false }],
  footprint: [1.1, 1.15],
};

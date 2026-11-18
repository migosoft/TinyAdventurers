// The Imp (#356): the smallest figure. A pot belly on short legs, a big head with two short dark horns, small bat wings on the back
// that flutter, a thin tail with a pointed end that wags, clawed hands. Page px (one wolf model px), the front along +x, the feet at
// y 0, z to the figure's right. The colours are the pack sprite's (imp).

import type { Vec3 } from '../desc';
import type { TubeDesc, TubePiece } from '../tubeDesc';

const SKIN = 0xda4e38, HORN = 0x5f2d56, SHADE = 0x62232f, EYE = 0xfdf7ed, DARK = 0x222222;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): void => { pieces.push(p); };

// ---- the legs: short, a knee, a broad foot ----
const hipX = -0.2, hipY = 2.5, kneeY = 1.35, legZ = 0.95;
const pivots: TubeDesc['pivots'] = { body: [hipX, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 0.3, 0], r: 0.75 }, { p: [0.2, kneeY - hipY, 0], r: 0.58 }], opts: { K: 12, N: 6 } }, at: [hipX, hipY, z], stage: 'legs', bone: upper, line: 0.35, colour: SKIN });
  add({ shape: { tube: [{ p: [0.2, 0, 0], r: 0.58 }, { p: [0, 0.5 - kneeY, 0], r: 0.48 }], opts: { K: 12, N: 6 } }, at: [hipX, kneeY, z], stage: 'legs', bone: lower, line: 0.35, colour: SKIN });
  add({ shape: { ball: [1.05, 0.45, 0.68] }, at: [hipX + 0.55, 0.45, z], stage: 'legs', bone: lower, line: 0.35, colour: SKIN });
  pivots[upper] = [hipX, hipY, z]; pivots[lower] = [hipX + 0.2, kneeY, z];
}

// ---- the torso: a round belly that sticks out in front, narrow shoulders ----
const shoulder: Vec3 = [0.2, 5.4, 0];
add({
  shape: { tube: [{ p: [hipX - 0.1, 2.6], r: 1.6, wide: 1.1 }, { p: [0.45, 3.7], r: 2.1, wide: 0.92 }, { p: [shoulder[0], shoulder[1]], r: 1.3, wide: 1.3 }], opts: { K: 20, N: 14, ref: [0, 0, 1], cap: 0.8 } },
  stage: 'body', bone: 'body', line: 0.4, torso: true, colour: SKIN,
});

// ---- the arms: thin, with big hands of three claws ----
const R = 0.45, armLen = 2.7, shoulderZ = 1.3 * 1.3 + 0.4;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const at: Vec3 = [shoulder[0] + 0.1, shoulder[1] - 0.1, sd * shoulderZ];
  add({ shape: { ball: [R * 1.3, R * 1.25, R * 1.25] }, at: [at[0], at[1] + 0.05, at[2]], stage: 'arms', bone: `arm${s}`, line: 0.35, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: R }, { p: [0, -armLen, 0], r: R * 0.92 }], opts: { K: 10, N: 8 } }, at, stage: 'arms', bone: `arm${s}`, line: 0.35, colour: SKIN });
  const hand: Vec3 = [at[0], at[1] - armLen, at[2]];
  add({ shape: { ball: [R * 1.6, R * 1.5, R * 1.5] }, at: hand, stage: 'arms', bone: `hand${s}`, line: 0.35, colour: SKIN });
  // The claws: three short dark points that hang from the hand, spread forward and to both sides.
  for (const [dx, dz] of [[0.45, 0], [0.15, 0.5], [0.15, -0.5]] as const) {
    add({ shape: { drop: { r: 0.36, len: 1.25, sink: 0.3, wide: 0.9, dir: [dx * 0.9, -1, dz * 0.9] } }, at: [hand[0] + dx, hand[1] - 0.3, hand[2] + dz], stage: 'hair', bone: `hand${s}`, line: 0.25, colour: HORN });
  }
  pivots[`arm${s}`] = at;
}

// ---- the wings: small bat wings from the shoulder blades. One flat piece each: its line rises outwards and back to the wrist and
// droops to a pointed tip, the membrane hangs widest under the wrist. They flutter. ----
for (const sd of [1, -1]) {
  add({
    shape: { tube: [
      { p: [0, 0, 0], r: 0.6, wide: 0.6 }, { p: [-0.5, 1.5, 1.3 * sd], r: 1.25, wide: 0.3 }, { p: [-1.0, 2.1, 2.8 * sd], r: 1.35, wide: 0.28 },
      { p: [-1.5, 1.5, 3.9 * sd], r: 0.7, wide: 0.5 }, { p: [-1.8, 0.5, 4.6 * sd], r: 0.36, wide: 1 },
    ], opts: { K: 12, N: 24, ref: [1, 0, 0], cap: 0.6 } },
    at: [-0.9, 4.3, sd * 0.8],
    stage: 'hair', bone: 'body', line: 0.35, colour: SHADE, bend: { sway: 0.5, flutter: { rate: 6, angle: 0.5 } },
  });
}

// ---- the tail: thin, out of the back of the hips, curling up to a pointed end; it wags ----
add({
  shape: { tube: [
    { p: [0, 0, 0], r: 0.45 }, { p: [-1.3, -0.6, 0], r: 0.4 }, { p: [-2.5, 0.0, 0], r: 0.38 }, { p: [-3.0, 1.3, 0], r: 0.38 },
    { p: [-2.95, 1.75, 0], r: 0.38 }, { p: [-2.85, 2.15, 0], r: 0.95, wide: 0.85 }, { p: [-2.7, 2.9, 0], r: 0.55, wide: 1 }, { p: [-2.5, 3.7, 0], r: 0.36, wide: 1 },
  ], opts: { K: 10, N: 36, cap: 0.5 } },
  at: [-1.5, 2.8, 0], stage: 'hair', bone: 'body', line: 0.3, colour: SKIN, bend: { sway: 1, wag: 1 },
});

// ---- the head: big, no neck ----
const head = (x: number, y: number, z = 0): Vec3 => [0.8 + x, 7.26 + y, z];
pivots.head = [0.4, 5.6, 0];
add({ shape: { ball: [2.05, 1.95, 2.2], pow: 0.8 }, at: head(0, 0), stage: 'head', bone: 'head', line: 0.45, colour: SKIN });
// The horns stand on the hat bone, so the crest varies them about their foot. Upright: a horn that leans out to the side points at
// the camera on the near side of a side view and shrinks to a dot.
pivots.hat = head(0, 1.4);
for (const sd of [1, -1]) {
  add({ shape: { drop: { r: 0.5, len: 2.4, sink: 0.5, wide: 0.85, dir: [-0.15, 1, 0] } }, at: head(-0.1, 1.4, sd * 1.4), stage: 'spikes', bone: 'hat', line: 0.3, colour: HORN });
  // Pale eyes with a small dark pupil.
  add({ shape: { ball: [0.5, 0.7, 0.7] }, at: head(1.5, 0.2, sd * 1.15), stage: 'spikes', bone: 'head', line: 0, colour: EYE });
  add({ shape: { ball: [0.27, 0.3, 0.3] }, at: head(1.93, 0.15, sd * 1.2), stage: 'spikes', bone: 'head', line: 0, colour: DARK });
}

export const imp: TubeDesc = {
  name: 'Imp', size: 1, outline: 0x222222, pieces, pivots,
  parents: { head: 'body', hat: 'head', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: armLen, radius: R, stretch: 0.3 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false }, { upper: 'leg2', lower: 'leg3', front: false }],
  footprint: [1.3, 1.5],
};

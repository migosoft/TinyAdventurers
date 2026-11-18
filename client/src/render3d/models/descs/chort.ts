// The Chort (#356): tall and lean. Goat legs (the thigh forward, the shin back to the hock, the cannon forward again to a hoof), a
// narrow waist under a darker back, long thin arms with long white claws, long white horns, a wide grin of white teeth, a tail.
// Page px (one wolf model px), the front along +x, the feet at y 0, z to the figure's right. The colours are the pack sprite's (chort).

import type { Vec3 } from '../desc';
import { HEIGHT_FACTOR, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';

const SKIN = 0xda4e38, BACK = 0x9f294e, HOOF = 0x5f2d56, BONE = 0xfdf7ed, DARK = 0x222222;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): void => { pieces.push(p); };

// ---- the legs: the rest angles are in the geometry. The upper bone carries the thigh (forward) and the shin (back); the joint the
// walk bends is the hock behind the hip (`knee: -1`: the cannon swings forward and lifts the hoof). The hoof stands under the hip. ----
const hipX = 0, hipY = 9.6, legZ = 1.55;
const thighA = 0.62, thighL = 3.6, shinA = -1.0, shinL = 4.2;
const stifle: [number, number] = [hipX + thighL * Math.sin(thighA), hipY - thighL * Math.cos(thighA)];
const hock: [number, number] = [stifle[0] + shinL * Math.sin(shinA), stifle[1] - shinL * Math.cos(shinA)];
const ankle: [number, number] = [hipX + 0.1, 0.75];
const cannonA = Math.atan2(ankle[0] - hock[0], hock[1] - ankle[1]), cannonL = Math.hypot(ankle[0] - hock[0], hock[1] - ankle[1]);
const pivots: TubeDesc['pivots'] = { body: [hipX, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 0.5, 0], r: 1.5 }, { p: [0, -thighL * 0.5, 0], r: 1.3 }, { p: [0, -thighL, 0], r: 0.85 }], opts: { K: 12, N: 8 } }, at: [hipX, hipY, z], turn: thighA, stage: 'legs', bone: upper, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 0.85 }, { p: [0, -shinL, 0], r: 0.62 }], opts: { K: 12, N: 8 } }, at: [stifle[0], stifle[1], z], turn: shinA, stage: 'legs', bone: upper, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: 0.62 }, { p: [0, -cannonL, 0], r: 0.5 }], opts: { K: 12, N: 8 } }, at: [hock[0], hock[1], z], turn: cannonA, stage: 'legs', bone: lower, line: 0.4, colour: SKIN });
  add({ shape: { ball: [1.0, 0.6, 0.75] }, at: [hipX + 0.35, 0.6, z], stage: 'legs', bone: lower, line: 0.4, colour: HOOF });
  pivots[upper] = [hipX, hipY, z]; pivots[lower] = [hock[0], hock[1], z];
}

// ---- the torso: narrow hips and waist, the chest wider and a little forward. Painted: the back darker ----
const shoulder: Vec3 = [0.6, 15.0, 0], chestR = 2.1, chestWide = 1.4;
add({
  shape: { tube: [{ p: [hipX - 0.2, 9.5], r: 1.65, wide: 1.15 }, { p: [0, 12.0], r: 1.35, wide: 1.1 }, { p: [shoulder[0], shoulder[1]], r: chestR, wide: chestWide }], opts: { K: 22, N: 16, ref: [0, 0, 1], cap: 0.85 } },
  stage: 'body', bone: 'body', line: 0.45, torso: true,
  // Round an upright tube `d` runs from the back (0) to the front (1).
  colour: (_u, d) => (d < 0.45 ? BACK : SKIN),
});

// ---- the arms: long and thin, to the knees; three long white claws on each hand ----
const R = 0.6, armLen = 6.2, shoulderZ = chestR * chestWide + 0.2;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const at: Vec3 = [shoulder[0], shoulder[1] - 0.1, sd * shoulderZ];
  add({ shape: { ball: [R * 1.35, R * 1.25, R * 1.3] }, at: [at[0], at[1] + 0.1, at[2]], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: R }, { p: [0, -armLen, 0], r: R * 0.9 }], opts: { K: 10, N: 8 } }, at, stage: 'arms', bone: `arm${s}`, line: 0.4, colour: SKIN });
  const hand: Vec3 = [at[0], at[1] - armLen, at[2]];
  add({ shape: { ball: [R * 1.5, R * 1.4, R * 1.4] }, at: hand, stage: 'arms', bone: `hand${s}`, line: 0.4, colour: SKIN });
  for (const [dx, dz] of [[0.5, 0], [0.15, 0.55], [0.15, -0.55]] as const) {
    add({ shape: { drop: { r: 0.42, len: 2.6, sink: 0.4, wide: 0.9, dir: [dx * 0.7, -1, dz * 0.7] } }, at: [hand[0] + dx, hand[1] - 0.3, hand[2] + dz], stage: 'hair', bone: `hand${s}`, line: 0.3, colour: BONE });
  }
  pivots[`arm${s}`] = at;
}

// ---- the tail: thin, out of the back of the hips, hanging in a bow and curling up to a flat spade; it wags ----
add({
  shape: { tube: [
    { p: [0, 0, 0], r: 0.55 }, { p: [-1.8, -1.2, 0], r: 0.45 }, { p: [-3.4, -1.6, 0], r: 0.42 }, { p: [-4.6, -0.6, 0], r: 0.4 }, { p: [-5.0, 1.0, 0], r: 0.4 },
    { p: [-5.0, 1.6, 0], r: 1.0, wide: 0.6 }, { p: [-4.9, 2.4, 0], r: 0.6, wide: 0.8 }, { p: [-4.8, 3.2, 0], r: 0.36, wide: 1 },
  ], opts: { K: 10, N: 40, cap: 0.5 } },
  at: [hipX - 1.2, 10.0, 0], stage: 'hair', bone: 'body', line: 0.3, colour: SKIN, bend: { sway: 1, wag: 1 },
});

// ---- the head: a long jaw under it with the grin ----
const head = (x: number, y: number, z = 0): Vec3 => [1.0 + x, 17.4 + y, z];
pivots.head = [0.6, 16.0, 0];
add({ shape: { ball: [1.9, 1.95, 1.9], pow: 0.85 }, at: head(0, 0), stage: 'head', bone: 'head', line: 0.45, colour: SKIN });
const jaw = { x: 0.9, y: -0.95, rx: 1.55, rz: 1.95 };
add({ shape: { ball: [jaw.rx, 1.0, jaw.rz], pow: 0.85 }, at: head(jaw.x, jaw.y), stage: 'hair', bone: 'head', line: 0.35, colour: SKIN });
// The grin: a dark mouth round the front of the jaw, its corners drawn up, and a row of white teeth on it.
const mouth = (a: number, out: number): Vec3 => head(jaw.x + (jaw.rx + out) * Math.cos(a), jaw.y + 0.05 + 0.22 * (a * a), (jaw.rz + out) * Math.sin(a));
add({
  shape: { tube: [-1.15, -0.6, 0, 0.6, 1.15].map((a) => { const q = mouth(a, -0.3); return { p: [q[0], q[1], q[2]] as [number, number, number], r: 0.5 }; }), opts: { K: 8, N: 16, ref: [0, 1, 0], cap: 0.5 } },
  stage: 'spikes', bone: 'head', line: 0, colour: DARK,
});
for (let i = 0; i < 7; i++) {
  const q = mouth((i - 3) / 3 * 1.05, 0);
  add({ shape: { ball: [0.4, 0.45, 0.4] }, at: q, stage: 'spikes', bone: 'head', line: 0, colour: BONE });
}
// The horns stand on the hat bone, so the crest varies them about their foot: long, rising with a bow backwards, the tips forward.
pivots.hat = head(-0.2, 1.2);
for (const sd of [1, -1]) {
  add({
    shape: { tube: [{ p: [0, 0, 0], r: 0.65 }, { p: [-0.3, 1.2, 1.1 * sd], r: 0.58 }, { p: [-0.6, 2.9, 1.7 * sd], r: 0.48 }, { p: [-0.5, 4.4, 1.3 * sd], r: 0.4 }, { p: [0, 5.4, 0.6 * sd], r: 0.36 }], opts: { K: 10, N: 22, cap: 0.7 } },
    at: head(-0.2, 1.2, sd * 1.1), stage: 'spikes', bone: 'hat', line: 0.3, colour: BONE,
  });
  // Pale eyes with a dark pupil, small and high: the grin is the wide white line of the face.
  add({ shape: { ball: [0.4, 0.5, 0.55] }, at: head(1.55, 0.55, sd * 0.85), stage: 'spikes', bone: 'head', line: 0, colour: BONE });
  add({ shape: { ball: [0.24, 0.28, 0.28] }, at: head(1.85, 0.5, sd * 0.88), stage: 'spikes', bone: 'head', line: 0, colour: DARK });
  // A dark brow slanting down to the middle: the grin is not a friendly one.
  add({ shape: { tube: [{ p: [0, 0.3, 0.5 * sd], r: 0.36 }, { p: [0.25, -0.15, -0.45 * sd], r: 0.36 }], opts: { K: 8, N: 4, cap: 0.5 } }, at: head(1.45, 1.25, sd * 0.85), stage: 'spikes', bone: 'head', line: 0, colour: DARK });
}

export const chort: TubeDesc = {
  name: 'Chort', size: fitSize(HEIGHT_FACTOR.chort, 21.006), outline: 0x222222, pieces, pivots,
  parents: { head: 'body', hat: 'head', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: armLen, radius: R, stretch: 0.3 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false, knee: -1 }, { upper: 'leg2', lower: 'leg3', front: false, knee: -1 }],
  footprint: [2.2, 2.2],
};

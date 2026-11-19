// The Shade (#359): a lean, black figure on two thin legs, floating, with no face but two glowing eyes painted by the material. Built
// like the Knight (same bones, two legs) and like the Imp (arms without an elbow, which are the description's own). Page px (one wolf
// model px), the front along +x, the feet at y 0, z to the figure's right. Every piece is flat near-black and unlit-glowing (`glow`),
// so no light shows its shape: it reads as a silhouette. First values for the user's eye.

import { HEIGHT_FACTOR, fitSize, type TubeDesc, type TubePiece } from '../tubeDesc';
import type { TubePoint } from '../tubes';

const BLACK = 0x030205;
/** The Shade's drawn height at size 1 (game px, the model's `baseHeight` at size 1): `fitSize` makes it as tall as `HEIGHT_FACTOR.spectre` humans. */
const DRAWN = 17.587;

const pieces: TubePiece[] = [];
const add = (p: Omit<TubePiece, 'colour' | 'line' | 'glow'>): void => { pieces.push({ ...p, colour: BLACK, glow: true, line: 0 }); };

// ---- the legs: thin, a knee, a foot ball hanging at the shin's end ----
const hipY = 7.0, kneeY = 3.7, legZ = 1.0;
const pivots: TubeDesc['pivots'] = { body: [0, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [0, 0.5, 0], r: 0.9 }, { p: [0.1, kneeY - hipY, 0], r: 0.7 }], opts: { K: 12, N: 8 } }, at: [0, hipY, z], stage: 'legs', bone: upper });
  add({ shape: { tube: [{ p: [0.1, 0, 0], r: 0.7 }, { p: [0, 1.0 - kneeY, 0], r: 0.55 }], opts: { K: 12, N: 8 } }, at: [0, kneeY, z], stage: 'legs', bone: lower });
  add({ shape: { ball: [0.9, 0.5, 0.6] }, at: [0.45, 0.85, z], stage: 'legs', bone: lower });
  pivots[upper] = [0, hipY, z]; pivots[lower] = [0.1, kneeY, z];
}

// ---- the torso: a lean tube, narrow at the waist, wider at the chest ----
const chestR = 2.0, chestW = 1.52, armR = 0.6;
const torso: TubePoint[] = [{ p: [0, 7.2], r: 1.75, wide: 1.15 }, { p: [0.1, 9.4], r: 1.7, wide: 1.2 }, { p: [0.3, 11.5], r: chestR, wide: chestW }];
add({ shape: { tube: torso, opts: { K: 20, N: 14, ref: [0, 0, 1], cap: 0.7 } }, stage: 'body', bone: 'body', torso: true });
add({ shape: { tube: [{ p: [0.3, 11.2], r: 0.7 }, { p: [0.4, 12.9], r: 0.7 }], opts: { K: 8, N: 8, cap: 0.5 } }, stage: 'body', bone: 'body' });

// ---- the arms: long, limp, without an elbow, ending in a small hand ----
const armLen = 5.6, shoulderX = 0.3, shoulderY = 11.5, shoulderZ = chestR * chestW + 0.35 * armR;   // the arm sinks into the chest, as the Knight's does
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const z = sd * shoulderZ;
  add({ shape: { tube: [{ p: [0, 0, 0], r: 0.6 }, { p: [0, -armLen, 0], r: 0.5 }], opts: { K: 12, N: 8 } }, at: [shoulderX, shoulderY, z], stage: 'arms', bone: `arm${s}` });
  add({ shape: { ball: [0.65, 0.65, 0.65] }, at: [shoulderX, shoulderY - armLen, z], stage: 'arms', bone: `hand${s}` });
  pivots[`arm${s}`] = [shoulderX, shoulderY, z];
}

// ---- the head: a dark ball; the eyes are the material's ----
add({ shape: { ball: [1.75, 1.9, 1.75] }, at: [0.4, 14.3, 0], stage: 'head', bone: 'head' });
pivots.head = [0.3, 12.4, 0];

export const shade: TubeDesc = {
  name: 'Shade', size: fitSize(HEIGHT_FACTOR.spectre, DRAWN), outline: 0x222222, pieces, pivots,
  parents: { head: 'body', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: { length: armLen, radius: 0.6 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false }, { upper: 'leg2', lower: 'leg3', front: false }],
  footprint: [1.8, 2.0],
  float: true,
  spectre: {
    // half[0] is 0.72 * 0.68 / 0.95: the spike's width-to-distance proportion, carried into this lean body's narrower z.
    eyes: { y: 14.9, z: 0.72, front: 1.35, half: [0.52, 0.28], slant: 0.42, core: 0xe0f5ff, ring: 0x4d8cff, strength: 1 },
    fog: true,
    swoosh: { colour: 0x000003, head: 0xb3e6ff },
  },
};

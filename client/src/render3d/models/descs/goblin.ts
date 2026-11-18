// The Goblin Archer (#356): small and hunched. The torso leans forward, so the big head sits in front of the hips; long pointed ears
// that sway, a long nose, pale eyes, thin arms and legs, a rag loincloth. Page px (one wolf model px), the front along +x, the feet
// at y 0, z to the figure's right. The colours are the pack sprite's (goblin).

import type { Vec3 } from '../desc';
import type { TubeDesc, TubePiece } from '../tubeDesc';

const SKIN = 0x3d734f, RAG = 0x314152, EYE = 0xfdf7ed, DARK = 0x222222;

const pieces: TubePiece[] = [];
const add = (p: TubePiece): void => { pieces.push(p); };

// ---- the legs: thin, a little bent at the knee, a long bare foot ----
// The hips are behind the middle and the shoulders in front of it, so the hanging arms clear the legs in a side view.
const hipX = -0.6, hipY = 4.0, kneeY = 2.1, legZ = 1.15;
const pivots: TubeDesc['pivots'] = { body: [hipX, hipY, 0] };
for (const [upper, lower, sd] of [['leg0', 'leg1', 1], ['leg2', 'leg3', -1]] as const) {
  const z = sd * legZ;
  add({ shape: { tube: [{ p: [-0.1, 0.3, 0], r: 0.8 }, { p: [0.25, kneeY - hipY, 0], r: 0.6 }], opts: { K: 12, N: 6 } }, at: [hipX, hipY, z], stage: 'legs', bone: upper, line: 0.35, colour: SKIN });
  add({ shape: { tube: [{ p: [0.25, 0, 0], r: 0.6 }, { p: [0, 0.6 - kneeY, 0], r: 0.5 }], opts: { K: 12, N: 6 } }, at: [hipX, kneeY, z], stage: 'legs', bone: lower, line: 0.35, colour: SKIN });
  add({ shape: { ball: [1.2, 0.5, 0.75] }, at: [hipX + 0.65, 0.5, z], stage: 'legs', bone: lower, line: 0.35, colour: SKIN });
  pivots[upper] = [hipX, hipY, z]; pivots[lower] = [hipX + 0.25, kneeY, z];
}

// ---- the torso: a small pot belly that leans forward to narrow shoulders ----
const shoulder: Vec3 = [1.5, 6.5, 0];
add({
  shape: { tube: [{ p: [hipX - 0.2, hipY], r: 1.5, wide: 1.15 }, { p: [0.3, 5.2], r: 1.6, wide: 1.15 }, { p: [shoulder[0], shoulder[1]], r: 1.3, wide: 1.3 }], opts: { K: 20, N: 14, ref: [0, 0, 1], cap: 0.8 } },
  stage: 'body', bone: 'body', line: 0.4, torso: true, colour: SKIN,
});
// The rag: a band round the hips, and a pointed flap that hangs in front and one behind.
add({ shape: { tube: [{ p: [hipX + 0.3, hipY + 0.6], r: 1.75, wide: 1.15 }, { p: [hipX - 0.1, hipY - 0.6], r: 1.8, wide: 1.15 }], opts: { K: 20, N: 5, ref: [0, 0, 1], cap: 0.2 } }, stage: 'collar', bone: 'body', line: 0.35, colour: RAG });
add({ shape: { drop: { r: 1.0, len: 2.7, sink: 0.5, wide: 0.45, dir: [0.12, -1, 0] } }, at: [hipX + 1.5, hipY - 0.1, 0], stage: 'collar', bone: 'body', line: 0.3, colour: RAG });
add({ shape: { drop: { r: 1.0, len: 2.4, sink: 0.5, wide: 0.45, dir: [-0.15, -1, 0] } }, at: [hipX - 1.9, hipY - 0.1, 0], stage: 'collar', bone: 'body', line: 0.3, colour: RAG });

// ---- the arms: thin, hanging from the forward shoulders, with big hands ----
const R = 0.52, armLen = 3.6, shoulderZ = 1.3 * 1.3 + 0.5;
for (const [s, sd] of [['R', 1], ['L', -1]] as const) {
  const at: Vec3 = [shoulder[0] + 0.1, shoulder[1] - 0.1, sd * shoulderZ];
  add({ shape: { ball: [R * 1.35, R * 1.3, R * 1.3] }, at: [at[0], at[1] + 0.1, at[2]], stage: 'arms', bone: `arm${s}`, line: 0.35, colour: SKIN });
  add({ shape: { tube: [{ p: [0, 0, 0], r: R }, { p: [0, -armLen, 0], r: R * 0.9 }], opts: { K: 10, N: 8 } }, at, stage: 'arms', bone: `arm${s}`, line: 0.35, colour: SKIN });
  add({ shape: { ball: [R * 1.5, R * 1.5, R * 1.35] }, at: [at[0], at[1] - armLen, at[2]], stage: 'arms', bone: `hand${s}`, line: 0.35, colour: SKIN });
  pivots[`arm${s}`] = at;
}

// ---- the head: big, in front of the hips ----
const head = (x: number, y: number, z = 0): Vec3 => [2.6 + x, 8.65 + y, z];
pivots.head = [1.8, 6.9, 0];
add({ shape: { ball: [2.45, 2.4, 2.6], pow: 0.8 }, at: head(0, 0), stage: 'head', bone: 'head', line: 0.45, colour: SKIN });
// The long nose: it points forward and droops a little to a thin tip.
add({ shape: { tube: [{ p: [0, 0, 0], r: 0.85 }, { p: [1.5, -0.25, 0], r: 0.62 }, { p: [2.9, -0.8, 0], r: 0.36 }], opts: { K: 10, N: 10 } }, at: head(1.8, -0.35), stage: 'hair', bone: 'head', line: 0.25, colour: SKIN });
for (const sd of [1, -1]) {
  // The ears: long, flat and pointed, swept back and out to the side; they sway.
  add({ shape: { drop: { r: 1.0, len: 5.2, sink: 0.7, wide: 0.42, dir: [-0.8, 0.3, 0.75 * sd] } }, at: head(-0.6, 0.2, sd * 2.1), stage: 'hair', bone: 'head', line: 0.35, colour: SKIN, bend: { sway: 0.8 } });
  // Pale eyes, wide apart above the nose, each with a small dark pupil.
  add({ shape: { ball: [0.5, 0.72, 0.78] }, at: head(1.85, 0.55, sd * 1.4), stage: 'spikes', bone: 'head', line: 0, colour: EYE });
  add({ shape: { ball: [0.27, 0.3, 0.3] }, at: head(2.3, 0.5, sd * 1.5), stage: 'spikes', bone: 'head', line: 0, colour: DARK });
}

export const goblin: TubeDesc = {
  name: 'Goblin Archer', size: 1, outline: 0x222222, pieces, pivots,
  parents: { head: 'body', leg1: 'leg0', leg3: 'leg2' },
  // Thin arms of a natural length: they take a third of the lengthening the short-armed figures need in a blow.
  stance: 'two', arms: { length: armLen, radius: R, stretch: 0.3 },
  legs: [{ upper: 'leg0', lower: 'leg1', front: false }, { upper: 'leg2', lower: 'leg3', front: false }],
  footprint: [1.8, 2.3],
};

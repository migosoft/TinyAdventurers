// Two small two-legged descriptions for the tests of the tube builder (#356): no creature, only the shapes the builder must handle.

import type { TubeDesc, TubePiece } from './tubeDesc';

const SKIN = 0x6a9a58, CLOTH = 0x8f4029, STEEL = 0xc0c8d0, OUTLINE = 0x1c1614;
const ARM = { length: 5, radius: 0.9 };

/** Torso, head, two arms with hands, two legs of two bones each, one fluttering drop (an ear) and one steel piece (a helm). */
const bipedPieces = (): TubePiece[] => {
  const pieces: TubePiece[] = [
    { shape: { tube: [{ p: [0, 8], r: 2.4 }, { p: [0, 13], r: 2.6 }], opts: { K: 8, N: 10 } }, stage: 'body', bone: 'body', line: 0.4, torso: true, colour: CLOTH },
    { shape: { ball: [2, 2, 2] }, at: [0, 15.5, 0], stage: 'head', bone: 'head', line: 0.4, colour: SKIN },
    { shape: { ball: [1.2, 0.5, 1.2] }, at: [0, 17.6, 0], stage: 'hair', bone: 'head', line: 0.3, colour: STEEL, metal: true },
    { shape: { drop: { r: 0.8, len: 3, sink: 0.5, wide: 0.5, dir: [-0.3, 0.6, 1] } }, at: [0, 16, 1.8], stage: 'hair', bone: 'head', line: 0.3, colour: SKIN, bend: { sway: 0.8, flutter: { rate: 3, angle: 0.4 } } },
  ];
  for (const [s, z] of [['R', 3], ['L', -3]] as const) {
    pieces.push({ shape: { tube: [{ p: [0, 0], r: ARM.radius }, { p: [0, -ARM.length], r: ARM.radius }], opts: { K: 6, N: 8 } }, at: [0, 12, z], stage: 'arms', bone: `arm${s}`, line: 0.4, colour: SKIN });
    pieces.push({ shape: { ball: [ARM.radius, ARM.radius, ARM.radius] }, at: [0, 12 - ARM.length, z], stage: 'arms', bone: `hand${s}`, line: 0.4, colour: SKIN });
  }
  for (const [i, z] of [[0, 1.2], [2, -1.2]] as const) {
    pieces.push({ shape: { tube: [{ p: [0, 8], r: 1.1 }, { p: [0, 4], r: 1 }], opts: { K: 6, N: 8 } }, at: [0, 0, z], stage: 'legs', bone: `leg${i}` as 'leg0' | 'leg2', line: 0.4, colour: CLOTH });
    pieces.push({ shape: { tube: [{ p: [0, 4], r: 1 }, { p: [0.4, 0.5], r: 0.9 }], opts: { K: 6, N: 8 } }, at: [0, 0, z], stage: 'legs', bone: `leg${i + 1}` as 'leg1' | 'leg3', line: 0.4, colour: SKIN });
  }
  return pieces;
};

export const biped: TubeDesc = {
  name: 'Biped', size: 1, outline: OUTLINE,
  pieces: bipedPieces(),
  pivots: {
    body: [0, 8, 0], head: [0, 13, 0], armR: [0, 12, 3], armL: [0, 12, -3],
    leg0: [0, 8, 1.2], leg1: [0, 4, 1.2], leg2: [0, 8, -1.2], leg3: [0, 4, -1.2],
  },
  parents: { head: 'body', hat: 'head', leg1: 'leg0', leg3: 'leg2' },
  stance: 'two', arms: ARM,
  legs: [{ upper: 'leg0', lower: 'leg1', front: false }, { upper: 'leg2', lower: 'leg3', front: false }],
  footprint: [3, 3],
};

/** A robe from the shoulders to the hem and no legs: the robe swings below `robeTop` 6. */
export const robedBiped: TubeDesc = {
  name: 'Robed Biped', size: 1, outline: OUTLINE,
  pieces: [
    { shape: { tube: [{ p: [0, 0.5], r: 3.6 }, { p: [0, 8], r: 2.8 }, { p: [0, 13], r: 2.6 }], opts: { K: 10, N: 12 } }, stage: 'body', bone: 'body', line: 0.4, torso: true, robe: true, colour: CLOTH },
    { shape: { ball: [2, 2, 2] }, at: [0, 15.5, 0], stage: 'head', bone: 'head', line: 0.4, colour: SKIN },
    ...bipedPieces().filter((p) => p.bone === 'armR' || p.bone === 'armL' || p.bone === 'handR' || p.bone === 'handL'),
  ],
  pivots: { body: [0, 8, 0], head: [0, 13, 0], armR: [0, 12, 3], armL: [0, 12, -3] },
  parents: { head: 'body' },
  stance: 'two', arms: ARM, robeTop: 6,
  legs: [],
  footprint: [3, 3],
};

// The Mimic (#317): the chest of chest.ts with a red-violet lining, and teeth and a tongue behind the lid. Game px, as the chest.

import type { TubeDesc, TubePiece } from '../tubeDesc';
import { PAGE_TO_GAME } from '../tubeModel';
import { chestShell, HINGE } from './chest';

const TEETH = 0xfdf7ed, TONGUE = 0xdc4a7b;

const tooth = (bone: 'body' | 'head', z: number, from: number, to: number): TubePiece => ({
  shape: { tube: [{ p: [2.8, from, z], r: 0.6 }, { p: [2.8, to, z], r: 0.1 }], opts: { K: 8, N: 6 } },
  stage: 'spikes', bone, colour: TEETH, line: 0.2,
});

const TONGUE_AT = [2.5, 1.5, 0] as const;
const pieces: TubePiece[] = [
  ...chestShell(0x5f2d56),
  ...[-5, -3, -1, 1, 3, 5].map((z) => tooth('body', z, 5.0, 6.9)),
  ...[-4, -2, 0, 2, 4].map((z) => tooth('head', z, 7.0, 5.6)),
  // The tongue's points are relative to its foot (`at`, the hat pivot), which the sway turns about.
  {
    shape: { tube: [{ p: [0, 0], r: 1.1, wide: 1.6 }, { p: [1.5, 4.4], r: 1.03, wide: 1.6 }, { p: [2.8, 4.1], r: 0.97, wide: 1.6 }, { p: [3.1, 1.7], r: 0.9, wide: 1.6 }] },
    at: TONGUE_AT, stage: 'hair', bone: 'hat', colour: TONGUE, line: 0.3, bend: { sway: 1 },
  },
];

export const mimic: TubeDesc = {
  name: 'Mimic', size: 1 / PAGE_TO_GAME, outline: 0x222222, pieces,
  pivots: { body: [0, 0, 0], head: HINGE, hat: TONGUE_AT },
  parents: { head: 'body', hat: 'body' },
  legs: [], footprint: [4.5, 7],
};

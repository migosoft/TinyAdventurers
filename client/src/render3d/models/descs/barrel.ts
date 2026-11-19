// The explosive barrel (#317): a bulging wooden barrel with two iron hoops, a red band and a red lid. Game px (one description px is
// one game px); y up, the barrel stands on the ground at y 0. The only painted piece is the body.

import type { TubeDesc, TubePiece } from '../tubeDesc';
import { PAGE_TO_GAME } from '../tubeModel';

const STAVE = 0xc56025, SEAM = 0x38262d, HOOP = 0x7b8994, RED = 0xda4e38;

/** The body's paint: `u` runs up the barrel, `d` round it (0..1). Hoops at the lower and upper third, a red band between, staves elsewhere. */
export const barrelPaint = (u: number, d: number): number => {
  if ((u >= 0.2 && u <= 0.27) || (u >= 0.68 && u <= 0.75)) return HOOP;
  if (u >= 0.42 && u <= 0.56) return RED;
  return (d * 5) % 1 < 0.2 ? SEAM : STAVE;
};

const pieces: TubePiece[] = [
  {
    shape: { tube: [{ p: [0, 0.8], r: 5.3 }, { p: [0, 7.5], r: 6.4 }, { p: [0, 14.2], r: 5.3 }], opts: { K: 20, N: 16, cap: 0.15, ref: [1, 0, 0] } },
    stage: 'body', bone: 'body', line: 0.45, torso: true, colour: barrelPaint,
  },
  { shape: { ball: [5.2, 0.8, 5.2] }, at: [0, 14.6, 0], stage: 'head', bone: 'body', line: 0.3, colour: RED },
];

export const barrel: TubeDesc = {
  name: 'Barrel', size: 1 / PAGE_TO_GAME, outline: 0x222222,
  pieces,
  pivots: { body: [0, 0, 0] },
  parents: {},
  legs: [], footprint: [6.4, 6.4],
};

// The explosive barrel (#317): a bulging wooden barrel with two iron hoops, a red band and a head of four planks. Game px (one
// description px is one game px); y up, the barrel stands on the ground at y 0. The only painted piece is the body.

import type { TubeDesc, TubePiece } from '../tubeDesc';
import { PAGE_TO_GAME } from '../tubeModel';

const STAVE = 0xc56025, SEAM = 0x38262d, HOOP = 0x7b8994, RED = 0xda4e38, HEAD_WOOD = 0xee8e2e;
/** The head (the wooden top): a low dome of radius `r` whose rim is at `y`, rising `rise` to the middle. */
const HEAD = { r: 5.2, y: 14.55, rise: 0.8 } as const;
/** The head's plank seams run along x at these z: four planks. */
export const HEAD_SEAMS = [-2.6, 0, 2.6] as const;

/**
 * The body's paint: `u` runs up the barrel, `d` from the top (0) to the underside (1) and mirrors back on the other half. Hoops at the
 * lower and upper third, a red band between, staves elsewhere: seams centred on d = 0, 0.25, 0.5, 0.75, 1, so 8 even staves round.
 */
export const barrelPaint = (u: number, d: number): number => {
  if ((u >= 0.2 && u <= 0.27) || (u >= 0.68 && u <= 0.75)) return HOOP;
  if (u >= 0.42 && u <= 0.56) return RED;
  return (d * 4 + 0.125) % 1 < 0.25 ? SEAM : STAVE;
};

const pieces: TubePiece[] = [
  {
    shape: { tube: [{ p: [0, 0.8], r: 5.3 }, { p: [0, 7.5], r: 6.4 }, { p: [0, 14.2], r: 5.3 }], opts: { K: 20, N: 16, cap: 0.15, ref: [1, 0, 0] } },
    stage: 'body', bone: 'body', line: 0.45, torso: true, colour: barrelPaint,
  },
  { shape: { ball: [HEAD.r, HEAD.rise, HEAD.r] }, at: [0, HEAD.y, 0], stage: 'head', bone: 'body', line: 0.3, colour: HEAD_WOOD },
  ...HEAD_SEAMS.map((z0): TubePiece => {
    // A seam follows the head's dome along x, a hair proud of it, and ends just inside the rim (measured at its outer edge).
    const half = 0.2, reach = 0.98 * Math.sqrt(HEAD.r ** 2 - (Math.abs(z0) + half) ** 2), steps = 8;
    const top = (x: number): number => HEAD.y + HEAD.rise * Math.sqrt(Math.max(0, 1 - (x * x + z0 * z0) / HEAD.r ** 2)) + 0.05;
    const xs = Array.from({ length: steps + 1 }, (_, i) => reach - 2 * reach * i / steps);
    const outline = [[-reach, HEAD.y], [reach, HEAD.y], ...xs.map((x) => [x, top(x)])] as [number, number][];
    return { shape: { prism: { outline, z: [z0 - half, z0 + half] } }, stage: 'collar', bone: 'body', line: 0, colour: SEAM };
  }),
];

export const barrel: TubeDesc = {
  name: 'Barrel', size: 1 / PAGE_TO_GAME, outline: 0x222222,
  pieces,
  pivots: { body: [0, 0, 0] },
  parents: {},
  legs: [], footprint: [6.4, 6.4],
};

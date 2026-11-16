// The tone rule of the 3D trees (#329, #339), as pure maths: which ramp step the light asks for and how bright the picked tone is shown.
// The shader (treeNodes.ts) builds the same expressions from the same constants.
import { sky, type Vec3 } from '../sun';

/**
 * The light's brightness on the ramp. `mid`: the relative brightness that sits on the ramp's middle; `gain`: ramp steps per doubling;
 * `lo`, `hi`: the relative brightness range the ramp covers (below `lo` a tree darkens with the light, above `hi` it brightens with it,
 * and the step stays at the range's end, so the crown's form still picks different tones); the ramp steps of the leaves and the bark.
 */
export const TREE_LIGHT = {
  mid: 0.7, // first guess
  gain: 0.8, // first guess
  lo: 0.3, // first guess: just under a noon shade's brightness (0.34)
  hi: 1.7, // first guess: above the noon sun's brightness (1.27)
  steps: [-0.75, -0.3, 0.2, 0.6],
  barkSteps: [-0.5, 0, 0.55],
} as const;

/** The least sky level: keeps the division finite under a black sky. */
export const SKY_LEVEL_MIN = 0.02;

const lum = (v: Vec3): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

/** The luminance of the ambient light plus the sun at 13:00: the sky level's 1. */
export const NOON_LIGHT = ((): number => {
  const n = sky(13);
  return lum([n.ambient[0] + n.colour[0], n.ambient[1] + n.colour[1], n.ambient[2] + n.colour[2]]);
})();

/**
 * How bright the sky's light is against noon's (`SKY_LEVEL_MIN`..1): the luminance of the ambient light plus the sun's (or moon's) colour
 * over `NOON_LIGHT`. The ramp is read against it, so a tree shows the same tones at every hour and is darker by this factor.
 * A level without a sun has no sky: its level is 1.
 */
export function skyLevel(ambient: Vec3, colour: Vec3): number {
  return Math.min(1, Math.max(SKY_LEVEL_MIN, lum([ambient[0] + colour[0], ambient[1] + colour[1], ambient[2] + colour[2]]) / NOON_LIGHT));
}

/**
 * The tone of a light of brightness `b` under sky level `level`: `rel` is the light against the sky's level, held inside the ramp's
 * range; `step` is the ramp step it asks for (0 at `mid`); the palette tone is shown times the light's colour over `rel`.
 */
export function treeTone(b: number, level: number): { rel: number; step: number } {
  const rel = Math.min(TREE_LIGHT.hi, Math.max(TREE_LIGHT.lo, b / level));
  return { rel, step: Math.log2(rel / TREE_LIGHT.mid) * TREE_LIGHT.gain };
}

/** The leaf ramp's tone (0..4) a step value picks. */
export function leafLevelOf(l: number): number {
  return TREE_LIGHT.steps.filter((s) => l >= s).length;
}

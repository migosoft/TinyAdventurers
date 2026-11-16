// Falling leaves (#329): rare single leaves that start from a tree's real lobes, drift down with the wind, land, lie a moment and fade.
// `pushLeaves` fills the CPU buffer a chunk keeps; `leafAt` is the CPU twin of the path the leaf shader (`leafMaterial`) draws.
import { rng } from './recipe';
import { WIND_DIR } from '../wind';
import type { BuiltTree } from './build';

/** Seconds a leaf falls, lies on the ground and fades (first guesses). */
export const LEAF_FALL = 6; // first guess
export const LEAF_LIE = 8; // first guess
export const LEAF_FADE = 2; // first guess
/** A leaf's whole life: the least a period can be. */
export const LEAF_LIFE = LEAF_FALL + LEAF_LIE + LEAF_FADE;
/** The height a landed leaf lies at. */
export const GROUND = 0.01;
/** Tiles the wind carries a leaf over its fall (scaled 0.6..1.4 by its seed), and how far it flutters aside at most. */
export const LEAF_DRIFT = 1.8; // first guess
export const LEAF_FLUTTER = 0.12; // first guess
/** Flutter radians per second. */
export const LEAF_FLUTTER_RATE = 2.2; // first guess
/** A leaf's half-width in tiles: two art pixels across (one pixel vanishes among the flowers). */
export const LEAF_HALF = 1 / 16; // first guess
/** A leaf falls once per period, 90..300 seconds (1.5 to 5 minutes). */
export const LEAF_PERIOD = [90, 300] as const;
/** How far from a lobe's centre, in its radii, a leaf may start. */
const START_REACH = 0.9;

/**
 * The falling leaves of one chunk, flat. `start` (x, y, z), `params` (period, phase 0..1, threshold, seed 0..1), `sway` (the lobe's sway factor) and
 * `foot` (the tree's foot x, z) come from `pushLeaves`; the forest then adds the plant's `leaf` amount and `look` (as for the mesh vertices).
 */
export interface LeafBuf { start: number[]; params: number[]; sway: number[]; foot: number[]; leaf: number[]; look: number[]; n: number }

export function newLeafBuf(): LeafBuf { return { start: [], params: [], sway: [], foot: [], leaf: [], look: [], n: 0 }; }

/** A seed for a tree's leaves from its look seed and its foot, so two trees of one look fall out of step. */
export function leafSeed(seed: number, x: number, z: number): number {
  return (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(Math.round(x * 16), 0x85ebca6b) ^ Math.imul(Math.round(z * 16), 0xc2b2ae35)) >>> 0;
}

/** One leaf per lobe of a tree that sheds leaves, standing at (x, z): from a point under the lobe within 0.9 of its radius. */
export function pushLeaves(out: LeafBuf, t: BuiltTree, x: number, z: number, seed: number): void {
  if (!t.drops) return;
  t.lobes.forEach((l, i) => {
    const r = rng((Math.imul(seed | 0, 0x2545f491) + Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const reach = START_REACH * l.r, a = r() * Math.PI * 2, rad = reach * Math.sqrt(r());
    // Under the lobe: on its lower surface (0.8 of the way down at most).
    const down = 0.8 * Math.sqrt(Math.max(0, reach * reach - rad * rad));
    out.start.push(x + l.x + Math.cos(a) * rad, l.y - down, z + l.z + Math.sin(a) * rad);
    out.params.push(LEAF_PERIOD[0] + (LEAF_PERIOD[1] - LEAF_PERIOD[0]) * r(), r(), l.th, r());
    out.sway.push(l.k);
    out.foot.push(x, z);
    out.n++;
  });
}

/** The period of a leaf at a rate (dev page): the period divided by the rate, never below a leaf's whole life. */
export function leafPeriod(period: number, rate: number): number {
  return Math.max(period / Math.max(rate, 1e-6), LEAF_LIFE);
}

/**
 * Where a leaf is at time `t` seconds, and how opaque. It falls for LEAF_FALL seconds from `start`, carried by the wind (when `wind`) and fluttering
 * aside, lies LEAF_LIE seconds at y = 0.01, fades over LEAF_FADE seconds, then waits (alpha 0) for the next period. The lobe's own sway, which a
 * leaf follows while it is still attached, is not part of this path.
 */
export function leafAt(start: ArrayLike<number>, params: ArrayLike<number>, t: number, wind: boolean, rate = 1): { x: number; y: number; z: number; alpha: number } {
  const period = leafPeriod(params[0], rate), seed = params[3];
  const age = (((t + params[1] * period) % period) + period) % period;
  if (age >= LEAF_LIFE) return { x: start[0], y: start[1], z: start[2], alpha: 0 };
  const f = Math.min(age / LEAF_FALL, 1);
  const drift = wind ? LEAF_DRIFT * (0.6 + 0.8 * seed) * f : 0;
  const flutter = f >= 1 ? 0 : Math.sin(age * LEAF_FLUTTER_RATE + seed * Math.PI * 2) * LEAF_FLUTTER * Math.sin(Math.PI * f);
  const alpha = age < LEAF_FALL + LEAF_LIE ? 1 : 1 - (age - LEAF_FALL - LEAF_LIE) / LEAF_FADE;
  return {
    x: start[0] + WIND_DIR[0] * drift - WIND_DIR[1] * flutter,
    y: f >= 1 ? GROUND : start[1] + (GROUND - start[1]) * f,
    z: start[2] + WIND_DIR[1] * drift + WIND_DIR[0] * flutter,
    alpha,
  };
}

// Pure helpers of the ?woodland demo page (#203): the cloud buttons' value steps, the phone zoom, the walking step.
import type { HazeLook } from '../unseenfx';
import type { CloudLook } from './clouds';

export type CloudKey = keyof CloudLook;
/** Per button: the step, the range and the decimals shown. */
export const CLOUD_STEPS: Record<CloudKey, { step: number; min: number; max: number; digits: number }> = {
  size: { step: 60, min: 120, max: 960, digits: 0 },
  speed: { step: 4, min: 0, max: 60, digits: 0 },
  dark: { step: 0.04, min: 0, max: 0.8, digits: 2 },
  cover: { step: 0.05, min: 0, max: 1, digits: 2 },
};

/** `look[key]` moved one step up (dir 1) or down (dir -1), clamped to its range and rounded to its decimals. */
export function stepCloud(look: CloudLook, key: CloudKey, dir: 1 | -1): CloudLook {
  const s = CLOUD_STEPS[key];
  const v = Math.min(s.max, Math.max(s.min, look[key] + dir * s.step));
  return { ...look, [key]: Number(v.toFixed(s.digits === 0 ? 0 : s.digits)) };
}

/** The camera zoom that shows `tiles` tiles across a screen `width` px wide. */
export const zoomForTiles = (width: number, tiles: number, tile: number) => width / (tiles * tile);

/** The next seed of `count` demo seeds (1-based), wrapping to 1. */
export const nextSeed = (seed: number, count: number) => (seed % count) + 1;

/** One step of `speed * dt` px from (x, y) towards (tx, ty); `arrived` when the target is reached. */
export function stepToward(x: number, y: number, tx: number, ty: number, dist: number): { x: number; y: number; arrived: boolean } {
  const vx = tx - x, vy = ty - y, d = Math.hypot(vx, vy);
  if (d <= dist) return { x: tx, y: ty, arrived: true };
  return { x: x + (vx / d) * dist, y: y + (vy / d) * dist, arrived: false };
}

/** The zoom button: tiles across the screen's width, in steps of 4. */
export const TILES = { def: 32, step: 4, min: 16, max: 48 };
export const stepTiles = (n: number, dir: 1 | -1) => Math.min(TILES.max, Math.max(TILES.min, n + dir * TILES.step));

const round = (v: number, digits: number) => Number(v.toFixed(digits));

/** The sun's elevation knob (degrees), stepped by `step` within `min..max`. */
export const ELEV = { step: 5, min: 20, max: 85 };
export const stepElev = (n: number, dir: 1 | -1) => {
  const g = dir > 0 ? Math.floor(n / ELEV.step + 1) * ELEV.step : Math.ceil(n / ELEV.step - 1) * ELEV.step; // the next multiple of the step
  return Math.min(ELEV.max, Math.max(ELEV.min, g));
};

/** The shadow alpha knob's range. */
export const ALPHA = { step: 0.04, min: 0, max: 0.6 };

/** Per haze knob (`colour` has none): the step, the range and the decimals shown. */
export const HAZE_STEPS: Record<Exclude<keyof HazeLook, 'colour'>, { step: number; min: number; max: number; digits: number }> = {
  outside: { step: 0.1, min: 0, max: 1, digits: 1 },
  soft: { step: 0.1, min: 0, max: 1, digits: 1 },
  mix: { step: 0.05, min: 0, max: 1, digits: 2 },
  desat: { step: 0.1, min: 0, max: 1, digits: 1 },
  blurPx: { step: 0.5, min: 0, max: 4, digits: 1 },
  feather: { step: 8, min: 0, max: 64, digits: 0 },
};

/** `look[key]` moved one step, clamped to its range and rounded to its decimals. */
export function stepHaze(look: HazeLook, key: keyof typeof HAZE_STEPS, dir: 1 | -1): HazeLook {
  const s = HAZE_STEPS[key];
  return { ...look, [key]: round(Math.min(s.max, Math.max(s.min, look[key] + dir * s.step)), s.digits) };
}

/** The shadow layer's alpha knob: 0.04 steps within 0..0.6. */
export const stepAlpha = (a: number, dir: 1 | -1) => round(Math.min(ALPHA.max, Math.max(ALPHA.min, a + dir * ALPHA.step)), 2);

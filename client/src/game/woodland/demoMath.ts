// Pure helpers of the ?woodland demo page (#203): the cloud buttons' value steps, the phone zoom, the walking step.
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

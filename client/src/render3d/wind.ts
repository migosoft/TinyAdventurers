// One wind for the 3D woodland (#306): the plants' sway, the mist's drift and the clouds' drift share it. Pure.
import { MIST } from './mist';

const ANGLE = (20 * Math.PI) / 180;
/** The wind in tiles per second: `MIST.speed` turned 20 degrees. */
export const WIND: [number, number] = [MIST.speed * Math.cos(ANGLE), MIST.speed * Math.sin(ANGLE)];
/** `WIND` as a unit vector. */
export const WIND_DIR: [number, number] = [Math.cos(ANGLE), Math.sin(ANGLE)];

/** How far (tiles) the top of a plant swings at most, by family. */
export const SWAY = { leafy: 0.11, conifer: 0.07, small: 0.05 } as const;

/** The sway wave's terms: two slow sines and the gust (windNodes.ts uses the same numbers). */
export const SWAY_WAVE = { slow: 0.5, fast: 0.25, gust: 1.4 } as const;
/** The largest value the wave takes (each sine at 1, the gust at 1): the sway never exceeds this times the amplitude. */
export const SWAY_WAVE_MAX = SWAY_WAVE.slow + SWAY_WAVE.fast + SWAY_WAVE.gust;

/** The travelling gust (0..1) at (x, z) at time `t` seconds: a band of wind that moves across the map. */
export function gust(x: number, z: number, t: number): number {
  return Math.max(0, Math.sin(0.33 * (x + 0.3 * z) - 1.5 * t)) ** 6;
}

/** The sway (tiles, along `WIND_DIR`) of a point `y` up a plant of height `h` standing at (x, z), at time `t` seconds. */
export function sway(x: number, z: number, y: number, h: number, amp: number, t: number): number {
  if (amp <= 0 || h <= 0) return 0;
  const k = Math.min(Math.max(y / h, 0), 1) ** 2;
  return amp * k * (SWAY_WAVE.slow * Math.sin(1.3 * t + 0.9 * x + 0.4 * z) + SWAY_WAVE.fast * Math.sin(2.9 * t + z) + SWAY_WAVE.gust * gust(x, z, t));
}

// One wind for the 3D woodland (#306): the plants' sway, the mist's drift and the clouds' drift share it. Pure.
import type { PlantKind } from '../game/vegetation';
import { MIST } from './mist';

const ANGLE = (20 * Math.PI) / 180;
/** The wind in tiles per second: `MIST.speed` turned 20 degrees. */
export const WIND: [number, number] = [MIST.speed * Math.cos(ANGLE), MIST.speed * Math.sin(ANGLE)];
/** `WIND` as a unit vector. */
export const WIND_DIR: [number, number] = [Math.cos(ANGLE), Math.sin(ANGLE)];

/** How far (tiles) the top of a plant swings at most, by family. */
export const SWAY = { leafy: 0.11, conifer: 0.07, small: 0.05, bare: 0, coveTree: 0.11 } as const;

export function swayAmp(kind: PlantKind): number {
  switch (kind) {
    case 'round':
    case 'wide':
    case 'tall':
      return SWAY.leafy;
    case 'conifer':
      return SWAY.conifer;
    case 'bush':
      return SWAY.small;
    case 'bare':
      return SWAY.bare;
  }
}

/** The sway (tiles, along `WIND_DIR`) of a point `y` up a plant of height `h` standing at (x, z), at time `t` seconds. */
export function sway(x: number, z: number, y: number, h: number, amp: number, t: number): number {
  if (amp <= 0 || h <= 0) return 0;
  const k = Math.min(Math.max(y / h, 0), 1) ** 2;
  const gust = Math.max(0, Math.sin(0.33 * (x + 0.3 * z) - 1.5 * t)) ** 6;
  return amp * k * (0.5 * Math.sin(1.3 * t + 0.9 * x + 0.4 * z) + 0.25 * Math.sin(2.9 * t + z) + 1.4 * gust);
}

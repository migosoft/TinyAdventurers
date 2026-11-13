// The daylight mist's maths on the CPU (#305): the reference the shader in sightNodes.ts mirrors, and what its tests pin.
import { DEFAULT_HAZE, type HazeLook } from '../game/sightField';

/** The mist's look. Heights in tiles above the ground, `top` and `drift` shares, `speed` in tiles per second. First guesses. */
export interface MistLook { low: number; high: number; top: number; drift: number; speed: number }
export const MIST: MistLook = { low: 0.5, high: 3, top: 0.4, drift: 0.25, speed: 0.2 };

/** The mist colour at night (the #300 demo's value). */
export const NIGHT_MIST: [number, number, number] = [0.1, 0.12, 0.17];

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 1 up to `low`, smoothly down to `top` at `high` and above: 1 - (1 - top) * smoothstep(low, high, y). */
export function mistHeight(y: number, m: MistLook): number {
  return 1 - (1 - m.top) * smoothstep(m.low, m.high, y);
}

/** u * mistHeight(y) * (1 - drift * n), n the drift noise in 0..1. */
export function mistAmount(u: number, y: number, n: number, m: MistLook): number {
  return u * mistHeight(y, m) * (1 - m.drift * n);
}

/** The unseen strength on a daylight map: max(outside * hard, soft * softShare). */
export function unseenDay(hard: number, soft: number, look: HazeLook): number {
  return Math.max(look.outside * hard, look.soft * soft);
}

/** The day mist colour (the haze colour as rgb 0..1) blended toward NIGHT_MIST as `day` goes from 1 to 0. */
export function mistColour(day: number, look: HazeLook = DEFAULT_HAZE): [number, number, number] {
  const c = [(look.colour >> 16) & 255, (look.colour >> 8) & 255, look.colour & 255].map((v) => v / 255);
  return [0, 1, 2].map((i) => NIGHT_MIST[i] + (c[i] - NIGHT_MIST[i]) * day) as [number, number, number];
}

/** How much of a card is drawn: 1 - hard, except scenery on a daylight map, which is always 1. */
export function cardShown(hard: number, scenery: boolean, daylight: boolean): number {
  return scenery && daylight ? 1 : 1 - hard;
}

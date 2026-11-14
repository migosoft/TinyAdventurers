// Helpers for the air tests: a seeded rng, a floor map, a footprint, a sight mask and a default frame input.
import { TILE_ID } from '../../generated/defs';
import { TILE, TileMap } from '../../sim/map';
import { View } from '../../sim/view';
import type { Light } from '../light';
import { SightMask, type SightLook } from '../sightmask';
import type { AirInput } from './air';

/** mulberry32: a seeded rng. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const floorMap = (w = 40, h = 40): TileMap => new TileMap(w, h, new Uint8Array(w * h).fill(TILE_ID.Floor));

/** A mask whose viewer stands at tile (vx, vz) with vision `r`: tiles farther away are hidden. */
export function maskAt(map: TileMap, vx: number, vz: number, r: number): SightMask {
  const look: SightLook = { daylight: false, feather: 0, ramp: 0 };
  const m = new SightMask(map, look);
  const hard = new View(map.w, map.h);
  hard.compute(map, (vx + 0.5) * TILE, (vz + 0.5) * TILE, r, 'hard');
  m.update(hard, null, 0);
  return m;
}

/** One light bright enough that every tile of the 30 x 30 footprint is lit (brightness 1). */
export const flood = (): Light => ({ x: 20, y: 1, z: 20, radius: 60, r: 3, g: 3, b: 3, shadow: false, skip: -1 });

export const ALL_ON = { dust: true, smoke: true, embers: true, drips: true, stir: true, draft: true };

/** A frame's input: the 30 x 30 footprint (5..35), 0.05 s, everything on, no lights. */
export function frame(over: Partial<AirInput> = {}): AirInput {
  return {
    dt: 0.05, t: 0, fp: { x0: 5, z0: 5, x1: 35, z1: 35 }, mask: null, torches: [], shots: [], movers: [], lights: [], cracks: [],
    on: { ...ALL_ON }, respawn: 0, drift: null, kinds: 'dungeon', ...over,
  };
}

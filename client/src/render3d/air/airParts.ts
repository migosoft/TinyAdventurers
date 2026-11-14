// What the air simulation hands the renderer each frame (#307): reused arrays, `count` entries used. Pure data, no GPU.
import { MAX_CLOUDS, MAX_DRIPS, MAX_EMBERS, MAX_SMOKE } from '../../game/moodmath';

/** Motes per dust cloud. */
export const CLOUD_MOTES = 7;
/** Most specks at once. */
export const MAX_SPECKS = MAX_CLOUDS * CLOUD_MOTES;
/** Most drop entries (a falling drop or the two splash pixels of a drip, never both at once) and rings (two per drip). */
export const MAX_DROPS = MAX_DRIPS * 2;
export const MAX_RINGS = MAX_DRIPS * 2;

export interface AirParts {
  /** Dust and pollen: lit by the scene minus ambient. `alpha` is DUST_ALPHA * fade * twinkle (the light's share is the shader's). */
  specks: { count: number; pos: Float32Array /* xyz */; alpha: Float32Array };
  /** Own colour, additive. `size` is the diameter in tiles. */
  embers: { count: number; pos: Float32Array; size: Float32Array; rgba: Float32Array };
  /** Smoke: lit. `size` is the diameter in tiles; `sight` the xz where the sight mask is read. */
  puffs: { count: number; pos: Float32Array; size: Float32Array; rgba: Float32Array; sight: Float32Array };
  /** Drops and splash pixels, lit. `size` is the width in tiles; a falling drop is `DROP_ASPECT` times as tall (a splash pixel is square: see `splash`). */
  drops: { count: number; pos: Float32Array; size: Float32Array; alpha: Float32Array; splash: Uint8Array };
  /** Rings flat on the water; `radius` in tiles. */
  rings: { count: number; pos: Float32Array; radius: Float32Array; alpha: Float32Array };
}

/** A drop is 1 x 2 art pixels. */
export const DROP_ASPECT = 2;

export function newParts(): AirParts {
  return {
    specks: { count: 0, pos: new Float32Array(MAX_SPECKS * 3), alpha: new Float32Array(MAX_SPECKS) },
    embers: { count: 0, pos: new Float32Array(MAX_EMBERS * 3), size: new Float32Array(MAX_EMBERS), rgba: new Float32Array(MAX_EMBERS * 4) },
    puffs: { count: 0, pos: new Float32Array(MAX_SMOKE * 3), size: new Float32Array(MAX_SMOKE), rgba: new Float32Array(MAX_SMOKE * 4), sight: new Float32Array(MAX_SMOKE * 2) },
    drops: { count: 0, pos: new Float32Array(MAX_DROPS * 3), size: new Float32Array(MAX_DROPS), alpha: new Float32Array(MAX_DROPS), splash: new Uint8Array(MAX_DROPS) },
    rings: { count: 0, pos: new Float32Array(MAX_RINGS * 3), radius: new Float32Array(MAX_RINGS), alpha: new Float32Array(MAX_RINGS) },
  };
}

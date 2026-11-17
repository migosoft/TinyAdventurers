// The terrain tile ids the client reads and how deep a figure stands below the surface on them.
import { TILE_ID } from '../generated/defs';

/** Terrain tile ids (from the server's `Tile`). */
export const TERRAIN = { Shallow: TILE_ID.ShallowWater, Deep: TILE_ID.DeepWater, Chasm: TILE_ID.Chasm, Lava: TILE_ID.Lava } as const;

/** Pixels a figure stands below the surface on this tile (wading). */
export function sinkDepth(t: number): number {
  return t === TERRAIN.Shallow ? 3 : t === TERRAIN.Lava ? 2 : 0;
}

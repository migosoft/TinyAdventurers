// Terrain frame layout shared by the atlas build (scripts/terrain-tiles.ts)
// and the board (terrain.ts).

export const TERRAIN_FRAMES = { water: 4, deep: 4, lava: 6, chasm: 1 } as const;
/** Base texture period in tiles: piece `q = x % p + p * (y % p)`. */
export const TERRAIN_PERIOD = { water: 2, deep: 4, lava: 4, chasm: 2 } as const;
export type TerrainSet = keyof typeof TERRAIN_FRAMES;
export const TERRAIN_EDGES = ['shore', 'deep', 'lava', 'chasm'] as const;
export type TerrainEdge = (typeof TERRAIN_EDGES)[number];

/**
 * A quarter's case from its three neighbours (vertical, horizontal, diagonal),
 * true where the neighbour belongs to the same terrain group:
 * 0 inside, 1 inner corner, 2 top/bottom edge, 3 side edge, 4 outer corner.
 */
export function edgeCase(v: boolean, h: boolean, d: boolean): number {
  if (v && h) return d ? 0 : 1;
  if (h) return 2;
  if (v) return 3;
  return 4;
}

/** The quarter cases of a cell, from its 8 neighbours (N, NE, E, SE, S, SW, W, NW). */
export function edgeCode(n: boolean[]): string {
  const [N, NE, E, SE, S, SW, W, NW] = n;
  return [edgeCase(N, W, NW), edgeCase(N, E, NE), edgeCase(S, W, SW), edgeCase(S, E, SE)].join('');
}

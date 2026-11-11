// The Phaser-free part of the terrain: tile ids, speed and sink values, and
// which base textures and edge overlays a cell needs. terrain.ts draws them.
import { edgeCode, type TerrainEdge, type TerrainSet } from './terrain-codes';
import { CONST, TILE_ID } from '../generated/defs';
import type { TileMap } from '../sim/map';

/** Terrain tile ids (from the server's `Tile`). */
export const TERRAIN = { Shallow: TILE_ID.ShallowWater, Deep: TILE_ID.DeepWater, Chasm: TILE_ID.Chasm, Lava: TILE_ID.Lava } as const;

/** Movement speed factor on a terrain tile (demons are not slowed by lava). Same values as `TileMap.speedFactor`. */
export function speedFactor(t: number, demon = false): number {
  if (t === TERRAIN.Shallow) return CONST.SHALLOW_SPEED;
  if (t === TERRAIN.Lava) return demon ? 1 : CONST.LAVA_SPEED;
  return 1;
}

/** Pixels a figure stands below the surface on this tile (wading). */
export function sinkDepth(t: number): number {
  return t === TERRAIN.Shallow ? 3 : t === TERRAIN.Lava ? 2 : 0;
}

export const isWater = (t: number) => t === TERRAIN.Shallow || t === TERRAIN.Deep;

export const TERRAIN_FPS: Record<TerrainSet, number> = { water: 4, deep: 4, lava: 5, chasm: 1 };
export const D8: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Base textures and edge overlays to draw for one cell, bottom to top. */
export function terrainLayers(m: TileMap, x: number, y: number): { base: TerrainSet[]; edges: string[] } {
  const t = m.get(x, y);
  const code = (same: (u: number) => boolean) => edgeCode(D8.map(([dx, dy]) => same(m.get(x + dx, y + dy))));
  const edge = (e: TerrainEdge, c: string) => (c === '0000' ? [] : [`terrain_${e}_e${c}`]);
  if (t === TERRAIN.Shallow) return { base: ['water'], edges: edge('shore', code(isWater)) };
  if (t === TERRAIN.Deep) return { base: ['water', 'deep'], edges: [...edge('deep', code((u) => u === TERRAIN.Deep)), ...edge('shore', code(isWater))] };
  if (t === TERRAIN.Lava) return { base: ['lava'], edges: edge('lava', code((u) => u === TERRAIN.Lava)) };
  if (t === TERRAIN.Chasm) return { base: ['chasm'], edges: edge('chasm', code((u) => u === TERRAIN.Chasm)) };
  return { base: [], edges: [] };
}

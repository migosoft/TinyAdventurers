import { TILE_ID } from '../generated/defs';
import type { TileMap } from '../sim/map';

/** Height of a wall block in world units. */
export const WALL_H = 2;

/** Height of one tile: Wall and Void rise to WALL_H, every other tile is flat. */
export function cellHeight(tile: number): number {
  return tile === TILE_ID.Wall || tile === TILE_ID.Void ? WALL_H : 0;
}

/** Tile height at a cell; everything outside the map counts as wall (TileMap.get gives Void there). */
export function heightAt(map: TileMap, x: number, z: number): number {
  return cellHeight(map.get(x, z));
}

/** round(height * 100) per tile, row by row; the shader reads r * 2.55. */
export function heightBytes(map: TileMap): Uint8Array {
  const out = new Uint8Array(map.w * map.h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(cellHeight(map.tiles[i]) * 100);
  return out;
}

/** The wall a light hangs on: the point on the wall cell's edge and the normal into the room. wall 0: the tile's centre, normal 0. */
export function wallOf(l: { x: number; y: number; wall: number }): { x: number; z: number; nx: number; nz: number } {
  if (l.wall === 1) return { x: l.x + 0.5, z: l.y, nx: 0, nz: 1 };
  if (l.wall === 2) return { x: l.x, z: l.y + 0.5, nx: 1, nz: 0 };
  if (l.wall === 3) return { x: l.x + 1, z: l.y + 0.5, nx: -1, nz: 0 };
  return { x: l.x + 0.5, z: l.y + 0.5, nx: 0, nz: 0 };
}

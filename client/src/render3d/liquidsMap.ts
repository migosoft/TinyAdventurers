// The room of the ?r3d=liquids page (#324): 18 x 12, floor x 1..16, y 1..10.
// A water pool in the west (shallow x 2..7, y 5..9; the deep centre x 4..5, y 5..7 touches the floor row above it, where the
// water imp stands), a chasm two cells wide in the middle (x 10..11, y 5..9; rows 1..4 and 10 stay floor, the way round it) and a
// lava pool against the east wall (x 14..16, y 3..6).
import { TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { TERRAIN } from '../game/terrain-layers';

export const LIQUIDS_W = 18;
export const LIQUIDS_H = 12;

/** The wall torches in tiles: the flame's tile and its wall side (`extra` of a torch: 0 north, 1 west, 2 east). */
export const LIQUIDS_TORCHES: readonly { tx: number; ty: number; side: number }[] = [
  { tx: 3, ty: 1, side: 0 }, { tx: 8, ty: 1, side: 0 }, { tx: 12, ty: 1, side: 0 }, { tx: 1, ty: 8, side: 1 }, { tx: 16, ty: 9, side: 2 },
];

function fill(tiles: Uint8Array, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * LIQUIDS_W + x] = id;
}

export function liquidsMap(): TileMap {
  const tiles = new Uint8Array(LIQUIDS_W * LIQUIDS_H).fill(TILE_ID.Wall);
  fill(tiles, 1, 1, 16, 10, TILE_ID.Floor);
  fill(tiles, 2, 5, 7, 9, TERRAIN.Shallow);
  fill(tiles, 4, 5, 5, 7, TERRAIN.Deep);
  fill(tiles, 10, 5, 11, 9, TERRAIN.Chasm);
  fill(tiles, 14, 3, 16, 6, TERRAIN.Lava);
  return new TileMap(LIQUIDS_W, LIQUIDS_H, tiles);
}

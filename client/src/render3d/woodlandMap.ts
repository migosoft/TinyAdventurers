// The map and the plants of the ?r3d=woodland stage (#306). Tile coordinates, x east, z south; the camera looks north at yaw 0.
//
//   z 0        Void (beyond the map's edge)
//   z 1..2     the forest edge: Thicket, with a bush on some tiles
//   z 3        Trunk tiles with a tree on each, Floor between them
//   z 4..13    grass
//   z 14..15   the road across the map
//   z 16..24   grass
//   z 25       Void
import { TILE_ID } from '../generated/defs';
import type { PlantInfo } from '../generated/PlantInfo';
import { PLANT_KINDS, type PlantKind } from '../game/vegetation';
import { TileMap } from '../sim/map';

export const WOODLAND_W = 40;
export const WOODLAND_H = 26;
/** The road's two rows. */
export const ROAD_ROWS = [14, 15] as const;
/** Where the knight starts, in tiles (the middle of a grass tile). */
export const KNIGHT_START = { x: 20.5, z: 11.5 } as const;

const TILE = 16;
/** The tree row, and the trunk tiles' x. */
const TREE_Z = 3;
const TREES: [PlantKind, number, boolean][] = [
  ['round', 4, false], ['wide', 10, false], ['tall', 16, true], ['conifer', 22, false], ['bare', 28, false], ['round', 34, true],
];
/** The bushes on the thicket tiles: [x, z]. */
const BUSHES: [number, number][] = [[7, 2], [13, 1], [19, 2], [25, 1], [31, 2], [37, 1]];

export function woodlandStageMap(): TileMap {
  const tiles = new Uint8Array(WOODLAND_W * WOODLAND_H).fill(TILE_ID.Floor);
  const row = (z: number, tile: number): void => {
    tiles.fill(tile, z * WOODLAND_W, (z + 1) * WOODLAND_W);
  };
  row(0, TILE_ID.Void);
  row(1, TILE_ID.Thicket);
  row(2, TILE_ID.Thicket);
  for (const [, x] of TREES) tiles[TREE_Z * WOODLAND_W + x] = TILE_ID.Trunk;
  for (const z of ROAD_ROWS) row(z, TILE_ID.Road);
  row(WOODLAND_H - 1, TILE_ID.Void);
  return new TileMap(WOODLAND_W, WOODLAND_H, tiles);
}

/** Every plant kind, the feet near the bottom of their tile (px): trees on the Trunk tiles, bushes on the Thicket tiles. */
export const WOODLAND_STAGE_PLANTS: PlantInfo[] = [
  ...TREES.map(([kind, x, mirrored], i): PlantInfo => [PLANT_KINDS.indexOf(kind), x * TILE + TILE / 2, TREE_Z * TILE + 12, 101 + i, 100, mirrored]),
  ...BUSHES.map(([x, z], i): PlantInfo => [PLANT_KINDS.indexOf('bush'), x * TILE + TILE / 2, z * TILE + 12, 201 + i, 100, i % 2 === 1]),
];

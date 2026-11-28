// The map and the plants of the ?r3d=woodland stage (#306). Tile coordinates, x east, z south; the camera looks north at yaw 0.
//
//   z 0        Void (beyond the map's edge)
//   z 1..2     the forest edge: Thicket, with a bush on some tiles
//   z 3        Trunk tiles with a tree on each, Floor between them
//   z 4..13    grass; the shape row at z 10 (round, wide and tall trees at three seeds each)
//   z 14..15   the road across the map
//   z 16..24   grass; the willow at z 19 (x 36), the leaf row at z 22 (one tree at five leaf amounts) and the dead tree at z 22 (x 29)
//   z 25       Void
import { TILE_ID } from '../generated/defs';
import type { PlantInfo } from '../generated/PlantInfo';
import { PLANT_KINDS, type PlantKind } from './trees/kinds';
import { TileMap } from '../sim/map';
import type { TreeSpec } from './trees/spec';

export const WOODLAND_W = 40;
export const WOODLAND_H = 26;
/** The road's two rows. */
export const ROAD_ROWS = [14, 15] as const;
/** Where the knight starts, in tiles (the middle of a grass tile). */
export const KNIGHT_START = { x: 20.5, z: 11.5 } as const;

const TILE = 16;
/** The tree row, and the trunk tiles' x. */
const TREE_Z = 3;
const TREES: [PlantKind, number, boolean, boolean][] = [
  ['round', 4, false, false], ['wide', 10, false, false], ['tall', 16, true, false], ['conifer', 22, false, false], ['round', 28, false, true], ['round', 34, true, false],
];
/** The bushes on the thicket tiles: [x, z]. */
const BUSHES: [number, number][] = [[7, 2], [13, 1], [19, 2], [25, 1], [31, 2], [37, 1]];

/**
 * The line-ups (tiles). Trees are about 5 tiles tall on the screen, so the rows keep that far apart: five round trees of one seed with leaf 0, 25, 50, 75
 * and 100, the dead tree and the willow south of the road (a row at the map's last row would hide its trunks behind the Void wall); round, wide and tall trees at three seeds each north of the road.
 */
export const LEAF_ROW = { z: 22, xs: [3, 8, 13, 18, 23], seed: 301, leaf: [0, 25, 50, 75, 100] } as const;
export const SHAPE_ROW = { z: 10, xs: [4, 8, 12, 17, 22, 27, 32, 35, 38], seeds: [311, 312, 313] } as const;
export const DEAD_TREE = { x: 29, z: 22, seed: 331 } as const;
export const WILLOW = { x: 36, z: 19, seed: 341 } as const;

/** The brush lane (#331, `?r3d=woodland&brush=1`): a bush on the grass row `z` with a small round tree beside it; the knight paces east and west through the bush, 3 tiles each way, one round per `period` seconds. */
export const BRUSH_LANE = { z: 6, bush: { x: 20.5, z: 6.5, seed: 351 }, tree: { tx: 22, tz: 5, seed: 352 }, reach: 3, period: 6 } as const;

/** The knight on the brush lane at time `t` (s): on the lane's row, facing the way it goes (0 east, PI west). */
export function brushWalk(t: number): { x: number; z: number; aim: number } {
  const a = (2 * Math.PI * t) / BRUSH_LANE.period;
  return { x: BRUSH_LANE.bush.x + BRUSH_LANE.reach * Math.sin(a), z: BRUSH_LANE.z + 0.5, aim: Math.cos(a) >= 0 ? 0 : Math.PI };
}

/** `brush`: with the brush lane's tree (`BRUSH_LANE_PLANTS`). */
export function woodlandStageMap(brush = false): TileMap {
  const tiles = new Uint8Array(WOODLAND_W * WOODLAND_H).fill(TILE_ID.Floor);
  const row = (z: number, tile: number): void => {
    tiles.fill(tile, z * WOODLAND_W, (z + 1) * WOODLAND_W);
  };
  row(0, TILE_ID.Void);
  row(1, TILE_ID.Thicket);
  row(2, TILE_ID.Thicket);
  for (const [, x] of TREES) tiles[TREE_Z * WOODLAND_W + x] = TILE_ID.Trunk;
  for (const x of LEAF_ROW.xs) tiles[LEAF_ROW.z * WOODLAND_W + x] = TILE_ID.Trunk;
  for (const x of SHAPE_ROW.xs) tiles[SHAPE_ROW.z * WOODLAND_W + x] = TILE_ID.Trunk;
  tiles[DEAD_TREE.z * WOODLAND_W + DEAD_TREE.x] = TILE_ID.Trunk;
  tiles[WILLOW.z * WOODLAND_W + WILLOW.x] = TILE_ID.Trunk;
  if (brush) tiles[BRUSH_LANE.tree.tz * WOODLAND_W + BRUSH_LANE.tree.tx] = TILE_ID.Trunk;
  for (const z of ROAD_ROWS) row(z, TILE_ID.Road);
  row(WOODLAND_H - 1, TILE_ID.Void);
  return new TileMap(WOODLAND_W, WOODLAND_H, tiles);
}

/** Every plant kind (the willow too) and a dead tree, the feet near the bottom of their tile (px): trees on the Trunk tiles, bushes on the Thicket tiles. */
export const WOODLAND_STAGE_PLANTS: PlantInfo[] = [
  ...TREES.map(([kind, x, mirrored, dead], i): PlantInfo => [PLANT_KINDS.indexOf(kind), x * TILE + TILE / 2, TREE_Z * TILE + 12, 101 + i, 100, mirrored, dead ? 0 : 100, dead]),
  ...BUSHES.map(([x, z], i): PlantInfo => [PLANT_KINDS.indexOf('bush'), x * TILE + TILE / 2, z * TILE + 12, 201 + i, 100, i % 2 === 1, 100, false]),
  // The leaf row: the same tree at five leaf amounts.
  ...LEAF_ROW.xs.map((x, i): PlantInfo => [PLANT_KINDS.indexOf('round'), x * TILE + TILE / 2, LEAF_ROW.z * TILE + 12, LEAF_ROW.seed, 100, false, LEAF_ROW.leaf[i], false]),
  // The shape row: round, wide and tall at three seeds each.
  ...SHAPE_ROW.xs.map((x, i): PlantInfo => [PLANT_KINDS.indexOf((['round', 'wide', 'tall'] as const)[Math.floor(i / 3)]), x * TILE + TILE / 2, SHAPE_ROW.z * TILE + 12, SHAPE_ROW.seeds[i % 3], 100, false, 100, false]),
  [PLANT_KINDS.indexOf('tall'), DEAD_TREE.x * TILE + TILE / 2, DEAD_TREE.z * TILE + 12, DEAD_TREE.seed, 100, false, 0, true],
  [PLANT_KINDS.indexOf('willow'), WILLOW.x * TILE + TILE / 2, WILLOW.z * TILE + 12, WILLOW.seed, 100, false, 100, false],
];

/** The brush lane's bush on a grass tile and a small round tree beside it (a tree's low crown is part of its build); only with `brush=1`. */
export const BRUSH_LANE_PLANTS: TreeSpec[] = [
  { form: 'bush', x: BRUSH_LANE.bush.x, z: BRUSH_LANE.bush.z, seed: BRUSH_LANE.bush.seed, scalePct: 100, mirrored: false, leaf: 1, dead: false },
  { form: 'round', x: BRUSH_LANE.tree.tx + 0.5, z: BRUSH_LANE.tree.tz + 12 / TILE, seed: BRUSH_LANE.tree.seed, scalePct: 60, mirrored: false, leaf: 1, dead: false },
];

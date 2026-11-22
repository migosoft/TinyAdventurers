// The map of the ?r3d=stone page (#380): two caves, a passage where rock turns into masonry, a laid hall and two laid rooms.
import { TILE_ID } from '../../generated/defs';
import { TERRAIN } from '../../game/terrain-layers';
import { TileMap } from '../../sim/map';
import { LAID, ROCK } from './field';

/** '#' wall, '.' floor, 'D' door, '~' deep water, ':' chasm. */
export const STONE_ROWS: string[] = [
  '######################################################################',
  '######################################################################',
  '####....##......######################################################',
  '###..............#############.....................##...............##',
  '##................############.....................##...............##',
  '##................############.....................##...............##',
  '##...........##...############.....................##...............##',
  '##................############.....................##...............##',
  '##.................................................##...............##',
  '##...##.............................................................##',
  '##...#.............................................##...............##',
  '##................############......:::::::::......##...............##',
  '##...~~~~.#.......############......:::::::::......##...............##',
  '##...~~~~.##......############.....................##...............##',
  '##...~~~~.........############.....................##...............##',
  '###..............#############.....................##...............##',
  '####........#...####################D#################################',
  '#########.####################.............###########################',
  '#########D####################.............###########################',
  '#########.####################.............###########################',
  '####.............#############.............###########################',
  '##................############.............###########################',
  '##............#...############.............###########################',
  '##............#...############.............###########################',
  '##................############.............###########################',
  '##....##..........############.............###########################',
  '##.....#..........############.............###########################',
  '##................############.............###########################',
  '###.....##......######################################################',
  '######################################################################',
];

/** Columns left of this are rock, the rest laid: the border falls inside the passage (x 18..29, three rows wide as the game's corridors are). */
export const BORDER_X = 24;

const TILES: Record<string, number> = { '.': TILE_ID.Floor, D: TILE_ID.DoorClosed, '~': TERRAIN.Deep, ':': TERRAIN.Chasm };

export function stoneMap(): TileMap {
  const w = STONE_ROWS[0].length;
  const tiles = new Uint8Array(w * STONE_ROWS.length);
  STONE_ROWS.forEach((row, z) => { for (let x = 0; x < w; x++) tiles[z * w + x] = TILES[row[x]] ?? TILE_ID.Wall; });
  return new TileMap(w, STONE_ROWS.length, tiles);
}

/** The map's own kinds: rock west of `BORDER_X`. */
export function zoneKinds(map: TileMap): Uint8Array {
  return Uint8Array.from({ length: map.w * map.h }, (_, i) => (i % map.w < BORDER_X ? ROCK : LAID));
}

/** The page's seed: with it the placement lays a summoning circle in the circle room, and a mosaic and a grate (54.5, 15.5) in the mosaic room. */
export const STONE_SEED = 537;
/** The heroes' start the marks keep clear, whatever `&at=` says (so the marks do not move with it). */
export const STONE_SPAWN = { x: 10.5, z: 7.5 };

/** The places `&at=` names (tile centres): the knight starts there and the camera looks at it. Circle and mosaic are where the seed laid them. */
export const PLACES = {
  cave: [10.5, 7.5], border: [24.5, 9.5], hall: [40.5, 7.5], circle: [37.5, 22.5], mosaic: [60.5, 9.5], cave2: [10.5, 24.5], door: [9.5, 16.5],
} as const;

/** Lamp tiles: torches under a north wall of the laid rooms, crystals in the caves: on the floor, and the first at a wall's foot (its niche). */
export const TORCH_TILES: [number, number][] = [[33, 3], [40, 3], [47, 3], [56, 3], [64, 3], [33, 17], [39, 17]];
export const CRYSTAL_TILES: [number, number][] = [[8, 3], [14, 3], [15, 12], [5, 21], [13, 26]];

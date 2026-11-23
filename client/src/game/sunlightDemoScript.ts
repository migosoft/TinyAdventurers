// The map and the fixtures of the sunlight demo (#156), which the 3D stage (?r3d=sunlight) plays.
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';

export const SUNLIGHT_W = 15;
export const SUNLIGHT_H = 17;
export const SUNLIGHT_WARM = 0xffaa5a;
/** The Daylight light's tile. */
export const SUN = { x: 5, y: 9 };
/** The second crack: 3 to 4 tiles from the first, on open floor. */
export const SECOND = { x: 3, y: 12 };
/** Where the viewer stands (px): the whole scene is seen. */
export const SUNLIGHT_VIEWER = { x: 7.5 * TILE, y: 8.5 * TILE };

// The values the demo's buttons cycle through.
export const HEIGHTS = [4, 5, 6, 7];
export const OFTEN: [number, number][] = [[8, 25], [2, 4]];

export function sunlightMap(): TileMap {
  const W = SUNLIGHT_W;
  const tiles = new Uint8Array(W * SUNLIGHT_H).fill(TILE_ID.Wall);
  for (let y = 2; y <= 14; y++) for (let x = 1; x <= 9; x++) tiles[y * W + x] = TILE_ID.Floor;
  // An open alcove on the east side. No wall stubs and the pillar stands in a corner, so the viewer's
  // line of sight casts no black wedge over the floor (it would read as a daylight shadow).
  for (let y = 6; y <= 10; y++) for (let x = 10; x <= 13; x++) tiles[y * W + x] = TILE_ID.Floor;
  tiles[13 * W + 9] = TILE_ID.Wall; // a pillar by the south-east corner
  return new TileMap(W, SUNLIGHT_H, tiles);
}

/** The two knights: one in the patch, one beside it (tiles, feet). */
export const SUNLIGHT_KNIGHTS: readonly { frame: string; x: number; y: number; flip: boolean }[] = [
  { frame: 'knight_m_idle_anim_f0', x: 5.5, y: 9.9, flip: false },
  { frame: 'knight_m_idle_anim_f0', x: 7.4, y: 10.3, flip: true },
];

/** Props (tiles, feet). */
export const SUNLIGHT_PROPS: readonly { frame: string; x: number; y: number; flip: boolean }[] = [
  { frame: 'crate', x: 8.5, y: 4.8, flip: false },
  { frame: 'skull', x: 2.5, y: 13.6, flip: false },
];

/** The torches: the sunlit room's is out, the alcove's is lit. `light` is the torch's light and its tile (an out torch's light is off). */
export const SUNLIGHT_TORCHES: readonly { x: number; y: number; side: number; lit: boolean; light: { id: number; x: number; y: number } }[] = [
  { x: 1 * TILE + 0.5, y: 9.5 * TILE, side: 1, lit: false, light: { id: 4, x: 1, y: 9 } },
  { x: 14 * TILE - 0.5, y: 8.5 * TILE, side: 2, lit: true, light: { id: 2, x: 13, y: 8 } },
];

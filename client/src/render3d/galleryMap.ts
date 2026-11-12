// The map and the spots of the ?r3d=gallery stage (#303). Tile coordinates, x east, z south; the camera looks north at yaw 0.
//
//   z 0        wall
//   z 1..3     the corridor (3 tiles wide), x 2..47
//   z 4..5     the full-height wall in front of the corridor (torches hang on its south face at z 6)
//   z 6..10    world objects (feet z 8) and the projectiles (feet z 9.5)
//   z 12..     one cell per figure kind, 8 to a row, 3 x 3 tiles each
//   below      the effect groups: 4 cells each, 5 groups to a row (the wading group stands on shallow water)
import { TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';

export const GALLERY_W = 50;
export const CORRIDOR = { x0: 2, x1: 47, z0: 1, z1: 3 } as const;
export const OBJECT_Z = 8;
export const SHOT_Z = 9.5;
export const TORCH_Z = 6;

/** Figure cells per row, and the tile size of a cell of the effect groups. */
export const PER_ROW = 8;
/** A figure kind's cell is 3 x 3 tiles (the brief's 2 x 2 left the dragon on top of its neighbours). */
export const FIG_PITCH = 3;
export const CELL = 2;
/** The effect groups: cells in a group, groups per row, a group's pitch (tiles) and a group row's pitch. */
export const GROUP_CELLS = 4;
export const GROUPS_PER_ROW = 5;
export const GROUP_PITCH = 9;
export const GROUP_ROW_PITCH = 3;
export const EFFECT_GROUPS = 10;

export interface Layout {
  map: TileMap;
  /** Foot of figure cell `i`, in tiles. */
  figure(i: number): { x: number; z: number };
  /** Foot of cell `k` (0..3) of effect group `g` (0..9), in tiles. */
  effect(g: number, k: number): { x: number; z: number };
  /** Where the camera starts for `&focus=`. */
  focus: Record<'figures' | 'corridor' | 'effects' | 'objects', { x: number; z: number }>;
}

export function layoutOf(nFigures: number): Layout {
  const rows = Math.ceil(nFigures / PER_ROW);
  const figTop = 12;
  const effTop = figTop + rows * FIG_PITCH + 1;
  const groupRows = Math.ceil(EFFECT_GROUPS / GROUPS_PER_ROW);
  const h = effTop + groupRows * GROUP_ROW_PITCH + 3;
  const tiles = new Uint8Array(GALLERY_W * h).fill(TILE_ID.Wall);
  const floor = (x0: number, x1: number, z0: number, z1: number, t: number = TILE_ID.Floor): void => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) tiles[z * GALLERY_W + x] = t;
  };
  floor(CORRIDOR.x0, CORRIDOR.x1, CORRIDOR.z0, CORRIDOR.z1);
  floor(1, GALLERY_W - 2, 6, h - 2);
  const effect = (g: number, k: number): { x: number; z: number } => ({
    x: 2 + (g % GROUPS_PER_ROW) * GROUP_PITCH + k * CELL + 1,
    z: effTop + Math.floor(g / GROUPS_PER_ROW) * GROUP_ROW_PITCH + 1.5,
  });
  // Group 8 wades: shallow water under its four cells.
  const w = effect(8, 0);
  floor(Math.floor(w.x) - 1, Math.floor(w.x) - 1 + GROUP_CELLS * CELL - 1, Math.floor(w.z) - 1, Math.floor(w.z), TILE_ID.ShallowWater);
  return {
    map: new TileMap(GALLERY_W, h, tiles),
    figure: (i) => ({ x: 2 + (i % PER_ROW) * FIG_PITCH + 1.5, z: figTop + Math.floor(i / PER_ROW) * FIG_PITCH + 2 }),
    effect,
    focus: {
      figures: { x: 2 + (PER_ROW * FIG_PITCH) / 2, z: figTop + (rows * FIG_PITCH) / 2 },
      corridor: { x: 18, z: 3.5 },
      effects: { x: 24, z: effTop + 2 },
      objects: { x: 18, z: 8 },
    },
  };
}

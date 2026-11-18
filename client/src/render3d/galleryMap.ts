// The map and the spots of the ?r3d=gallery stage (#303). Tile coordinates, x east, z south; the camera looks north at yaw 0.
//
//   z 0        wall
//   z 1..3     the corridor (3 tiles wide), x 2..47
//   z 4..5     the full-height wall in front of the corridor (torches hang on its south face at z 6)
//   z 6..10    world objects (feet z 8) and the projectiles (feet z 9.5)
//   z 12..     one cell per figure kind, 8 to a row, 3 x 3 tiles each
//   below      the effect groups: 4 cells each, 5 groups to a row (the wading group stands on shallow water)
//   below      the model block (#338): the kinds, the effect rows, the dying row and the crowd (see MODEL_PITCH)
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

/**
 * The model block (#338), below the effect groups: a row of model kinds (pitch 3), two pillars with a torch each (so torch light and
 * torch shadows fall on figures), `MODEL_EFFECT_ROWS` rows of `MODEL_EFFECT_COLS` figures under one effect each, a row of figures that
 * die in turn, and the crowd's grid (2 tiles) of `CROWD_PER_ROW` x `CROWD_ROWS` places.
 */
export const MODEL_PITCH = 3;
/** The kinds stand in rows of `MODEL_PER_ROW` (22 kinds at 3 tiles do not fit the 50 tile stage), the rows `MODEL_KIND_ROW_PITCH` tiles apart, each with its own pillar torches. */
export const MODEL_PER_ROW = 11;
export const MODEL_KIND_ROW_PITCH = 7;
/** The effect rows' entity ids are `ID.modelEffect + row * MODEL_EFFECT_STRIDE + col`. */
export const MODEL_EFFECT_STRIDE = 20;
/** The effect rows are 4 tiles apart: the ogre stands taller than 3 tiles on the screen. */
export const MODEL_ROW_PITCH = 4;
export const MODEL_EFFECT_ROWS = 9;
export const MODEL_EFFECT_COLS = 12;
export const CROWD_PER_ROW = 23;
export const CROWD_ROWS = 8;
/** The variety block (#357), below the crowd: one row per animal kind, `VARIETY_COLS` animals each, `VARIETY_PITCH` tiles apart. */
export const VARIETY_ROWS = 8;
export const VARIETY_COLS = 6;
export const VARIETY_PITCH = 3;
export const CROWD_MAX = CROWD_PER_ROW * CROWD_ROWS;
/** The pillars' columns (tiles) in the model block, over the kind cells 0, 3, 6 and 9 of a row (kinds stand at x 3.5 to 33.5): every kind is at most 3 tiles across from a torch of its row. */
export const PILLAR_X = [3, 12, 21, 30] as const;

export interface Layout {
  map: TileMap;
  /** Foot of figure cell `i`, in tiles. */
  figure(i: number): { x: number; z: number };
  /** Foot of cell `k` (0..3) of effect group `g` (0..9), in tiles. */
  effect(g: number, k: number): { x: number; z: number };
  /** Foot of model kind `i`'s cell, of column `col` in effect row `row`, of the figure `i` that dies, and of crowd place `i`, in tiles. */
  model(i: number): { x: number; z: number };
  modelEffect(row: number, col: number): { x: number; z: number };
  dying(i: number): { x: number; z: number };
  crowd(i: number): { x: number; z: number };
  /** Foot of the animal in column `col` of variety row `row`, in tiles. */
  variety(row: number, col: number): { x: number; z: number };
  /** The torches on the pillars' south faces: where the flame stands (tiles; z is the wall line). */
  pillarTorches: { x: number; z: number }[];
  /** Where the camera starts for `&focus=`. */
  focus: Record<'figures' | 'corridor' | 'effects' | 'objects' | 'models', { x: number; z: number }>;
}

/** `nModels` is the number of model kinds in the kind row (the camera of `focus.models` centres on that row). */
export function layoutOf(nFigures: number, nModels: number): Layout {
  const rows = Math.ceil(nFigures / PER_ROW);
  const figTop = 12;
  const effTop = figTop + rows * FIG_PITCH + 1;
  const groupRows = Math.ceil(EFFECT_GROUPS / GROUPS_PER_ROW);
  // The model block: the pillars' row, the kinds one pitch below, then the effect rows, the dying row and the crowd.
  const mTop = effTop + groupRows * GROUP_ROW_PITCH + 1;
  const kindRows = Math.max(1, Math.ceil(nModels / MODEL_PER_ROW));
  const effTop2 = mTop + kindRows * MODEL_KIND_ROW_PITCH;
  const dyingZ = effTop2 + MODEL_EFFECT_ROWS * MODEL_ROW_PITCH + 1.5;
  const crowdTop = dyingZ + kindRows * MODEL_PITCH;
  const varTop = crowdTop + CROWD_ROWS * 2 + 1;
  const h = Math.ceil(varTop + VARIETY_ROWS * VARIETY_PITCH) + 2;
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
  for (let r = 0; r < kindRows; r++) for (const x of PILLAR_X) tiles[(mTop + r * MODEL_KIND_ROW_PITCH) * GALLERY_W + x] = TILE_ID.Wall;
  // Group 8 wades: shallow water under its four cells.
  const w = effect(8, 0);
  floor(Math.floor(w.x) - 1, Math.floor(w.x) - 1 + GROUP_CELLS * CELL - 1, Math.floor(w.z) - 1, Math.floor(w.z), TILE_ID.ShallowWater);
  return {
    map: new TileMap(GALLERY_W, h, tiles),
    figure: (i) => ({ x: 2 + (i % PER_ROW) * FIG_PITCH + 1.5, z: figTop + Math.floor(i / PER_ROW) * FIG_PITCH + 2 }),
    effect,
    model: (i) => ({ x: 2 + (i % MODEL_PER_ROW) * MODEL_PITCH + 1.5, z: mTop + Math.floor(i / MODEL_PER_ROW) * MODEL_KIND_ROW_PITCH + 3.5 }),
    modelEffect: (row, col) => ({ x: 2 + col * MODEL_PITCH + 1.5, z: effTop2 + row * MODEL_ROW_PITCH + 3 }),
    dying: (i) => ({ x: 2 + (i % MODEL_PER_ROW) * MODEL_PITCH + 1.5, z: dyingZ + Math.floor(i / MODEL_PER_ROW) * MODEL_PITCH }),
    crowd: (i) => ({ x: 2 + (i % CROWD_PER_ROW) * 2 + 1, z: crowdTop + Math.floor(i / CROWD_PER_ROW) * 2 + 1 }),
    variety: (row, col) => ({ x: 2 + col * VARIETY_PITCH + 1.5, z: varTop + row * VARIETY_PITCH + 2 }),
    pillarTorches: Array.from({ length: kindRows }, (_, r) => PILLAR_X.map((x) => ({ x: x + 0.5, z: mTop + r * MODEL_KIND_ROW_PITCH + 1 }))).flat(),
    focus: {
      models: { x: 2 + (Math.min(nModels, MODEL_PER_ROW) * MODEL_PITCH) / 2, z: mTop + 3.5 },
      figures: { x: 2 + (PER_ROW * FIG_PITCH) / 2, z: figTop + (rows * FIG_PITCH) / 2 },
      corridor: { x: 18, z: 3.5 },
      effects: { x: 24, z: effTop + 2 },
      objects: { x: 18, z: 8 },
    },
  };
}

import { TILE_ID } from '../../generated/defs';
import { cellHeight } from '../heights';
import type { TileMap } from '../../sim/map';
import type { PondField } from '../pond/pondField';

/** Which kind of dip a terrain tile makes. */
export const DIP = { none: 0, water: 1, lava: 2, chasm: 3 } as const;
export type DipKind = (typeof DIP)[keyof typeof DIP];

// First guesses for the user to tune; every number of the shape lives here.
export const WATER_LEVEL = -0.08, LAVA_LEVEL = -0.15;
export const SHALLOW_BED = 0.55, DEEP_BED = 2.3, LAVA_BED = 1.7, CHASM_BED = 12;
/** The mask's value on a straight cell edge: the dip's outline. The bank starts here, the liquid's surface lies inside it, and the dip material's broken-off floor pieces break off by it. */
export const OUTLINE_EDGE = 0.5;
/** The mask value at which each bed reaches its full depth (the slope of the bank). */
export const STEEP = { water: 0.85, deep: 0.95, lava: 0.8, chasm: 0.56 } as const;
export const ROUGH = 0.06, LIP = 0.05;

/** The dip kind of a tile id: ShallowWater and DeepWater water, Lava lava, Chasm chasm, everything else none. */
export function dipOf(tile: number): DipKind {
  switch (tile) {
    case TILE_ID.ShallowWater:
    case TILE_ID.DeepWater: return DIP.water;
    case TILE_ID.Lava: return DIP.lava;
    case TILE_ID.Chasm: return DIP.chasm;
    default: return DIP.none;
  }
}

/** A height-0 cell that is a tile of dip kind `dip`, or has one among its eight neighbours (the rounded outline reaches into those): the cells a liquid's surface covers. */
export function liquidCell(map: TileMap, x: number, z: number, dip: DipKind): boolean {
  if (cellHeight(map.get(x, z)) !== 0) return false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (dipOf(map.get(x + dx, z + dz)) === dip) return true;
  }
  return false;
}

function ss(a: number, b: number, t: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** Smooth membership of the cells around (x, z) in tiles: `OUTLINE_EDGE` (0.5) on a straight cell edge. Outside the map is no member. */
export function maskAt(map: TileMap, x: number, z: number, member: (tile: number) => boolean): number {
  const u = x - 0.5, v = z - 0.5;
  const i = Math.floor(u), j = Math.floor(v);
  const fx = ss(0, 1, u - i), fz = ss(0, 1, v - j);
  const m = (a: number, b: number) => (member(map.get(a, b)) ? 1 : 0);
  const top = m(i, j) * (1 - fx) + m(i + 1, j) * fx;
  const bot = m(i, j + 1) * (1 - fx) + m(i + 1, j + 1) * fx;
  return top * (1 - fz) + bot * fz;
}

function lattice(i: number, j: number): number {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on an integer-lattice hash, smoothstep-interpolated, in 0..1. */
function vnoise(x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = ss(0, 1, x - i), fz = ss(0, 1, z - j);
  const a = lattice(i, j) * (1 - fx) + lattice(i + 1, j) * fx;
  const b = lattice(i, j + 1) * (1 - fx) + lattice(i + 1, j + 1) * fx;
  return a * (1 - fz) + b * fz;
}

export const isWater = (t: number) => t === TILE_ID.ShallowWater || t === TILE_ID.DeepWater;
const isDeep = (t: number) => t === TILE_ID.DeepWater;
export const isLava = (t: number) => t === TILE_ID.Lava;
export const isChasm = (t: number) => t === TILE_ID.Chasm;

/** Height of the ground at (x, z): 0 on plain floor, up to LIP on a rim, negative in a dip. */
export function bedAt(map: TileMap, x: number, z: number): number {
  return bed(map, x, z, true);
}

/**
 * Where a grounded foot stands: `bedAt` without the chasm's wall. A rounded outline puts the wall inside some floor cells (inner
 * corners), where the server lets a figure walk; only a Sink (or a barrel's anim 2) makes a figure fall. Water and lava are as in `bedAt`.
 */
export function walkBedAt(map: TileMap, x: number, z: number): number {
  const deck = pondFieldOf(map)?.deckAt(x, z);
  return deck != null ? deck : bed(map, x, z, false);
}

/** The pond's field (#360) of a view map, kept beside the map: a woodland's pond shapes its own bed. Maps without one take the tile masks. */
const ponds = new WeakMap<TileMap, PondField>();
export function setPondField(map: TileMap, field: PondField | null): void {
  if (field) ponds.set(map, field); else ponds.delete(map);
}
export function pondFieldOf(map: TileMap): PondField | undefined {
  return ponds.get(map);
}

function bed(map: TileMap, x: number, z: number, chasm: boolean): number {
  const mW = maskAt(map, x, z, isWater), mD = maskAt(map, x, z, isDeep);
  const mL = maskAt(map, x, z, isLava), mC = maskAt(map, x, z, isChasm);
  const any = Math.max(mW, mL, mC);
  if (any === 0) return 0;
  const pond = pondFieldOf(map);
  const water = pond ? pond.depthAt(x, z) : SHALLOW_BED * ss(OUTLINE_EDGE, STEEP.water, mW) + (DEEP_BED - SHALLOW_BED) * ss(OUTLINE_EDGE, STEEP.deep, mD);
  let h = -water
    - LAVA_BED * ss(OUTLINE_EDGE, STEEP.lava, mL) - (chasm ? CHASM_BED * ss(OUTLINE_EDGE, STEEP.chasm, mC) : 0);
  h += (vnoise(x * 4.3, z * 4.3) - 0.5) * 2 * ROUGH * ss(OUTLINE_EDGE, 0.7, any) * (1 - ss(0.56, 0.9, mC));
  // A continuous bump on the outside of the outline: 0 at the cell edge (any = OUTLINE_EDGE) and beyond 0.25.
  h += LIP * ss(0.25, 0.4, any) * (1 - ss(0.42, OUTLINE_EDGE, any)) * (0.4 + 0.6 * vnoise(x * 6, z * 6));
  return h;
}

/**
 * How far the marks of lava and of a chasm reach at (x, z): 1 minus the distance in tiles to the nearest cell of that kind, so 1 in and
 * on such a cell, falling to 0 one tile away. One tile is how far the dip mesh reaches (the cells beside terrain), so the marks end
 * where the world mesh's plain floor begins. Writes the lava's value to `out[at]` and the chasm's to `out[at + 1]`.
 */
export function nearAt(map: TileMap, x: number, z: number, out: { [i: number]: number }, at: number): void {
  const cx = Math.floor(x), cz = Math.floor(z);
  let lava = 1, chasm = 1;
  for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
    const kind = dipOf(map.get(i, j));
    if (kind !== DIP.lava && kind !== DIP.chasm) continue;
    const dx = Math.max(i - x, 0, x - i - 1), dz = Math.max(j - z, 0, z - j - 1), d2 = dx * dx + dz * dz;
    if (kind === DIP.lava) lava = Math.min(lava, d2); else chasm = Math.min(chasm, d2);
  }
  out[at] = 1 - Math.sqrt(lava);
  out[at + 1] = 1 - Math.sqrt(chasm);
}

/** The kind of dip at a point, from its three masks (`maskAt` of water, lava and chasm): the kind whose mask is largest, none below 0.15 (the bank material's choice). A tie goes to the chasm, then lava, then water. */
export function kindOf(water: number, lava: number, chasm: number): DipKind {
  const best = Math.max(water, lava, chasm);
  if (best < 0.15) return DIP.none;
  return chasm === best ? DIP.chasm : lava === best ? DIP.lava : DIP.water;
}

/** The liquid's surface height where (x, z) lies inside a water or lava outline (mask > `OUTLINE_EDGE`), else -Infinity. */
export function surfaceAt(map: TileMap, x: number, z: number): number {
  const w = maskAt(map, x, z, isWater), l = maskAt(map, x, z, isLava);
  if (w > OUTLINE_EDGE && w >= l) return WATER_LEVEL;
  if (l > OUTLINE_EDGE) return LAVA_LEVEL;
  return -Infinity;
}

/** `hidingHeightAt` where the world hides nothing of a figure: below everything (a dip's deepest bed is CHASM_BED). */
export const NOTHING_HIDDEN = -1000;

/**
 * The height below which the picture's world hides a figure standing at (x, z), whatever the figure's own parts: 0 on the floor (a part
 * below the floor is behind it), the opaque lava surface in lava, and `NOTHING_HIDDEN` where the ground is a dip (wading in the
 * clear water, falling into the chasm: the parts below 0 are seen). The id pass of the models keeps only what is above it, so a hidden
 * piece cannot cut its own figure's outline. One value per figure, by its foot: a figure with its feet on the floor and its other end
 * over a dip is taken as on the floor.
 */
export function hidingHeightAt(map: TileMap, x: number, z: number): number {
  if (surfaceAt(map, x, z) === LAVA_LEVEL) return LAVA_LEVEL;
  return bedAt(map, x, z) < -LIP ? NOTHING_HIDDEN : 0;
}

/** A height-0 cell the dip mesh draws: a terrain cell, or a non-terrain cell with a terrain cell among its eight neighbours. */
export function inDipMesh(map: TileMap, x: number, z: number): boolean {
  const t = map.get(x, z);
  if (dipOf(t) !== DIP.none) return true;
  if (cellHeight(t) !== 0) return false;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      if ((di || dj) && dipOf(map.get(x + di, z + dj)) !== DIP.none) return true;
    }
  }
  return false;
}

/** exp fade of anything deep in a chasm: 0.03 + 0.97 * exp(0.55 * min(y, 0)). */
export function depthFade(y: number): number {
  return 0.03 + 0.97 * Math.exp(0.55 * Math.min(y, 0));
}

/** Texels per tile of the water field's grid (`water/waterField.ts`). */
export const BED_RES = 4;

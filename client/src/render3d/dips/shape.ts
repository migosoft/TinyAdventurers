import { TILE_ID } from '../../generated/defs';
import { cellHeight } from '../heights';
import type { TileMap } from '../../sim/map';
import type { PondField } from '../pond/pondField';
import { deepSlope } from '../pond/pondField';

/** Which kind of dip a terrain tile makes. */
export const DIP = { none: 0, water: 1, lava: 2, chasm: 3 } as const;
export type DipKind = (typeof DIP)[keyof typeof DIP];

// First guesses for the user to tune; every number of the shape lives here.
export const WATER_LEVEL = -0.08, LAVA_LEVEL = -0.15;
export const SHALLOW_BED = 0.55, DEEP_BED = 2.3, LAVA_BED = 1.7, CHASM_BED = 12;
/** The mask's value on a straight cell edge: the dip's outline. The bank starts here, the liquid's surface lies inside it, and the dip material's broken-off floor pieces break off by it. */
export const OUTLINE_EDGE = 0.5;
/** The mask value at which each bed reaches its full depth (the slope of the bank). */
export const STEEP = { water: 0.85, lava: 0.8, chasm: 0.56 } as const;
export const ROUGH = 0.06, LIP = 0.05;
/** The deep water's share of the bed is gone where a chasm's mask leaves less than this of the cell (1 - mask below it): inside the chasm's outline. */
const CHASM_YIELD = 0.95;

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

/**
 * How far the drawn outline of water and lava grows out past the tile edge (#444): 0 to `EDGE_GROW` tiles, by low-frequency noise
 * (wavelength about `1 / EDGE_GROW_FREQ` tiles), so a straight run of tiles draws as a wavy shore. The lip ends at mask 0.25, about
 * 0.17 tiles outside the grown edge, so below 0.83 tiles the bed is flat again a tile out, where the dip mesh ends. 0 gives the
 * tile-bound outline of #324.
 */
export const EDGE_GROW = 0.5, EDGE_GROW_FREQ = 0.8;

/** How far (tiles) the outline of water and lava grows past the tile edge at (x, z): two octaves of noise, stretched to use the whole range. */
export function growAt(x: number, z: number): number {
  const f = EDGE_GROW_FREQ;
  const n = 0.65 * vnoise(x * f + 31.7, z * f + 5.3) + 0.35 * vnoise(x * f * 2.3 + 11.1, z * f * 2.3 + 47.9);
  return EDGE_GROW * ss(0.25, 0.75, n);
}

/**
 * Smooth membership of the cells around (x, z) in tiles: `OUTLINE_EDGE` (0.5) on a straight cell edge of a chasm, a wavy line on or
 * outside the cell edge of water and lava. Outside the map is no member. The rules still use the cell squares; the outline is a look.
 * Water and lava take the largest mask within `growAt` along the two axes and the diagonals (a dilation: a straight edge moves out by
 * exactly that, a corner is rounded), so no part of their tiles is drawn dry and lava never looks smaller than where it burns. A
 * chasm does not grow but breaks (`chasmMask`). The mask is linear in the cells, so a member with chasm and other cells takes each part
 * its own way.
 */
export function maskAt(map: TileMap, x: number, z: number, member: (tile: number) => boolean): number {
  return member === isChasm ? chasmMask(map, x, z) : grownMask(map, x, z, member);
}

/**
 * The broken rim of a chasm (#444): the floor beside it is split into pieces (`shardOf`, a Voronoi cell of a jittered lattice,
 * `SHARD_FREQ` per tile), and a piece has broken off where the plain mask reaches `OUTLINE_EDGE` less its chip (`CHIP` times
 * smoothstep(`CHIP_ID_FROM`, `CHIP_ID_TO`, its id)): up to about 0.22 tiles into the floor. A broken piece lies `BREAK_DEPTH` below the
 * floor with straight sides, and the chasm's wall drops on from there, so the rim runs in steps and jags. The dip material paints the
 * same pieces (`dipNodes.ts` shares these numbers and the hash) and its cracks run along their edges. Only outward and only a step:
 * a faller keeps the room and the wall its descent counts on, and a grounded foot (`walkBedAt`) stands on the floor.
 */
export const SHARD_FREQ = 1.35, CHIP = 0.3, CHIP_ID_FROM = 0.25, CHIP_ID_TO = 0.75, BREAK_DEPTH = 0.35;

const f32 = Math.fround;
const fract = (v: number): number => f32(v - Math.floor(v));

/** The shader's `hash21` (Dave Hoskins, `noiseNodes.ts`) in float32 steps, so the CPU's pieces are the GPU's: vec2 -> 0..1. */
export function hash21(x: number, y: number): number {
  const ax = fract(f32(x) * f32(0.1031)), ay = fract(f32(y) * f32(0.1031)), az = ax;
  const d = f32(f32(ax * f32(ay + f32(33.33))) + f32(ay * f32(az + f32(33.33))) + f32(az * f32(ax + f32(33.33))));
  const qx = f32(ax + d), qy = f32(ay + d), qz = f32(az + d);
  return fract(f32(f32(qx + qy) * qz));
}

/** The id (0..1) of the piece (x, z) in tiles lies in: the shader's `shards` (`dipNodes.ts`) at the same scale. */
export function shardOf(x: number, z: number): number {
  const qx = f32(x * SHARD_FREQ), qz = f32(z * SHARD_FREQ);
  const ix = Math.floor(qx), iz = Math.floor(qz), fx = f32(qx - ix), fz = f32(qz - iz);
  let best = 8, id = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = ix + ox, cz = iz + oy;
    const rx = f32(f32(ox + hash21(cx, cz)) - fx), ry = f32(f32(oy + hash21(f32(cx + 37.2), f32(cz + 17.7))) - fz);
    const dd = f32(rx * rx + ry * ry);
    if (dd <= best) { best = dd; id = hash21(f32(cx + 5.3), f32(cz + 71.9)); }
  }
  return id;
}

const chipOf = (t: number): number => CHIP * ss(CHIP_ID_FROM, CHIP_ID_TO, t);

/** Whether (x, z) lies on a broken-off piece of a chasm's rim, by the chasm's mask there. */
function brokenAt(x: number, z: number, chasm: number): boolean {
  return chasm >= OUTLINE_EDGE - CHIP && chasm >= OUTLINE_EDGE - chipOf(shardOf(x, z));
}

/** A chasm's mask (the plain one: the rim's broken pieces are a step in the bed, `brokenAt`). */
function chasmMask(map: TileMap, x: number, z: number): number {
  win0x = Math.floor(x) - 1; win0z = Math.floor(z) - 1;
  let pits = 0;
  for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) pits += pit[b * 3 + a] = map.get(win0x + a, win0z + b) === TILE_ID.Chasm ? 1 : 0;
  if (pits === 0) return 0;
  if (pits === 9) return 1;
  return winMask(pit, x, z);
}

/** The member's non-chasm cells and the chasm cells of the 3 by 3 cells from (`win0x`, `win0z`): every sample `grownMask` and `chasmMask` read. */
const own = new Float64Array(9), pit = new Float64Array(9);
let win0x = 0, win0z = 0;

/** The bilinear mask of a window (`own` or `pit`) at (x, z), which must lie within a half tile of the window's middle cell. */
function winMask(w: Float64Array, x: number, z: number): number {
  const u = x - 0.5, v = z - 0.5;
  const i = Math.floor(u), j = Math.floor(v);
  const tx = u - i, tz = v - j, fx = tx * tx * (3 - 2 * tx), fz = tz * tz * (3 - 2 * tz), k = (j - win0z) * 3 + (i - win0x);
  return (w[k] * (1 - fx) + w[k + 1] * fx) * (1 - fz) + (w[k + 3] * (1 - fx) + w[k + 4] * fx) * fz;
}

/** `growAt` of the last point asked: `bedAt` reads three grown masks at one point. */
let lastX = NaN, lastZ = NaN, lastR = 0;

/** `maskAt` of a member other than the chasm, grown by `growAt` (at most half a tile, so every sample lies in the 3 by 3 cells around the point). */
function grownMask(map: TileMap, x: number, z: number, member: (tile: number) => boolean): number {
  win0x = Math.floor(x) - 1; win0z = Math.floor(z) - 1;
  let owned = 0, pits = 0;
  for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
    const t = map.get(win0x + a, win0z + b), chasm = t === TILE_ID.Chasm;
    owned += own[b * 3 + a] = !chasm && member(t) ? 1 : 0;
    pits += chasm ? 1 : 0;
  }
  let m = owned === 9 ? 1 : 0;
  if (owned > 0 && owned < 9) {
    if (x !== lastX || z !== lastZ) { lastX = x; lastZ = z; lastR = growAt(x, z); }
    const r = lastR, d = r * Math.SQRT1_2;   // the diagonals round the grown corner
    m = Math.max(winMask(own, x, z), winMask(own, x - r, z), winMask(own, x + r, z), winMask(own, x, z - r), winMask(own, x, z + r),
      winMask(own, x - d, z - d), winMask(own, x + d, z - d), winMask(own, x - d, z + d), winMask(own, x + d, z + d));
  }
  // The grown outline gives way to a chasm's, so the two never overlap (their depths would add).
  const pc = pits === 0 ? 0 : chasmMask(map, x, z);
  return member(TILE_ID.Chasm) ? Math.min(1, m + pc) : Math.min(m, 1 - pc);
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

/** Signed distance in tiles from (x, z) to the DeepWater tiles' edge, positive inside them, from the 5 by 5 cells around, clamped to +-2. */
export function deepDistAt(map: TileMap, x: number, z: number): number {
  const cx = Math.floor(x), cz = Math.floor(z), inDeep = map.get(cx, cz) === TILE_ID.DeepWater;
  let d2 = 4;
  for (let j = cz - 2; j <= cz + 2; j++) for (let i = cx - 2; i <= cx + 2; i++) {
    if ((map.get(i, j) === TILE_ID.DeepWater) === inDeep) continue;   // the nearest cell of the other kind
    const dx = Math.max(i - x, 0, x - i - 1), dz = Math.max(j - z, 0, z - j - 1);
    d2 = Math.min(d2, dx * dx + dz * dz);
  }
  const d = Math.sqrt(d2);
  return inDeep ? d : -d;
}
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

/** The water's outline mask at (x, z): the pond field's drawn shore (#360) where the map has one, else the water tiles' `maskAt`. `OUTLINE_EDGE` on the outline either way. */
export function waterMaskAt(map: TileMap, x: number, z: number): number {
  const pond = pondFieldOf(map);
  return pond ? pond.wetAt(x, z) : maskAt(map, x, z, isWater);
}

function bed(map: TileMap, x: number, z: number, chasm: boolean): number {
  const pond = pondFieldOf(map);
  const mW = pond ? pond.wetAt(x, z) : grownMask(map, x, z, isWater);
  const mL = grownMask(map, x, z, isLava), mC = chasmMask(map, x, z);
  const any = Math.max(mW, mL, mC);
  if (any === 0) return 0;
  // A dungeon pool slopes into the deep as the woodland pond does (#448); the shallow part keeps the grown outline (#444).
  // The grown outline of a chasm gives way to the water's, so the two depths never add: the deep part is gone inside a chasm's outline (as the old deep mask was).
  const water = pond ? pond.depthAt(x, z) : SHALLOW_BED * ss(OUTLINE_EDGE, STEEP.water, mW) + (DEEP_BED - SHALLOW_BED) * ss(OUTLINE_EDGE, STEEP.water, mW) * ss(OUTLINE_EDGE, CHASM_YIELD, 1 - mC) * deepSlope(0, x, z, deepDistAt(map, x, z));
  let h = -water
    - LAVA_BED * ss(OUTLINE_EDGE, STEEP.lava, mL) - (chasm ? CHASM_BED * ss(OUTLINE_EDGE, STEEP.chasm, mC) : 0);
  h += (vnoise(x * 4.3, z * 4.3) - 0.5) * 2 * ROUGH * ss(OUTLINE_EDGE, 0.7, any) * (1 - ss(0.56, 0.9, mC));
  // A continuous bump on the outside of the outline: 0 at the cell edge (any = OUTLINE_EDGE) and beyond 0.25.
  h += LIP * ss(0.25, 0.4, any) * (1 - ss(0.42, OUTLINE_EDGE, any)) * (0.4 + 0.6 * vnoise(x * 6, z * 6));
  // A broken-off piece of a chasm's rim (#444): a step down, then the wall.
  if (chasm && mC >= OUTLINE_EDGE - CHIP && brokenAt(x, z, mC)) h = Math.min(h, -BREAK_DEPTH);
  return h;
}

/**
 * How far the marks of lava and of a chasm reach at (x, z): 1 minus the distance in tiles to the nearest cell of that kind, so 1 in and
 * on such a cell, falling to 0 one tile away. One tile is how far the dip mesh reaches (the cells beside terrain), so the marks end
 * where the world mesh's plain floor begins. Lava's is 1 up to its grown shore (`growAt`) and falls to 0 between there and a tile
 * out. Writes the lava's value to `out[at]` and the chasm's to `out[at + 1]`.
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
  // Lava's marks start at its grown shore (#444) and still end a tile out, so they follow the drawn outline and stay on the dip mesh.
  const d = Math.sqrt(lava), g = d < 1 ? growAt(x, z) : 0;
  out[at] = d <= g ? 1 : 1 - (d - g) / (1 - g);
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
  const w = waterMaskAt(map, x, z), l = maskAt(map, x, z, isLava);
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

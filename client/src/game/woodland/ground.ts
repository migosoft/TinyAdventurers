// The woodland's ground (#203): the whole map painted once into one RGBA image. Floor (and the tiles trees
// stand on) is the cove's grass with flowers, Road is packed dirt, Thicket is dark undergrowth. Where a
// stronger ground meets a weaker one (road over thicket over grass) it creeps 3 px into it, dithered, so no
// tile edge shows. Walls and Void stay transparent (the dungeon tiles are drawn there). Pure and seeded.
// A pond (#360) is painted from its drawn shore (`Shore`, the view's pond field), not from the water tiles: the drawn water is the
// bank, whose bed is painted here (sand, silt, mud, stones), and the bank creeps onto every ground around it, up to a tile wide at
// a pond and a few px at a stream. Without a shore the paint is exactly as it was before ponds: water tiles are grass.
import { TILE_ID } from '../../generated/defs';
import { TILE, type TileMap } from '../../sim/map';
import type { Rgba } from '../../render3d/trees/kinds';
import { BASE, EDGE, FLOWERS, G1, noise, PATCH, rng, type Rgb } from '../covemath';
import type { RoadEdge } from './road';

/** The tiles the woodland paints itself (the dungeon tile art is skipped there): the pond's water tiles too, whose bank and bed are painted (#360). */
export const GROUND_TILES = new Set<number>([TILE_ID.Floor, TILE_ID.Road, TILE_ID.Thicket, TILE_ID.Trunk, TILE_ID.Barrier, TILE_ID.ShallowWater, TILE_ID.DeepWater]);

/** BANK (#360): the drawn water's bed, and the wet earth it creeps onto the land with. No tile has it: it comes from the `Shore`. */
export const NONE = 0, GRASS = 1, THICKET = 2, ROAD = 3, BANK = 4;
/** What the painter reads of a pond's drawn shore (the view's `PondField`), at tile points: tiles inside the drawn water (0 on land), tiles from it on land (0 in it), and how much of the pond's body is around (0..1; 0 along a stream). */
export interface Shore {
  shoreAt(x: number, z: number): number; bankAt(x: number, z: number): number; bodyAt(x: number, z: number): number;
  /** The bed's depth (tiles): with it the mud lies where the bed is deep, not wherever the shore is far (#431). */
  depthAt?(x: number, z: number): number;
  /** The bridge decks (tile rects): the view map has water under them, but a deck that carries the road keeps the road's paint where the drawn shore is dry. */
  decks?: readonly { x0: number; z0: number; x1: number; z1: number; road: boolean }[];
}
/** Inside the tile kinds only (`kinds`): WET flags a tile the drawn water or its bank can reach, KIND masks the flag off. */
const WET = 8, KIND = 7;
/** A tile is WET when its centre is nearer the drawn water than this (tiles): the bank's reach plus half a tile's diagonal. */
const WET_TILES = 1.75;
/** The shores of the tile kinds that have one (`kinds`). */
const SHORES = new WeakMap<Uint8Array, Shore>();
/** How far a stronger ground creeps into a weaker one (px). */
const CREEP = 3;
/**
 * The drawn road's edges of the tile kinds that have one (`kinds`); NEAR_ROAD flags a tile that can hold road px. `insideAt` changes
 * faster than 1 tile per tile (the width's swing and a deck's S-bend add to the line's slope): a corner px lay 1.05 inside where the
 * tile's centre read -0.91 (#430 review), so the bound is a tile's half-diagonal 0.71 with a margin, plus the dither's CREEP px.
 */
const ROADS = new WeakMap<Uint8Array, RoadEdge>();
const NEAR_ROAD = 16, ROAD_NEAR = -1.3 - CREEP / TILE;
/** How far the bank reaches onto the land at most (px, under a tile): beside a pond and beside a stream; the pond's reach is full where `Shore.bodyAt` is at least BODY_NEAR. */
const POND_REACH = 15, STREAM_REACH = 4.5, BODY_NEAR = 0.1;
/** The bank's edge wobbles between this share of the reach and all of it, over lattice cells of BANK_WOBBLE px, and frays over BANK_FRINGE px. */
const BANK_MIN = 0.25, BANK_WOBBLE = 11, BANK_FRINGE = 2;
/** Grass tufts on the bank: clumps of TUFT_STEP px, none nearer the water than TUFT_FROM px, a share of TUFT_FAR of the ground at the bank's far edge and thinning to TUFT_NEAR toward the water. */
const TUFT_STEP = 3, TUFT_FROM = 3, TUFT_FAR = 0.4, TUFT_NEAR = 0.08;
/** The bed's zones by shore distance (px): the wet line at the water's edge is this wide either side, then sand, silt from here, mud from here; a stream's bed counts as this much deeper (silt and pebbles, not a sand path). */
const WATERLINE = 2, SILT_FROM = 12, MUD_FROM = 30, STREAM_DEEPER = 9;
/** With the bed's depth (`Shore.depthAt`): the shore distance counts up to SHELF_PX only (a shelf is sand and silt however wide), and every tile of depth below SHELF_DEPTH counts as DEPTH_PX more (the slope to the deep turns to mud). */
const SHELF_PX = 17, SHELF_DEPTH = 0.8, DEPTH_PX = 22; // balancing
/** The share of darker specks in the wet line. */
const WET_SPECKS = 0.12;
/** Stones: the cell (px) that holds one at most, and the share of cells that do: on the land, in the water's sparse and clustered parts, and the factor in the mud. */
const STONE_CELL = 7, STONES_LAND = 0.04, STONES_FEW = 0.05, STONES_MANY = 0.3, STONES_DEEP = 0.4;
/** A stone's rows by size (small, middle, large), lit from the top left: L lit, S stone, D dark, a dot nothing. */
const STONE_SHAPES = [['LS', 'SD'], ['LSS', 'SDD'], ['.LS.', 'LSSD', '.DD.']];
/** One flower per this many px² of grass. */
const FLOWER_AREA = 40;

// the plant palette `P`'s browns (d, c, b) and thicket greens (0, 1)
const DIRT_D: Rgb = [176, 112, 74], DIRT_C: Rgb = [143, 64, 41], DIRT_B: Rgb = [98, 53, 43];
/** The road's rim: a darker, greener brown, mixed in at low contrast. */
const RIM: Rgb = [70, 56, 40], RIM_MIX = 0.4;
export const THICK_0: Rgb = [28, 58, 50], THICK_1: Rgb = [40, 100, 62];

// the pack's earth browns (dark to pale), a little warmer than the pack's (less blue in them: the bed read as grey, #431), and stone greys
const DAMP: Rgb = [78, 58, 48], EARTH: Rgb = [128, 94, 74], SAND: Rgb = [180, 144, 112], PALE: Rgb = [218, 192, 156];
const STONE: Rgb = [123, 137, 148], STONE_LIT: Rgb = [182, 203, 207], STONE_DARK: Rgb = [73, 73, 73];

const kindOf = (t: number): number => (t === TILE_ID.Road ? ROAD : t === TILE_ID.Thicket ? THICKET : t === TILE_ID.Wall || t === TILE_ID.Void ? NONE : GRASS);

/**
 * The ground a tile shows. An invisible wall (Barrier, #259) shows its west neighbour's ground (else its east one's):
 * the wall column repeats the column beside it, so the road and the grass run on without a seam.
 */
export function groundOf(map: TileMap, x: number, y: number): number {
  const t = map.get(x, y);
  if (t !== TILE_ID.Barrier) return kindOf(t);
  const west = map.get(x - 1, y);
  return kindOf(west !== TILE_ID.Barrier && west !== TILE_ID.Void ? west : map.get(x + 1, y));
}

/**
 * The tiles' kinds. With a shore, the tiles its water or bank can reach carry WET (read a kind through `& KIND`) and the array remembers the shore.
 * With a road edge (#430) the Road tiles count as grass, and the tiles the drawn road can reach carry NEAR_ROAD.
 */
function kinds(map: TileMap, shore?: Shore, road?: RoadEdge): Uint8Array {
  const { w, h } = map;
  const k = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const g = groundOf(map, x, y); k[y * w + x] = road && g === ROAD ? GRASS : g; }
  if (shore) for (const d of shore.decks ?? []) if (d.road) for (let y = d.z0; y < d.z1; y++) for (let x = d.x0; x < d.x1; x++) if (k[y * w + x] === GRASS) k[y * w + x] = ROAD;
  if (shore) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (k[y * w + x] !== NONE && shore.bankAt(x + 0.5, y + 0.5) < WET_TILES) k[y * w + x] |= WET;
  if (shore) SHORES.set(k, shore);
  if (road) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (k[y * w + x] !== NONE && road.insideAt(x + 0.5, y + 0.5) > ROAD_NEAR) k[y * w + x] |= NEAR_ROAD;
    ROADS.set(k, road);
  }
  return k;
}

/** Where pixel (x, y) lies across the drawn shore (px): positive in the drawn water, zero or negative on the land. */
function shorePx(s: Shore, x: number, y: number): number {
  const X = (x + 0.5) / TILE, Z = (y + 0.5) / TILE, inside = s.shoreAt(X, Z);
  return inside > 0 ? inside * TILE : -s.bankAt(X, Z) * TILE;
}

/** Cheap per-pixel hash in [0, 1). */
function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s | 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1) on a lattice of `step` px, from the pixel hash (no table: `pixelKind` has no painter). */
function wobble(x: number, y: number, step: number, seed: number): number {
  const fx = x / step, fy = y / step, i = Math.floor(fx), j = Math.floor(fy);
  const u = (fx - i) * (fx - i) * (3 - 2 * (fx - i)), v = (fy - j) * (fy - j) * (3 - 2 * (fy - j));
  const a = hash(i, j, seed) + (hash(i + 1, j, seed) - hash(i, j, seed)) * u, b = hash(i, j + 1, seed) + (hash(i + 1, j + 1, seed) - hash(i, j + 1, seed)) * u;
  return a + (b - a) * v;
}

/** The ground kind a pixel shows: its tile's, or a stronger neighbour tile's where that creeps in (dithered). */
function pixelKind(k: Uint8Array, w: number, h: number, tx: number, ty: number, x: number, y: number, seed: number): number {
  const raw = k[ty * w + tx], own = raw & KIND;
  if (own === NONE) return own;
  if (raw & WET) {
    // the bank, stronger than every ground: the drawn water, and on the land an edge that wobbles, frayed by the dither
    const s = SHORES.get(k)!, d = -shorePx(s, x, y);
    if (d <= 1) return BANK; // the water, and the px at it
    const body = Math.min(1, s.bodyAt((x + 0.5) / TILE, (y + 0.5) / TILE) / BODY_NEAR);
    const reach = (STREAM_REACH + (POND_REACH - STREAM_REACH) * body) * (BANK_MIN + (1 - BANK_MIN) * wobble(x, y, BANK_WOBBLE, seed + 11));
    // tufts of the ground under it stay standing on the bank, fewer toward the water
    if (d + hash(x, y, seed + 3) * BANK_FRINGE < reach && !(d > TUFT_FROM && wobble(x, y, TUFT_STEP, seed + 17) < TUFT_NEAR + (TUFT_FAR - TUFT_NEAR) * (d / reach))) return BANK;
  }
  if (own === ROAD) return own;
  // the drawn road (#430), under the bank: inside its edge, frayed by the dither as the tile borders are
  if (raw & NEAR_ROAD && ROADS.get(k)!.insideAt((x + 0.5) / TILE, (y + 0.5) / TILE) * TILE + CREEP * (1 - hash(x, y, seed)) > 0) return ROAD;
  // deeper than CREEP px inside the tile, no neighbour tile is near enough to creep in
  const lx = x - tx * TILE, ly = y - ty * TILE;
  if (lx >= CREEP - 1 && lx <= TILE - CREEP && ly >= CREEP - 1 && ly <= TILE - CREEP) return own;
  let best = own;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = tx + dx, ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const nk = k[ny * w + nx] & KIND;
    if (nk <= own || nk <= best) continue;
    // distance (px) from this pixel to the neighbour tile's rect
    const gx = dx < 0 ? x - (nx * TILE + TILE - 1) : dx > 0 ? nx * TILE - x : 0;
    const gy = dy < 0 ? y - (ny * TILE + TILE - 1) : dy > 0 ? ny * TILE - y : 0;
    const d = Math.hypot(gx, gy);
    if (d < CREEP && hash(x, y, seed) < 1 - d / CREEP) best = nk;
  }
  return best;
}

/** True where the pixel (x, y) shows grass (not road, thicket or off the map; creeping edges included). */
function grassAt(k: Uint8Array, w: number, h: number, seed: number, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
  return pixelKind(k, w, h, tx, ty, x, y, seed) === GRASS;
}

/** The ground kind (NONE, GRASS, THICKET, ROAD, BANK) that pixel (x, y) shows, creeping edges included. */
export function groundKindAt(map: TileMap, seed: number, x: number, y: number, shore?: Shore, road?: RoadEdge): number {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return NONE;
  return pixelKind(kinds(map, shore, road), map.w, map.h, tx, ty, x, y, seed);
}

/** A `kindRow` reader that fixes the map's tile kinds now (one pass), so a source built at one moment stays consistent. */
export function kindRows(map: TileMap, seed: number, shore?: Shore, road?: RoadEdge): (ty: number, out: Uint8Array) => void {
  const k = kinds(map, shore, road);
  const w = map.w * TILE;
  return (ty, out) => {
    for (let ly = 0; ly < TILE; ly++) for (let x = 0; x < w; x++) out[ly * w + x] = pixelKind(k, map.w, map.h, x >> 4, ty, x, ty * TILE + ly, seed);
  };
}

/** `groundKindAt` of every pixel of tile row `ty`, into `out` (map px, row-major, TILE rows of map.w * TILE); reads the map's current tiles. */
export function kindRow(map: TileMap, seed: number, ty: number, out: Uint8Array): void {
  kindRows(map, seed)(ty, out);
}

/** Flower spots (px, the flower's own pixel; it and its four neighbours show grass), about one per FLOWER_AREA px² of grass, never on road, thicket or a bank. */
export function flowerSpots(map: TileMap, seed: number, shore?: Shore, road?: RoadEdge): { x: number; y: number }[] {
  const k = kinds(map, shore, road);
  const r = rng(seed * 7919 + 41);
  const out: { x: number; y: number }[] = [];
  const per = (TILE * TILE) / FLOWER_AREA;
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if ((k[ty * map.w + tx] & KIND) !== GRASS) continue;
    const n = Math.floor(per + r());
    for (let i = 0; i < n; i++) {
      const x = tx * TILE + 1 + Math.floor(r() * (TILE - 2)), y = ty * TILE + 1 + Math.floor(r() * (TILE - 2));
      if (grassAt(k, map.w, map.h, seed, x, y) && grassAt(k, map.w, map.h, seed, x - 1, y) && grassAt(k, map.w, map.h, seed, x + 1, y) && grassAt(k, map.w, map.h, seed, x, y - 1) && grassAt(k, map.w, map.h, seed, x, y + 1)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * The ground painted in pieces: `band(ty)` paints tile row `ty` (rows are independent, any order), then `blades()`
 * and `flowers()` run in that order (they need all rows). `data` is the finished image after the last of them.
 */
export class GroundPainter {
  readonly w: number;
  readonly h: number;
  readonly rows: number;
  readonly data: Uint8ClampedArray;
  private k: Uint8Array;
  private kindAt: Uint8Array;
  private nGrass: (x: number, y: number) => number;
  private nDirt: (x: number, y: number) => number;
  private nDirtBig: (x: number, y: number) => number;
  private nWarpX: (x: number, y: number) => number;
  private nWarpY: (x: number, y: number) => number;
  private nDirtMid: (x: number, y: number) => number;
  private nThick: (x: number, y: number) => number;
  private nBed: (x: number, y: number) => number;
  private nBedBig: (x: number, y: number) => number;

  /** `shore`: the pond's drawn shore (#360); without one no bank is painted. */
  constructor(private map: TileMap, private seed: number, private shore?: Shore, private road?: RoadEdge) {
    this.w = map.w * TILE;
    this.h = map.h * TILE;
    this.rows = map.h;
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
    this.k = kinds(map, shore, road);
    this.kindAt = new Uint8Array(this.w * this.h);
    this.nGrass = noise(seed * 3 + 17, 26);
    this.nDirt = noise(seed * 5 + 9, 14);
    this.nDirtBig = noise(seed * 5 + 13, 40);
    this.nWarpX = noise(seed * 7 + 31, 23);
    this.nWarpY = noise(seed * 7 + 37, 23);
    this.nDirtMid = noise(seed * 5 + 19, 17);
    this.nThick = noise(seed * 11 + 3, 5);
    this.nBed = noise(seed * 19 + 7, 7);
    this.nBedBig = noise(seed * 19 + 13, 27);
  }

  /**
   * A bank pixel's colour, by where it lies across the shore (`shorePx`): on the land sand with patches of earth, a line of dark soil
   * under the turf's edge and wet, darker sand at the water; in the water pale sand in the shallows, then silt and the mud of the deep middle
   * (where the bed is deep, when the shore tells its depth, #431: a wide shelf stays sand and silt; else two tiles in). The zones' borders wander with the noise and are dithered. Stones lie scattered over all of it, in clusters.
   */
  private bank(x: number, y: number): Rgb {
    const { seed } = this, shore = this.shore!;
    const u = shorePx(shore, x, y);
    // how much of a stream this is (1) and not the pond's body (0)
    const stream = 1 - Math.min(1, shore.bodyAt((x + 0.5) / TILE, (y + 0.5) / TILE) * 2);
    const fine = this.nBed(x, y), dither = hash(x, y, seed + 21);
    // the depth the paint goes by: the shore distance, pushed about by the two noises (px) so no zone follows the outline
    const depth = u > 0 && shore.depthAt ? shore.depthAt((x + 0.5) / TILE, (y + 0.5) / TILE) : null;
    const t = (depth === null ? u : Math.min(u, SHELF_PX) + Math.max(0, depth - SHELF_DEPTH) * DEPTH_PX) + stream * STREAM_DEEPER +(this.nBedBig(x, y) - 0.5) * 12 + (fine - 0.5) * 5 + (dither - 0.5) * 4;

    // a stone: one per STONE_CELL px cell at most; in clusters (the big noise), and all along a stream
    const cx = Math.floor(x / STONE_CELL), cy = Math.floor(y / STONE_CELL);
    const many = stream > 0.5 || this.nBedBig(cx * STONE_CELL + 40, cy * STONE_CELL + 90) > 0.55;
    const share = u <= 0 ? STONES_LAND : (many ? STONES_MANY : STONES_FEW) * (t > MUD_FROM ? STONES_DEEP : 1);
    if (hash(cx, cy, seed + 31) < share) {
      const size = hash(cx, cy, seed + 34), rows = STONE_SHAPES[size < 0.55 ? 0 : size < 0.88 ? 1 : 2];
      const sx = x - cx * STONE_CELL - 1 - Math.floor(hash(cx, cy, seed + 32) * (STONE_CELL - rows[0].length)), sy = y - cy * STONE_CELL - 1 - Math.floor(hash(cx, cy, seed + 33) * (STONE_CELL - rows.length));
      const c = rows[sy]?.[sx];
      if (c === 'L') return STONE_LIT;
      if (c === 'S') return STONE;
      if (c === 'D') return STONE_DARK;
    }

    if (u <= 0) {
      // the land: wet sand at the water, dark soil where the turf ends, between them sand with patches of earth
      if (u > -WATERLINE) return dither < WET_SPECKS ? DAMP : EARTH;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.kindNear(x + dx, y + dy) !== BANK)) return DIRT_B;
      return fine < 0.34 ? EARTH : fine > 0.74 ? PALE : SAND;
    }
    if (u <= WATERLINE) return dither < WET_SPECKS ? DAMP : EARTH;
    if (t < SILT_FROM) return fine > 0.64 ? PALE : dither < 0.05 ? EARTH : SAND;
    if (t < MUD_FROM) return fine > 0.72 ? SAND : EARTH;
    return fine > 0.6 ? EARTH : DAMP;
  }

  /** The ground kind pixel (x, y) shows (NONE off the map). */
  private kindNear(x: number, y: number): number {
    const { map } = this;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return NONE;
    return pixelKind(this.k, map.w, map.h, tx, ty, x, y, this.seed);
  }

  private put(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = 255;
  }

  /** Tile row `ty`, all its pixels. */
  band(ty: number): void {
    const { w, seed, k, map } = this;
    for (let y = ty * TILE; y < ty * TILE + TILE; y++) {
      for (let x = 0; x < w; x++) {
        const pk = pixelKind(k, map.w, map.h, x >> 4, ty, x, y, seed);
        this.kindAt[y * w + x] = pk;
        if (pk === GRASS) this.put(x, y, this.nGrass(x, y) < 0.42 ? PATCH : BASE);
        else if (pk === ROAD) {
          // smooth, large patches (mostly the big noise), weighted towards the darker browns
          // The big noise is sampled through a domain warp and joined by a second octave, so its contours are not lattice-aligned; the thresholds are dithered over ~1-2 px.
          const wx = x + (this.nWarpX(x, y) - 0.5) * 28, wy = y + (this.nWarpY(x, y) - 0.5) * 28;
          const big = this.nDirtBig(wx, wy) * 0.7 + this.nDirtMid(wx, wy) * 0.3;
          const m = this.nDirt(x, y) * 0.25 + big * 0.75 + (hash(x, y, seed + 7) - 0.5) * 0.025;
          let c = hash(x, y, seed + 5) < 0.03 ? DIRT_B : m > 0.66 ? DIRT_D : m < 0.34 ? DIRT_B : DIRT_C;
          // a faint rim where the road meets something else: its edge pixels blend towards a darker, greener brown
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.kindNear(x + dx, y + dy) !== ROAD)) c = [0, 1, 2].map((i) => Math.round(c[i] + (RIM[i] - c[i]) * RIM_MIX)) as Rgb;
          this.put(x, y, c);
        } else if (pk === BANK) this.put(x, y, this.bank(x, y));
        else if (pk === THICKET) this.put(x, y, this.nThick(x, y) < 0.5 || hash(x, y, seed + 9) < 0.08 ? THICK_0 : THICK_1);
      }
    }
  }

  /** Sparse blade marks on the grass. */
  blades(): void {
    const { w, h, kindAt } = this;
    const rb = rng(this.seed * 13 + 23);
    const isGrass = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && kindAt[y * w + x] === GRASS;
    for (let n = 0; n < (w * h) / 90; n++) {
      const x = Math.floor(rb() * w), y = Math.floor(rb() * h);
      if (isGrass(x, y) && isGrass(x, y - 2) && isGrass(x, y + 1)) { this.put(x, y, EDGE); this.put(x + (rb() < 0.5 ? -1 : 1), y - 1, EDGE); }
    }
  }

  /** Flowers on the grass (single pixel with a stem, a third are small crosses). */
  flowers(): void {
    const rf = rng(this.seed * 17 + 5);
    for (const s of flowerSpots(this.map, this.seed, this.shore, this.road)) {
      const c = FLOWERS[Math.floor(rf() * FLOWERS.length)];
      if (rf() < 0.35) { this.put(s.x - 1, s.y, c); this.put(s.x + 1, s.y, c); this.put(s.x, s.y - 1, c); this.put(s.x, s.y + 1, G1); this.put(s.x, s.y, FLOWERS[1]); }
      else { this.put(s.x, s.y, c); this.put(s.x, s.y + 1, G1); }
    }
  }
}

/** The whole map in px (map.w·16 × map.h·16). */
export function paintGround(map: TileMap, seed: number, shore?: Shore, road?: RoadEdge): Rgba {
  const p = new GroundPainter(map, seed, shore, road);
  for (let ty = 0; ty < p.rows; ty++) p.band(ty);
  p.blades();
  p.flowers();
  return { w: p.w, h: p.h, data: p.data };
}

// The woodland's ground (#203): the whole map painted once into one RGBA image. Floor (and the tiles trees
// stand on) is the cove's grass with flowers, Road is packed dirt, Thicket is dark undergrowth. Where a
// stronger ground meets a weaker one (road over thicket over grass) it creeps 3 px into it, dithered, so no
// tile edge shows. Walls and Void stay transparent (the dungeon tiles are drawn there). Pure and seeded.
import { TILE_ID } from '../../generated/defs';
import { TILE, type TileMap } from '../../sim/map';
import type { Rgba } from '../vegetation';
import { BASE, EDGE, FLOWERS, G1, noise, PATCH, rng, type Rgb } from '../covemath';

/** The tiles the woodland paints itself (the dungeon tile art is skipped there). */
export const GROUND_TILES = new Set<number>([TILE_ID.Floor, TILE_ID.Road, TILE_ID.Thicket, TILE_ID.Trunk]);

export const NONE = 0, GRASS = 1, THICKET = 2, ROAD = 3;
/** How far a stronger ground creeps into a weaker one (px). */
const CREEP = 3;
/** One flower per this many px² of grass. */
const FLOWER_AREA = 40;

// the vegetation palette's browns (d, c, b) and thicket greens (0, 1)
const DIRT_D: Rgb = [176, 112, 74], DIRT_C: Rgb = [143, 64, 41], DIRT_B: Rgb = [98, 53, 43];
/** The road's rim: a darker, greener brown, mixed in at low contrast. */
const RIM: Rgb = [70, 56, 40], RIM_MIX = 0.4;
const THICK_0: Rgb = [28, 58, 50], THICK_1: Rgb = [40, 100, 62];

const kindOf = (t: number): number => (t === TILE_ID.Road ? ROAD : t === TILE_ID.Thicket ? THICKET : t === TILE_ID.Wall || t === TILE_ID.Void ? NONE : GRASS);

function kinds(map: TileMap): Uint8Array {
  const k = new Uint8Array(map.w * map.h);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) k[y * map.w + x] = kindOf(map.get(x, y));
  return k;
}

/** Cheap per-pixel hash in [0, 1). */
function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s | 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The ground kind a pixel shows: its tile's, or a stronger neighbour tile's where that creeps in (dithered). */
function pixelKind(k: Uint8Array, w: number, h: number, tx: number, ty: number, x: number, y: number, seed: number): number {
  const own = k[ty * w + tx];
  if (own === NONE || own === ROAD) return own;
  // deeper than CREEP px inside the tile, no neighbour tile is near enough to creep in
  const lx = x - tx * TILE, ly = y - ty * TILE;
  if (lx >= CREEP - 1 && lx <= TILE - CREEP && ly >= CREEP - 1 && ly <= TILE - CREEP) return own;
  let best = own;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = tx + dx, ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const nk = k[ny * w + nx];
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

/** The ground kind (NONE, GRASS, THICKET, ROAD) that pixel (x, y) shows, creeping edges included. */
export function groundKindAt(map: TileMap, seed: number, x: number, y: number): number {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return NONE;
  return pixelKind(kinds(map), map.w, map.h, tx, ty, x, y, seed);
}

/** Flower spots (px, the flower's own pixel; it and its four neighbours show grass), about one per FLOWER_AREA px² of grass, never on road or thicket. */
export function flowerSpots(map: TileMap, seed: number): { x: number; y: number }[] {
  const k = kinds(map);
  const r = rng(seed * 7919 + 41);
  const out: { x: number; y: number }[] = [];
  const per = (TILE * TILE) / FLOWER_AREA;
  for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
    if (k[ty * map.w + tx] !== GRASS) continue;
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
  private nThick: (x: number, y: number) => number;

  constructor(private map: TileMap, private seed: number) {
    this.w = map.w * TILE;
    this.h = map.h * TILE;
    this.rows = map.h;
    this.data = new Uint8ClampedArray(this.w * this.h * 4);
    this.k = kinds(map);
    this.kindAt = new Uint8Array(this.w * this.h);
    this.nGrass = noise(seed * 3 + 17, 26);
    this.nDirt = noise(seed * 5 + 9, 14);
    this.nDirtBig = noise(seed * 5 + 13, 40);
    this.nThick = noise(seed * 11 + 3, 5);
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
          const m = this.nDirt(x, y) * 0.25 + this.nDirtBig(x, y) * 0.75;
          let c = hash(x, y, seed + 5) < 0.03 ? DIRT_B : m > 0.66 ? DIRT_D : m < 0.34 ? DIRT_B : DIRT_C;
          // a faint rim where the road meets something else: its edge pixels blend towards a darker, greener brown
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.kindNear(x + dx, y + dy) !== ROAD)) c = [0, 1, 2].map((i) => Math.round(c[i] + (RIM[i] - c[i]) * RIM_MIX)) as Rgb;
          this.put(x, y, c);
        } else if (pk === THICKET) this.put(x, y, this.nThick(x, y) < 0.5 || hash(x, y, seed + 9) < 0.08 ? THICK_0 : THICK_1);
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
    for (const s of flowerSpots(this.map, this.seed)) {
      const c = FLOWERS[Math.floor(rf() * FLOWERS.length)];
      if (rf() < 0.35) { this.put(s.x - 1, s.y, c); this.put(s.x + 1, s.y, c); this.put(s.x, s.y - 1, c); this.put(s.x, s.y + 1, G1); this.put(s.x, s.y, FLOWERS[1]); }
      else { this.put(s.x, s.y, c); this.put(s.x, s.y + 1, G1); }
    }
  }
}

/** The whole map in px (map.w·16 × map.h·16). */
export function paintGround(map: TileMap, seed: number): Rgba {
  const p = new GroundPainter(map, seed);
  for (let ty = 0; ty < p.rows; ty++) p.band(ty);
  p.blades();
  p.flowers();
  return { w: p.w, h: p.h, data: p.data };
}

// The woodland's ground (#203): the whole map painted once into one RGBA image. Floor (and the tiles trees
// stand on) is the cove's grass with flowers, Road is packed dirt, Thicket is dark undergrowth. Where a
// stronger ground meets a weaker one (road over thicket over grass) it creeps 3 px into it, dithered, so no
// tile edge shows. Walls and Void stay transparent (the dungeon tiles are drawn there). Pure and seeded.
import { TILE_ID } from '../../generated/defs';
import { TILE, type TileMap } from '../../sim/map';
import type { Rgba } from '../vegetation';
import { BASE, EDGE, FLOWERS, G1, noise, rng, type Rgb } from '../covemath';

const NONE = 0, GRASS = 1, THICKET = 2, ROAD = 3;
/** How far a stronger ground creeps into a weaker one (px). */
const CREEP = 3;
/** One flower per this many px² of grass. */
const FLOWER_AREA = 40;

const PATCH: Rgb = [58, 131, 64];
// the vegetation palette's browns (d, c, b) and thicket greens (0, 1)
const DIRT_D: Rgb = [176, 112, 74], DIRT_C: Rgb = [143, 64, 41], DIRT_B: Rgb = [98, 53, 43];
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

/** True where a flower may stand: grass all round (a 3×3 block of grass pixels, so none creeps in from a road or thicket). */
function grassAt(k: Uint8Array, w: number, h: number, seed: number, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
  return pixelKind(k, w, h, tx, ty, x, y, seed) === GRASS;
}

/** Flower spots (px, the flower's own pixel), about one per FLOWER_AREA px² of grass, never on road or thicket. */
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
      if (grassAt(k, map.w, map.h, seed, x - 1, y) && grassAt(k, map.w, map.h, seed, x + 1, y) && grassAt(k, map.w, map.h, seed, x, y - 1) && grassAt(k, map.w, map.h, seed, x, y + 1)) out.push({ x, y });
    }
  }
  return out;
}

/** The whole map in px (map.w·16 × map.h·16). */
export function paintGround(map: TileMap, seed: number): Rgba {
  const w = map.w, h = map.h, W = w * TILE, H = h * TILE;
  const data = new Uint8ClampedArray(W * H * 4);
  const k = kinds(map);
  const nGrass = noise(seed * 3 + 17, 26), nDirt = noise(seed * 5 + 9, 9), nDirtBig = noise(seed * 5 + 13, 30), nThick = noise(seed * 11 + 3, 5);
  const put = (x: number, y: number, c: Rgb) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  };
  const kindAt: Uint8Array = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const ty = y >> 4;
    for (let x = 0; x < W; x++) {
      const pk = pixelKind(k, w, h, x >> 4, ty, x, y, seed);
      kindAt[y * W + x] = pk;
      if (pk === GRASS) put(x, y, nGrass(x, y) < 0.42 ? PATCH : BASE);
      else if (pk === ROAD) {
        const m = nDirt(x, y) * 0.5 + nDirtBig(x, y) * 0.5;
        put(x, y, hash(x, y, seed + 5) < 0.06 ? DIRT_B : m > 0.58 ? DIRT_D : m < 0.3 ? DIRT_B : DIRT_C);
      } else if (pk === THICKET) put(x, y, nThick(x, y) < 0.5 || hash(x, y, seed + 9) < 0.08 ? THICK_0 : THICK_1);
    }
  }
  // sparse blade marks on the grass
  const rb = rng(seed * 13 + 23);
  const isGrass = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && kindAt[y * W + x] === GRASS;
  for (let n = 0; n < (W * H) / 90; n++) {
    const x = Math.floor(rb() * W), y = Math.floor(rb() * H);
    if (isGrass(x, y) && isGrass(x, y - 2) && isGrass(x, y + 1)) { put(x, y, EDGE); put(x + (rb() < 0.5 ? -1 : 1), y - 1, EDGE); }
  }
  // flowers on the grass (single pixel with a stem, a third are small crosses)
  const rf = rng(seed * 17 + 5);
  for (const s of flowerSpots(map, seed)) {
    const c = FLOWERS[Math.floor(rf() * FLOWERS.length)];
    if (rf() < 0.35) { put(s.x - 1, s.y, c); put(s.x + 1, s.y, c); put(s.x, s.y - 1, c); put(s.x, s.y + 1, G1); put(s.x, s.y, FLOWERS[1]); }
    else { put(s.x, s.y, c); put(s.x, s.y + 1, G1); }
  }
  return { w: W, h: H, data };
}

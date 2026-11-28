import type { BridgeInfo } from '../../generated/BridgeInfo';
import type { PondInfo } from '../../generated/PondInfo';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { DEEP_BED, SHALLOW_BED, isWater, pondFieldOf, setPondField } from '../dips/shape';

import { inside, lattice } from './pondShape';

export { pondFieldOf, setPondField };

/** Where an inflow meets the pond, and the flow direction there (tiles; the direction is a unit vector). */
export interface Mouth { x: number; z: number; dx: number; dz: number }
/** A bridge deck: its tile rect, the travel axis, whether it carries the road, and the top height above the ground. */
export interface Deck { x0: number; z0: number; x1: number; z1: number; alongX: boolean; road: boolean; y: number }
/**
 * The DRAWN water of a woodland pond. The tiles stay the truth for the rules (walking, slowing, drowning); what is drawn is the free
 * shape the server made the tiles from: the pond's body is `inside > 0` of its blobs (`pondShape.ts`; a body tile is water exactly
 * when its centre is inside, so its centre is drawn wet and the shore lies within about 0.7 tiles of the tile edges), a stream is a
 * brook along a smooth curve through its points, opening into the pond. The drawn water never lies more than CLIP_FAR tiles outside
 * the water tiles (the view map's: a pond bridge's tiles are water), and every DeepWater tile's centre is at least DEEP_MIN deep.
 * The bed follows the tiles too (#431): over ShallowWater it is a shelf, at most SHELF_BED deep, and it falls to DEEP_BED only around
 * the DeepWater tiles, so what is drawn deep is what the rules call deep.
 * A brook cuts the corners of its tile staircase: a stream tile's centre may be drawn dry and a land tile's wet.
 */
export interface PondField {
  /** Tiles to the nearest drawn shore, > 0 in the drawn water, 0 on land. Bilinear over a grid of FIELD_RES per tile. */
  shoreAt(x: number, z: number): number;
  /** Tiles from the drawn shore on land (0 in the drawn water; large far from any water). */
  bankAt(x: number, z: number): number;
  /** The drawn water's smooth mask, 0..1: 0.5 on the drawn shore (as `OUTLINE_EDGE` of the tile masks), more inside. */
  wetAt(x: number, z: number): number;
  /** How much of the pond's body is around, 0..1: the shape's `inside` as a linear ramp (0.5 on a straight shore of the pond, 0 along a stream away from it). */
  bodyAt(x: number, z: number): number;
  /**
   * Bed depth below the ground, >= 0. A shelf: SHALLOW_BED at 0.5 tiles from the drawn shore (a brook is no deeper), then gently uneven
   * and a little deeper with the shore distance, at most SHELF_BED. Around the DeepWater tiles it falls to DEEP_BED: the slope starts
   * about DEEP_OUT tiles outside their edge and is down DEEP_INSIDE tiles inside it.
   */
  depthAt(x: number, z: number): number;
  /** The current: direction and strength 0..1. 1 on a stream, fading to 0 over 3 tiles inside the pond. */
  flowAt(x: number, z: number): { x: number; z: number; s: number };
  /** A deck's top height at this point, or null. */
  deckAt(x: number, z: number): number | null;
  mouths: Mouth[];
  decks: Deck[];
  seed: number;
  /** The tiles the field's grids cover: all the drawn water lies inside. */
  box: { x0: number; z0: number; x1: number; z1: number };
}

export const DECK_Y = 0.14; // tiles above the ground // balancing
const SHORE_SHALLOW = 0.5, SHORE_SHELF = 3; // tiles from the shore where the bed is SHALLOW_BED, and where the shelf has reached its depth // balancing
export const SHELF_BED = 0.8; // the shelf's greatest depth: the bed over ShallowWater away from the deep tiles // balancing
const SHELF_WAVE = 2.3, SHELF_EVEN = 0.45; // the shelf's unevenness: the size of its humps (tiles) and the share of its fall that is the same everywhere // balancing
const DEEP_OUT = 0.9, DEEP_INSIDE = 0.8, DEEP_WOBBLE = 0.3, DEEP_WAVE = 1.7; // tiles: the slope to the deep starts this far outside the DeepWater tiles' edge and is down this far inside it; its line strays this far, over humps of this size // balancing
const FIELD_RES = 8; // samples per tile of the field's grids
const MARGIN = 3; // tiles of land the grids keep around the water
const BODY_SOFT = 0.5, BODY_WIDE = 1.5; // tiles of the shape's `inside` over which the body's mask (and `bodyAt`) goes from 0.5 on the shore to 1 and to 0
const BROOK_MIN = 0.3, BROOK_MAX = 0.5, BROOK_WAVE = 2.5; // tiles: a brook's half-width swells between these, over about this length
const MOUTH_HALF = 0.7, MOUTH_LEN = 2; // tiles: the half-width at a brook's pond end, reached over this length
const STREAM_SOFT = 0.4; // tiles: the brook's mask goes from 0.5 on its edge to 1 (and 0) over this distance
const EDGE_ROUGH = 0.09, EDGE_WAVE = 0.9; // tiles: how far a brook's edge strays, and the size of its bumps
const CURVE_STEPS = 8; // straight pieces per span of the curve through a stream's points
const CLIP_NEAR = 0.7, CLIP_FAR = 0.95; // tiles outside the water tiles: the drawn water fades from the first and is gone at the second (the dip mesh and the water quads cover the cells that touch a water tile: one tile)
export const DEEP_MIN = 1.2; // the least bed depth at a DeepWater tile's centre // balancing
const DEEP_PIT = 0.7, DEEP_RAMP = 0.2; // tiles: the radius of the hollow that keeps a DeepWater tile's centre DEEP_MIN deep where the shore is near; it starts this far from the shore
const CORE = 0.5, REACH = 1.5; // stream: full current within CORE of the line, none REACH away // balancing
const FADE = 3; // tiles into the pond, straight on from the end segment, over which the current dies // balancing
const DECK_GROW = 0.5; // a deck reaches this far past its rect at both ends of its travel axis // balancing

const FAR = 1e12; // stands for infinity in the distance transform
const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };

/**
 * The bed depth at (x, z), `shore` tiles from the shore and `deep` tiles inside the DeepWater tiles (negative: outside them): the
 * shelf, and the slope from it to DEEP_BED around the deep tiles.
 */
function depthOf(seed: number, x: number, z: number, shore: number, deep: number): number {
  if (shore <= 0) return 0;
  if (shore <= SHORE_SHALLOW) return SHALLOW_BED * smooth(shore / SHORE_SHALLOW);
  const far = Math.min(1, (shore - SHORE_SHALLOW) / (SHORE_SHELF - SHORE_SHALLOW));
  const shelf = SHALLOW_BED + (SHELF_BED - SHALLOW_BED) * far * (SHELF_EVEN + (1 - SHELF_EVEN) * noise2(seed ^ 0x51f3, x / SHELF_WAVE, z / SHELF_WAVE));
  // the slope never starts nearer the shore than the shelf's rim
  const down = deepSlope(seed, x, z, deep) * smooth((shore - SHORE_SHALLOW) / SHORE_SHALLOW);
  return shelf + (DEEP_BED - shelf) * down;
}

/** The share (0..1) of the way down to DEEP_BED at (x, z), `deep` tiles inside the DeepWater tiles' edge (negative: outside): the pond's slope into the deep, which the dungeon pools reuse (#448). */
export function deepSlope(seed: number, x: number, z: number, deep: number): number {
  const g = deep + (noise2(seed ^ 0x2d07, x / DEEP_WAVE, z / DEEP_WAVE) - 0.5) * 2 * DEEP_WOBBLE;
  return smooth((g + DEEP_OUT) / (DEEP_OUT + DEEP_INSIDE));
}

/** Squared distance transform of a 1D row (Felzenszwalb): `f` in, result in `out`. */
function edt1(f: Float64Array, out: Float64Array, n: number, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -1e30; z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0) k--; else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    out[q] = (q - p) * (q - p) + f[p];
  }
}

/** `viewMap` is the view copy (`pondViewMap`) when the caller has one already; else it is made here. */
export function pondField(rules: TileMap, pond: PondInfo, viewMap?: TileMap): PondField {
  const view = viewMap ?? pondViewMap(rules, pond);
  const R = FIELD_RES;
  const wet = (x: number, z: number): boolean => isWater(view.get(x, z));
  // The grids cover the water tiles and the streams' points with MARGIN tiles of land around: tile (ox, oz), bw x bh tiles.
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const grow = (x: number, z: number): void => { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); };
  const blobs = pond.blobs;
  for (let z = 0; z < view.h; z++) for (let x = 0; x < view.w; x++) if (wet(x, z)) grow(x, z);
  for (const [cx, cz, rx, rz] of blobs) { grow(Math.floor(cx - rx - 1), Math.floor(cz - rz - 1)); grow(Math.ceil(cx + rx + 1), Math.ceil(cz + rz + 1)); }
  for (const s of pond.streams) for (const [px, pz] of s.points) grow(Math.floor(px / 16), Math.floor(pz / 16));
  if (x0 === Infinity) { x0 = z0 = 0; x1 = z1 = -1; } // no water at all: empty grids
  const ox = x0 - MARGIN, oz = z0 - MARGIN, bw = Math.max(0, x1 - x0 + 1 + 2 * MARGIN), bh = Math.max(0, z1 - z0 + 1 + 2 * MARGIN);
  const W = bw * R, H = bh * R, n = Math.max(W, H, 1);
  // Sample (i, j) lies at tile point (ox + (i + 0.5) / R, oz + (j + 0.5) / R).
  const px = (i: number): number => ox + (i + 0.5) / R, pz = (j: number): number => oz + (j + 0.5) / R;

  /** Distance (samples) of every sample to the nearest sample where `zero` holds: two passes of the 1D transform. */
  const f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), zz = new Float64Array(n + 1);
  const distance = (zero: (k: number) => boolean): Float32Array => {
    const d2 = new Float64Array(W * H), out = new Float32Array(W * H);
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < H; j++) f[j] = zero(j * W + i) ? 0 : FAR;
      edt1(f, o, H, v, zz);
      for (let j = 0; j < H; j++) d2[j * W + i] = o[j];
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) f[i] = d2[j * W + i];
      edt1(f, o, W, v, zz);
      for (let i = 0; i < W; i++) out[j * W + i] = Math.sqrt(o[i]);
    }
    return out;
  };

  // The water tiles (for the limit below), and the pond's body: the server's own free shape, evaluated at every sample. `inside` is
  // about "tiles inside"; the mask is 0.5 on its zero line. `body` is the same with a wide ramp: how much of the pond is around.
  const tileWater = new Uint8Array(W * H), body = new Float32Array(W * H), mask = new Float32Array(W * H);
  for (let tz = 0; tz < bh; tz++) for (let tx = 0; tx < bw; tx++) {
    if (!wet(ox + tx, oz + tz)) continue;
    for (let j = tz * R; j < tz * R + R; j++) for (let i = tx * R; i < tx * R + R; i++) tileWater[j * W + i] = 1;
  }
  if (blobs.length) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = inside(blobs, pond.seed, px(i), pz(j));
    mask[j * W + i] = Math.min(1, Math.max(0, 0.5 + v / (2 * BODY_SOFT)));
    body[j * W + i] = Math.min(1, Math.max(0, 0.5 + v / (2 * BODY_WIDE)));
  }

  // The brooks join the body softly (1 - (1 - a)(1 - b)): brook and pond are one shape, with no notch at a mouth.
  /** Raises grid `g` around (cx, cz) to `value(distance)` within `reach` tiles. */
  const stamp = (g: Float32Array, cx: number, cz: number, reach: number, value: (d: number) => number): void => {
    const i0 = Math.max(0, Math.floor((cx - reach - ox) * R)), i1 = Math.min(W - 1, Math.ceil((cx + reach - ox) * R));
    const j0 = Math.max(0, Math.floor((cz - reach - oz) * R)), j1 = Math.min(H - 1, Math.ceil((cz + reach - oz) * R));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(px(i) - cx, pz(j) - cz);
      if (d < reach) g[j * W + i] = Math.max(g[j * W + i], value(d));
    }
  };
  // A brook: a channel along a smooth curve through the stream's points. Its half-width swells and narrows along its length, its
  // edge is uneven (both seeded), and it opens toward the pond.
  const channel = new Float32Array(W * H);
  for (const [si, s] of pond.streams.entries()) {
    const widthSeed = (pond.seed + 7919 * (si + 1)) >>> 0;
    const curve = streamCurve(s.points.map(([qx, qz]) => [qx / 16, qz / 16] as [number, number]));
    if (curve.length < 2) continue;
    const len = [0];
    for (let k = 1; k < curve.length; k++) len.push(len[k - 1] + Math.hypot(curve[k][0] - curve[k - 1][0], curve[k][1] - curve[k - 1][1]));
    const total = len[len.length - 1];
    for (let k = 1; k < curve.length; k++) {
      const [ax, az] = curve[k - 1], [bx, bz] = curve[k], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
      const reach = MOUTH_HALF + STREAM_SOFT + EDGE_ROUGH;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - ox) * R)), i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + reach - ox) * R));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - oz) * R)), j1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + reach - oz) * R));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const t = Math.min(1, Math.max(0, ((px(i) - ax) * ex + (pz(j) - az) * ez) / l2));
        const d = Math.hypot(px(i) - (ax + ex * t), pz(j) - (az + ez * t)) + (noise2(widthSeed ^ 0x5bd1, px(i) / EDGE_WAVE, pz(j) / EDGE_WAVE) - 0.5) * 2 * EDGE_ROUGH;
        // the half-width: its own swell along the length, opening toward the stream's pond end (an inflow's last point, an outflow's first)
        const along = len[k - 1] + (len[k] - len[k - 1]) * t, toPond = s.inflow ? total - along : along;
        const own = BROOK_MIN + (BROOK_MAX - BROOK_MIN) * noise2(widthSeed, along / BROOK_WAVE, 0.5);
        const half = own + (MOUTH_HALF - own) * smooth(1 - toPond / MOUTH_LEN);
        const m = Math.min(1, Math.max(0, 0.5 + (half - d) / (2 * STREAM_SOFT)));
        if (m > channel[j * W + i]) channel[j * W + i] = m;
      }
    }
  }
  for (let k = 0; k < W * H; k++) mask[k] = 1 - (1 - mask[k]) * (1 - channel[k]);
  // No drawn water far outside the water tiles: the mask fades between CLIP_NEAR and CLIP_FAR tiles from them.
  const fromTiles = distance((k) => tileWater[k] === 1);
  for (let k = 0; k < W * H; k++) mask[k] *= 1 - smooth((fromTiles[k] / R - CLIP_NEAR) / (CLIP_FAR - CLIP_NEAR));
  // A hollow under every DeepWater tile (where the wobbled shore comes near one): a little deeper than DEEP_MIN at the centre, because the bilinear read between samples loses some.
  const deepFloor = new Float32Array(W * H), tileDeep = new Uint8Array(W * H);
  for (let tz = 0; tz < bh; tz++) for (let tx = 0; tx < bw; tx++) {
    if (view.get(ox + tx, oz + tz) !== TILE_ID.DeepWater) continue;
    for (let j = tz * R; j < tz * R + R; j++) for (let i = tx * R; i < tx * R + R; i++) tileDeep[j * W + i] = 1;
    stamp(deepFloor, ox + tx + 0.5, oz + tz + 0.5, DEEP_PIT, (d) => DEEP_MIN * 1.15 * smooth(1 - d / DEEP_PIT));
  }
  // Tiles inside the DeepWater tiles (negative: outside them; far outside where the pond has none).
  const deepIn = distance((k) => tileDeep[k] === 0), deepOut = distance((k) => tileDeep[k] === 1);
  for (let k = 0; k < W * H; k++) deepIn[k] = tileDeep[k] ? (deepIn[k] - 0.5) / R : -Math.min(99, (deepOut[k] - 0.5) / R);

  // The drawn shore: where the mask crosses 0.5. Distances to it, inside and outside (a sample's centre lies half a sample from the shore between it and its neighbour).
  const drawn = (k: number): boolean => mask[k] > 0.5;
  const shore = distance((k) => !drawn(k)), bank = distance(drawn);
  for (let k = 0; k < W * H; k++) {
    shore[k] = drawn(k) ? Math.max(0, (shore[k] - 0.5) / R) : 0;
    bank[k] = drawn(k) ? 0 : Math.max(0, (bank[k] - 0.5) / R);
  }

  /** Bilinear read of a grid at tile point (x, z); `outside` beyond the grids. */
  const read = (g: Float32Array, outside: number) => (x: number, z: number): number => {
    const u = (x - ox) * R - 0.5, w = (z - oz) * R - 0.5;
    if (W < 2 || H < 2 || u < 0 || w < 0 || u > W - 1 || w > H - 1) return outside;
    const i = Math.min(W - 2, Math.floor(u)), j = Math.min(H - 2, Math.floor(w)), fx = u - i, fz = w - j;
    const a = g[j * W + i] * (1 - fx) + g[j * W + i + 1] * fx;
    const b = g[(j + 1) * W + i] * (1 - fx) + g[(j + 1) * W + i + 1] * fx;
    return a * (1 - fz) + b * fz;
  };
  const shoreAt = read(shore, 0), deepAt = read(deepFloor, 0), deepInAt = read(deepIn, -99);

  // Streams as segments of the current: the stream's own (full strength) and, past an inflow's mouth or before an outflow's first
  // point, an extension of the end segment into the pond that fades over FADE tiles. `fadeFrom` is the extension's end that keeps
  // full strength (0 = a, 1 = b); none for a stream's own segments.
  interface Seg { ax: number; az: number; bx: number; bz: number; fadeFrom: 0 | 1 | null }
  const segs: Seg[] = [];
  const mouths: Mouth[] = [];
  for (const s of pond.streams) {
    const pts = s.points.map(([px, pz]) => [px / 16, pz / 16] as [number, number]);
    for (let i = 1; i < pts.length; i++) segs.push({ ax: pts[i - 1][0], az: pts[i - 1][1], bx: pts[i][0], bz: pts[i][1], fadeFrom: null });
    if (pts.length < 2) continue;
    const dirOf = (p: [number, number], q: [number, number]) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      return { dx: (q[0] - p[0]) / len, dz: (q[1] - p[1]) / len };
    };
    if (s.inflow) {
      const p = pts[pts.length - 1], { dx, dz } = dirOf(pts[pts.length - 2], p);
      mouths.push({ x: p[0], z: p[1], dx, dz });
      segs.push({ ax: p[0], az: p[1], bx: p[0] + dx * FADE, bz: p[1] + dz * FADE, fadeFrom: 0 });
    } else {
      const p = pts[0], { dx, dz } = dirOf(p, pts[1]);
      segs.push({ ax: p[0] - dx * FADE, az: p[1] - dz * FADE, bx: p[0], bz: p[1], fadeFrom: 1 });
    }
  }

  const flowAt = (x: number, z: number): { x: number; z: number; s: number } => {
    let best = { x: 0, z: 0, s: 0 };
    for (const g of segs) {
      const ex = g.bx - g.ax, ez = g.bz - g.az, len2 = ex * ex + ez * ez || 1;
      const t = Math.min(1, Math.max(0, ((x - g.ax) * ex + (z - g.az) * ez) / len2));
      const d = Math.hypot(x - (g.ax + ex * t), z - (g.az + ez * t));
      let s = 1 - Math.min(1, Math.max(0, (d - CORE) / (REACH - CORE)));
      if (g.fadeFrom !== null) s *= g.fadeFrom === 0 ? 1 - t : t;
      if (s <= best.s) continue;
      const len = Math.sqrt(len2);
      best = { x: ex / len, z: ez / len, s };
    }
    return best;
  };

  const decks: Deck[] = pond.bridges.map(deckOf);
  const deckAt = (x: number, z: number): number | null => {
    for (const d of decks) {
      const gx = d.alongX ? DECK_GROW : 0, gz = d.alongX ? 0 : DECK_GROW;
      if (x >= d.x0 - gx && x <= d.x1 + gx && z >= d.z0 - gz && z <= d.z1 + gz) return d.y;
    }
    return null;
  };

  return {
    shoreAt, bankAt: read(bank, MARGIN), wetAt: read(mask, 0), bodyAt: read(body, 0),
    // the hollow of a DeepWater tile only inside the drawn water
    depthAt: (x, z) => { const s = shoreAt(x, z); return s > 0 ? Math.max(depthOf(pond.seed, x, z, s, deepInAt(x, z)), deepAt(x, z) * smooth(s / DEEP_RAMP)) : 0; },
    flowAt, deckAt, mouths, decks, seed: pond.seed, box: { x0: ox, z0: oz, x1: ox + bw, z1: oz + bh },
  };
}

/** Smooth value noise in 0..1 on the unit lattice, from the pond shape's hash. */
function noise2(seed: number, x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z), u = smooth(x - i), w = smooth(z - j);
  const a = lattice(seed, i, j) * (1 - u) + lattice(seed, i + 1, j) * u, b = lattice(seed, i, j + 1) * (1 - u) + lattice(seed, i + 1, j + 1) * u;
  return (a * (1 - w) + b * w) * 0.5 + 0.5;
}

/** A smooth curve through a stream's points (uniform Catmull-Rom, CURVE_STEPS straight pieces per span; the end points doubled). */
function streamCurve(p: [number, number][]): [number, number][] {
  if (p.length < 3) return p;
  const out: [number, number][] = [p[0]];
  const at = (k: number): [number, number] => p[Math.min(p.length - 1, Math.max(0, k))];
  for (let k = 0; k + 1 < p.length; k++) {
    const a = at(k - 1), b = at(k), c = at(k + 1), d = at(k + 2);
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS, t2 = t * t, t3 = t2 * t;
      const cr = (i: 0 | 1): number => 0.5 * (2 * b[i] + (c[i] - a[i]) * t + (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t2 + (3 * b[i] - a[i] - 3 * c[i] + d[i]) * t3);
      out.push([cr(0), cr(1)]);
    }
  }
  return out;
}

function deckOf(b: BridgeInfo): Deck {
  const [x, z, w, h] = b.rect;
  return { x0: x, z0: z, x1: x + w, z1: z + h, alongX: b.along_x, road: b.road, y: DECK_Y };
}

/** A copy of the map for drawing: a bridge's tiles are ShallowWater, so the bed and the water run on under the deck. */
export function pondViewMap(rules: TileMap, pond: PondInfo): TileMap {
  const view = new TileMap(rules.w, rules.h, rules.tiles.slice());
  for (const b of pond.bridges) {
    const [x, z, w, h] = b.rect;
    for (let j = z; j < z + h; j++) for (let i = x; i < x + w; i++) view.set(i, j, TILE_ID.ShallowWater);
  }
  return view;
}

// Spike (#348): the shape of the ?r3d=pond page's lake and stream. Pure maths, no three.js: a smooth "how far inside the water"
// function, the bed's depth, the stream's flow, the tile maps cut from them and the bytes of the field texture the water shader reads.
// Tile coordinates, x east, z south. Hand-laid; a real feature would get its water from the server's generator.
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';

export const POND_W = 46;
export const POND_H = 32;
/** The road's two rows, south of the lake. */
export const POND_ROAD = [25, 26] as const;
export const POND_START = { x: 22.5, z: 22.5 } as const;
/** The deepest bed (tiles below the surface): the field's red channel is depth / DEPTH_MAX. */
export const DEPTH_MAX = 2.4;
/** Field texels per tile. */
export const FIELD_RES = 4;
/** The field's green channel holds `inside` as 0.5 + inside / INSIDE_SPAN, clamped. */
export const INSIDE_SPAN = 4;

/** The lake: overlapping ellipses [cx, cz, rx, rz]. */
const LAKE: [number, number, number, number][] = [[20, 13.5, 8.5, 5.2], [28, 15, 5.2, 3.6], [13.5, 11.5, 4.6, 3.2], [23, 10.5, 5, 3]];
/** The stream's course from the forest edge down into the lake's east end. */
const STREAM: [number, number][] = [[41.5, 1.5], [39, 4], [40, 6.5], [37, 8.5], [35.5, 10.5], [32.5, 12], [30, 14]];
const STREAM_HALF = 0.75;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (x: number, z: number): number => {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Value noise, 0..1. */
export function noise2(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tiles inside the lake's outline (negative outside), with a wobbling edge. */
export function lakeInside(x: number, z: number): number {
  let s = -Infinity;
  for (const [cx, cz, rx, rz] of LAKE) s = Math.max(s, (1 - Math.hypot((x - cx) / rx, (z - cz) / rz)) * Math.min(rx, rz));
  return s + (noise2(x * 0.45, z * 0.45) - 0.5) * 1.6 + (noise2(x * 1.3 + 9, z * 1.3) - 0.5) * 0.4;
}

/** The nearest point of the stream's course: tiles inside the stream (negative outside) and the flow direction there (unit, downstream). */
export function streamAt(x: number, z: number): { inside: number; fx: number; fz: number } {
  let best = Infinity, fx = 0, fz = 0;
  for (let i = 0; i + 1 < STREAM.length; i++) {
    const [ax, az] = STREAM[i], [bx, bz] = STREAM[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const k = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(x - ax - dx * k, z - az - dz * k);
    if (d < best) { best = d; const l = Math.sqrt(l2); fx = dx / l; fz = dz / l; }
  }
  const wobble = (noise2(x * 0.9 + 3, z * 0.9 + 7) - 0.5) * 0.5;
  return { inside: STREAM_HALF + wobble - best, fx, fz };
}

/** Tiles inside any water (negative outside). */
export function inside(x: number, z: number): number {
  return Math.max(lakeInside(x, z), streamAt(x, z).inside);
}

/** The bed's depth below the surface (tiles): a shallow rim, a large deep part in the lake, a shallow stream. */
export function depthAt(x: number, z: number): number {
  const l = lakeInside(x, z), s = streamAt(x, z).inside;
  const lake = 0.5 * smooth(0, 1.4, l) + (DEPTH_MAX - 0.5) * smooth(1.9, 5, l);
  const stream = 0.4 * smooth(0, 0.55, s);
  return Math.max(lake, stream);
}

/** The current (tiles of flow, 0..1 strength times the direction): the stream's, fading out inside the lake. */
export function flowAt(x: number, z: number): [number, number] {
  const s = streamAt(x, z);
  const k = smooth(-0.1, 0.35, s.inside) * (1 - smooth(0.6, 2.6, lakeInside(x, z)));
  return [s.fx * k, s.fz * k];
}

/** Uphill of `inside`: the unit direction toward deeper water. */
export function inward(x: number, z: number): [number, number] {
  const e = 0.25;
  const gx = inside(x + e, z) - inside(x - e, z), gz = inside(x, z + e) - inside(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

export interface PondMaps {
  /** The rules: ShallowWater and DeepWater tiles, what the knight walks on and the figures wade in. */
  rules: TileMap;
  /** What the view draws: the water tiles as Floor (the water is the spike's own mesh, not the 2D tiles). */
  view: TileMap;
  /** What the ground is painted from: the water and its bank as Road, so no grass grows there and the bank is bare earth. */
  paint: TileMap;
}

/** The trees' trunk tiles [x, z]: a row along the forest edge and a few around the lake. */
export const POND_TREES: [number, number][] = [[4, 3], [10, 3], [16, 3], [23, 3], [29, 3], [35, 3], [6, 8], [44, 9], [3, 16], [36, 20], [8, 21], [42, 16]];

export function pondMaps(): PondMaps {
  const base = new Uint8Array(POND_W * POND_H).fill(TILE_ID.Floor);
  const row = (z: number, tile: number): void => { base.fill(tile, z * POND_W, (z + 1) * POND_W); };
  row(0, TILE_ID.Void);
  row(1, TILE_ID.Thicket);
  row(2, TILE_ID.Thicket);
  for (const z of POND_ROAD) row(z, TILE_ID.Road);
  row(POND_H - 1, TILE_ID.Void);
  for (const [x, z] of POND_TREES) base[z * POND_W + x] = TILE_ID.Trunk;
  const rules = base.slice(), view = base.slice(), paint = base.slice();
  for (let z = 1; z < POND_H - 1; z++) for (let x = 0; x < POND_W; x++) {
    const i = z * POND_W + x, cx = x + 0.5, cz = z + 0.5;
    const s = inside(cx, cz);
    if (s > 0.1) { paint[i] = TILE_ID.Road; if (view[i] !== TILE_ID.Floor) view[i] = TILE_ID.Floor; if (rules[i] !== TILE_ID.Floor) rules[i] = TILE_ID.Floor; }
    if (s > 0.3) rules[i] = depthAt(cx, cz) > 0.9 ? TILE_ID.DeepWater : TILE_ID.ShallowWater;
  }
  return { rules: new TileMap(POND_W, POND_H, rules), view: new TileMap(POND_W, POND_H, view), paint: new TileMap(POND_W, POND_H, paint) };
}

/** The field texture's bytes (RGBA, `FIELD_RES` texels per tile, row 0 at z 0): depth, inside, flow x and z. */
export function fieldBytes(): { w: number; h: number; data: Uint8Array } {
  const w = POND_W * FIELD_RES, h = POND_H * FIELD_RES;
  const data = new Uint8Array(w * h * 4);
  const byte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = (i + 0.5) / FIELD_RES, z = (j + 0.5) / FIELD_RES, o = (j * w + i) * 4;
    const [fx, fz] = flowAt(x, z);
    data[o] = byte(depthAt(x, z) / DEPTH_MAX);
    data[o + 1] = byte(0.5 + inside(x, z) / INSIDE_SPAN);
    data[o + 2] = byte(0.5 + fx * 0.5);
    data[o + 3] = byte(0.5 + fz * 0.5);
  }
  return { w, h, data };
}

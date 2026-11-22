// The stone field (#380): the stone kind of every map cell, and how far a point is rock rather than laid stone.
// Pure data: it imports no three.
import { TILE_ID } from '../../generated/defs';
import type { TileMap } from '../../sim/map';
import { tilesSeed } from '../cover/moss';
import { heightAt } from '../heights';

/** Stone pixels per tile in the stone sheets (a page is one chunk, 512 by 512 px). */
export const STONE_PX = 32;
/** The kinds: laid masonry and natural rock. Mirrors the server's one byte per tile. */
export const LAID = 0, ROCK = 1;
/** How far the sampling points sit from the asked point along each axis (tiles): the border spans about two tiles. */
export const SMOOTH_REACH = 0.5;
/** The largest shift of the sampling point by the wobble (tiles): it makes the border line irregular. */
export const WOBBLE = 0.4;
/** The size of one wobble feature (tiles). */
export const WOBBLE_CELL = 3;
/** Within this distance of a door cell centre a point is laid stone (tiles); the built frame of a door in rock. */
export const DOOR_CLEAR = 1.5;
/** Beyond `DOOR_CLEAR`, the rock comes back over this distance (tiles). */
export const DOOR_FADE = 1;

export interface StoneField { w: number; h: number; kinds: Uint8Array; seed: number }

/** `kinds` null, undefined or of the wrong length: all laid. `seed` defaults to `tilesSeed(map)`. */
export function stoneField(map: TileMap, kinds?: Uint8Array | null, seed?: number): StoneField {
  const n = map.w * map.h;
  const ok = kinds != null && kinds.length === n;
  return { w: map.w, h: map.h, kinds: ok ? kinds : new Uint8Array(n), seed: seed ?? tilesSeed(map) };
}

/** The kind of cell (x, z), clamped to the map. */
export function kindAt(f: StoneField, x: number, z: number): 0 | 1 {
  const cx = Math.min(f.w - 1, Math.max(0, Math.floor(x)));
  const cz = Math.min(f.h - 1, Math.max(0, Math.floor(z)));
  return f.kinds[cz * f.w + cx] === ROCK ? ROCK : LAID;
}

/** A hash of the seed and three integers in [0, 1). */
export function hash(seed: number, a: number, b: number, c: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(b + 0x165667b1, 0x27d4eb2f) ^ Math.imul(c + 0x1b873593, 0x85ebca77);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1] on a grid of `WOBBLE_CELL` tiles; `c` picks the channel. */
function wobble(seed: number, x: number, z: number, c: number): number {
  const gx = x / WOBBLE_CELL, gz = z / WOBBLE_CELL;
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const fx = gx - x0, fz = gz - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const v = (i: number, j: number): number => hash(seed, x0 + i, z0 + j, c) * 2 - 1;
  const top = v(0, 0) + (v(1, 0) - v(0, 0)) * sx;
  const bottom = v(0, 1) + (v(1, 1) - v(0, 1)) * sx;
  return top + (bottom - top) * sz;
}

/** The kinds as a smooth field: bilinear between the cell centres. */
function bilinear(f: StoneField, x: number, z: number): number {
  const gx = x - 0.5, gz = z - 0.5;
  const x0 = Math.floor(gx), z0 = Math.floor(gz);
  const fx = gx - x0, fz = gz - z0;
  const k = (i: number, j: number): number => kindAt(f, x0 + i, z0 + j);
  const top = k(0, 0) + (k(1, 0) - k(0, 0)) * fx;
  const bottom = k(0, 1) + (k(1, 1) - k(0, 1)) * fx;
  return top + (bottom - top) * fz;
}

/** The distance from (x, z) to the nearest door cell centre, or Infinity beyond `reach` tiles. */
function doorDistance(map: TileMap, x: number, z: number, reach: number): number {
  let best = Infinity;
  const r = Math.ceil(reach);
  const cx = Math.floor(x), cz = Math.floor(z);
  for (let j = cz - r; j <= cz + r; j++) for (let i = cx - r; i <= cx + r; i++) {
    const t = map.get(i, j);
    if (t !== TILE_ID.DoorClosed && t !== TILE_ID.DoorOpen) continue;
    best = Math.min(best, Math.hypot(i + 0.5 - x, j + 0.5 - z));
  }
  return best;
}

/** 0 laid .. 1 rock at a point in tiles: the kinds smoothed over about two tiles along a wobbling line; 0 within `DOOR_CLEAR` of a door cell. */
export function rockAmount(f: StoneField, map: TileMap, x: number, z: number): number {
  const px = x + wobble(f.seed, x, z, 0) * WOBBLE;
  const pz = z + wobble(f.seed, x, z, 1) * WOBBLE;
  let sum = 0;
  for (const dz of [-SMOOTH_REACH, SMOOTH_REACH]) for (const dx of [-SMOOTH_REACH, SMOOTH_REACH]) sum += bilinear(f, px + dx, pz + dz);
  const amount = sum / 4;
  if (amount === 0) return 0;
  const d = doorDistance(map, x, z, DOOR_CLEAR + DOOR_FADE);
  if (d <= DOOR_CLEAR) return 0;
  return amount * Math.min(1, (d - DOOR_CLEAR) / DOOR_FADE);
}

/** Whether the wall cell (x, z) is shaped as natural rock (`shape.ts`): there is rock at its middle. Every other wall cell is upright masonry. */
export function rockWall(f: StoneField, map: TileMap, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < map.w && z < map.h && heightAt(map, x, z) > 0 && rockAmount(f, map, x + 0.5, z + 0.5) > 0;
}

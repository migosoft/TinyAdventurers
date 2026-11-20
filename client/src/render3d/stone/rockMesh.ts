// SPIKE (#380), throwaway: natural rock walls as a height field instead of square blocks. A wall cell beside open ground is a
// patch of 8 x 8 quads whose height rises from 0 at the cell's open edge to the wall's height within `REACH` tiles, gently at the
// foot and steeply above it, with a wobbling contour. The slope lies inside the wall's own cell, so open ground stays as wide as
// the server's. Corners come out rounded because the height follows the distance to the nearest open cell.
import { WALL_H, heightAt } from '../heights';
import type { TileMap } from '../../sim/map';
import { STONE_SPIKE } from './stoneNodes';
import { MOSAIC, STONE_LEVEL, crackDepth, rockAmount } from './stoneMap';

export const KIND_ROCK = 4;
const N = 8;
const REACH = 0.36;

const hash = (x: number, z: number): number => {
  let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
/** Smooth value noise, 0..1. */
function noise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** The rock's height at a world point inside the solid part of the map. */
export function rockHeight(m: TileMap, x: number, z: number): number {
  const cx = Math.min(m.w - 1, Math.max(0, Math.floor(x - 1e-6))), cz = Math.min(m.h - 1, Math.max(0, Math.floor(z - 1e-6)));
  let d = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ox = cx + dx, oz = cz + dz;
    if (heightAt(m, ox, oz) > 0) continue;
    const px = Math.max(ox - x, 0, x - (ox + 1)), pz = Math.max(oz - z, 0, z - (oz + 1));
    d = Math.min(d, Math.hypot(px, pz));
  }
  // Also the cell the point sits on the edge of (a vertex on a border belongs to both cells).
  for (const [ox, oz] of [[Math.floor(x + 1e-6), cz], [cx, Math.floor(z + 1e-6)], [Math.floor(x + 1e-6), Math.floor(z + 1e-6)]]) {
    if (heightAt(m, ox, oz) === 0) d = 0;
  }
  if (d <= 0) return 0;
  const a = rockAmount(x, z);
  const wob = (noise(x * 2.3, z * 2.3) - 0.5) * 0.3 + (noise(x * 6.1 + 9, z * 6.1) - 0.5) * 0.1;
  const t = Math.min(1, Math.max(0, (d + wob * a * Math.min(1, d * 6)) / (REACH * a + 0.02)));
  return WALL_H * (0.14 * t + 0.86 * Math.pow(t, 2.4));
}

/** Whether a wall cell is drawn as a rock patch: it has rock in it and open ground among its eight neighbours. */
export function isRockCell(m: TileMap, x: number, z: number): boolean {
  if (!STONE_SPIKE.enabled || heightAt(m, x, z) === 0) return false;
  if (rockAmount(x, z) <= 0 && rockAmount(x + 1, z) <= 0 && rockAmount(x, z + 1) <= 0 && rockAmount(x + 1, z + 1) <= 0) return false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (heightAt(m, x + dx, z + dz) === 0) return true;
  return false;
}

/** Pushes the patch of the wall cell (x, z): positions, smooth normals, kind `KIND_ROCK`; uv and rect are 0. */
export function pushRockCell(s: { position: number[]; uv: number[]; normal: number[]; kind: number[]; rect: number[] }, m: TileMap, x: number, z: number): void {
  const H = (px: number, pz: number): number => rockHeight(m, px, pz);
  const vert = (i: number, j: number): number[] => {
    const px = x + i / N, pz = z + j / N, e = 0.03;
    const h = H(px, pz);
    const gx = (H(px + e, pz) - H(px - e, pz)) / (2 * e), gz = (H(px, pz + e) - H(px, pz - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gz);
    return [px, h, pz, -gx / l, 1 / l, -gz / l];
  };
  const grid: number[][] = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) grid.push(vert(i, j));
  const put = (v: number[]): void => {
    s.position.push(v[0], v[1], v[2]);
    s.normal.push(v[3], v[4], v[5]);
    s.uv.push(0, 0);
    s.kind.push(KIND_ROCK);
    s.rect.push(0, 0, 0, 0);
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const p00 = grid[j * (N + 1) + i], p10 = grid[j * (N + 1) + i + 1], p01 = grid[(j + 1) * (N + 1) + i], p11 = grid[(j + 1) * (N + 1) + i + 1];
    for (const v of [p00, p01, p11, p00, p11, p10]) put(v);
  }
}

// ---- The floor (second step of the spike): slight unevenness and wider cracks as real geometry. ----
// The floor only ever dips below 0, never rises: shadows, decals and feet at height 0 are never buried.

/** Distance (tiles) from a point on open ground to the nearest solid cell, at most 1. */
function solidDist(m: TileMap, x: number, z: number): number {
  const cx = Math.floor(x), cz = Math.floor(z);
  let d = 1;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const ox = cx + dx, oz = cz + dz;
    if (heightAt(m, ox, oz) === 0) continue;
    d = Math.min(d, Math.hypot(Math.max(ox - x, 0, x - (ox + 1)), Math.max(oz - z, 0, z - (oz + 1))));
  }
  return d;
}

/** A puddle basin's depth share at a point, 0..1: blobs in the rock floor. */
export function puddle(x: number, z: number): number {
  const p = noise(x * 0.55 + 70, z * 0.55 + 20);
  const t = Math.min(1, Math.max(0, (p - 0.66) / 0.05));
  return t * t * (3 - 2 * t) * Math.min(1, Math.max(0, rockAmount(x, z) * 2 - 1));
}

/** The floor's height at a point of open ground: 0 or a little below. */
export function floorHeight(m: TileMap, x: number, z: number): number {
  const fade = Math.min(1, solidDist(m, x, z) * 5);
  if (fade <= 0) return 0;
  const c = STONE_LEVEL.circle;
  // Level ground under the summoning circle, the mosaic and the grate.
  if (Math.hypot(x - c.x, z - c.z) < c.r + 0.15) return 0;
  if (Math.abs(x - MOSAIC.x) < MOSAIC.hx + 0.1 && Math.abs(z - MOSAIC.z) < MOSAIC.hz + 0.1) return 0;
  const a = rockAmount(x, z);
  const rough = (noise(x * 1.7, z * 1.7) * 0.7 + noise(x * 4.3 + 5, z * 4.3) * 0.3) * (0.015 + 0.025 * a);
  return -(rough + puddle(x, z) * 0.05 + crackDepth(x, z) * 0.3) * fade;
}

/** Pushes the patch of the floor cell (x, z), as `pushRockCell` does for a wall cell. */
export function pushFloorCell(s: { position: number[]; uv: number[]; normal: number[]; kind: number[]; rect: number[] }, m: TileMap, x: number, z: number): void {
  const H = (px: number, pz: number): number => (heightAt(m, Math.min(m.w - 1, Math.floor(px)), Math.min(m.h - 1, Math.floor(pz))) > 0 ? 0 : floorHeight(m, px, pz));
  // A fine grid only where a crevice runs through the cell; elsewhere the slight unevenness needs few quads.
  let fine = false;
  for (let j = 0; j <= 6 && !fine; j++) for (let i = 0; i <= 6; i++) if (crackDepth(x + i / 6, z + j / 6) > 0) { fine = true; break; }
  const NF = fine ? 16 : 8;
  const grid: number[][] = [];
  for (let j = 0; j <= NF; j++) for (let i = 0; i <= NF; i++) {
    const px = x + i / NF, pz = z + j / NF, e = 0.03;
    const onEdge = (i === 0 || i === NF || j === 0 || j === NF) && solidDist(m, px, pz) <= 0;
    const h = onEdge ? 0 : floorHeight(m, px, pz);
    const gx = (H(px + e, pz) - H(px - e, pz)) / (2 * e), gz = (H(px, pz + e) - H(px, pz - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gz);
    grid.push([px, h, pz, -gx / l, 1 / l, -gz / l]);
  }
  for (let j = 0; j < NF; j++) for (let i = 0; i < NF; i++) {
    const p00 = grid[j * (NF + 1) + i], p10 = grid[j * (NF + 1) + i + 1], p01 = grid[(j + 1) * (NF + 1) + i], p11 = grid[(j + 1) * (NF + 1) + i + 1];
    for (const v of [p00, p01, p11, p00, p11, p10]) {
      s.position.push(v[0], v[1], v[2]);
      s.normal.push(v[3], v[4], v[5]);
      s.uv.push(0, 0);
      s.kind.push(KIND_ROCK);
      s.rect.push(0, 0, 0, 0);
    }
  }
}

// ---- Crystals: clusters of six-sided shards with pointed tips, drawn by the world material as glowing gems (kind 5). ----
export const KIND_CRYSTAL = 5;

/** Pushes the crystal clusters whose foot lies in [x0, x1) x [z0, z1). uv.y is the height share along a shard, rect the colour. */
export function pushCrystals(s: { position: number[]; uv: number[]; normal: number[]; kind: number[]; rect: number[] }, x0: number, z0: number, x1: number, z1: number): void {
  STONE_LEVEL.crystals.forEach((c, ci) => {
    if (c.x < x0 || c.x >= x1 || c.z < z0 || c.z >= z1) return;
    let seed = (ci + 1) * 7919;
    const r = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const m = Math.max(c.r, c.g, c.b);
    const col = [c.r / m, c.g / m, c.b / m];
    const tri = (a: number[], b: number[], d: number[], axis: number[]): void => {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      const out = (a[0] + b[0] + d[0]) / 3 - axis[0], outZ = (a[2] + b[2] + d[2]) / 3 - axis[2];
      let vs = [a, b, d];
      if (n[0] * out + n[2] * outZ < 0) {
        n = [-n[0], -n[1], -n[2]];
        vs = [a, d, b];
      }
      for (const v of vs) {
        s.position.push(v[0], v[1], v[2]);
        s.normal.push(n[0], n[1], n[2]);
        s.uv.push(0, v[3]);
        s.kind.push(KIND_CRYSTAL);
        s.rect.push(col[0], col[1], col[2], 1);
      }
    };
    const shards = 6;
    for (let i = 0; i < shards; i++) {
      const ang = (i / shards) * Math.PI * 2 + r() * 0.8, off = i === 0 ? 0 : 0.08 + r() * 0.12;
      const bx = c.x + Math.cos(ang) * off, bz = c.z + Math.sin(ang) * off;
      const rad = i === 0 ? 0.11 : 0.045 + r() * 0.05, h = i === 0 ? 0.85 : 0.3 + r() * 0.4;
      const lean = i === 0 ? 0.05 : 0.25 + r() * 0.3;
      const tx = bx + Math.cos(ang) * lean * h, tz = bz + Math.sin(ang) * lean * h;
      const ax = bx + Math.cos(ang) * lean * (h + rad * 2.2), az = bz + Math.sin(ang) * lean * (h + rad * 2.2);
      const turn = r() * 1.05;
      const ring = (cx: number, y: number, cz: number, v: number): number[][] => Array.from({ length: 6 }, (_, k) => [cx + Math.cos(turn + (k * Math.PI) / 3) * rad, y, cz + Math.sin(turn + (k * Math.PI) / 3) * rad, v]);
      const lo = ring(bx, -0.05, bz, 0), hi = ring(tx, h, tz, 0.8), apex = [ax, h + rad * 2.2, az, 1];
      for (let k = 0; k < 6; k++) {
        const k2 = (k + 1) % 6, axis = [(bx + tx) / 2, 0, (bz + tz) / 2];
        tri(lo[k], lo[k2], hi[k2], axis);
        tri(lo[k], hi[k2], hi[k], axis);
        tri(hi[k], hi[k2], apex, axis);
      }
    }
  });
}

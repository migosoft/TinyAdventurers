import type { TileMap } from '../../sim/map';
import { BED_RES, bedAt, inDipMesh, isWater, maskAt } from '../dips/shape';

/** Two floats per texel (bed height, water mask) on a grid of BED_RES texels per tile: (map.w * BED_RES + 1) by (map.h * BED_RES + 1), row by row. */
export interface WaterField { w: number; h: number; data: Float32Array }

/** Writes the texel (i, j): bedAt and the water mask at (i / BED_RES, j / BED_RES), or (0, 0) where no touching cell is in the dip mesh. */
function setTexel(f: WaterField, map: TileMap, i: number, j: number): void {
  const x = i / BED_RES, z = j / BED_RES;
  const k = 2 * (j * f.w + i);
  // The cells a grid point touches: one inside a cell, two on an edge, four on a corner.
  let touches = false;
  for (let cz = Math.ceil(z) - 1; cz <= Math.floor(z) && !touches; cz++) {
    for (let cx = Math.ceil(x) - 1; cx <= Math.floor(x); cx++) {
      if (inDipMesh(map, cx, cz)) { touches = true; break; }
    }
  }
  f.data[k] = touches ? bedAt(map, x, z) : 0;
  f.data[k + 1] = touches ? maskAt(map, x, z, isWater) : 0;
}

/** bedAt and maskAt(isWater) at every grid point (i / BED_RES, j / BED_RES). A point none of whose touching cells is inDipMesh is (0, 0) without evaluating. */
export function waterField(map: TileMap): WaterField {
  const w = map.w * BED_RES + 1, h = map.h * BED_RES + 1;
  const f: WaterField = { w, h, data: new Float32Array(2 * w * h) };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setTexel(f, map, i, j);
  return f;
}

/** Recomputes the texels a change of cell (x, z) can reach: grid points with x - 1 <= i / BED_RES <= x + 2, the same in z, clamped to the grid. */
export function refreshWaterField(f: WaterField, map: TileMap, x: number, z: number): void {
  const i0 = Math.max(0, (x - 1) * BED_RES), i1 = Math.min(f.w - 1, (x + 2) * BED_RES);
  const j0 = Math.max(0, (z - 1) * BED_RES), j1 = Math.min(f.h - 1, (z + 2) * BED_RES);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) setTexel(f, map, i, j);
}

/** Bilinear, clamp-to-edge read at (x, z) tiles: the CPU twin of the shader's filtered sample. */
export function sampleWaterField(f: WaterField, x: number, z: number): { bed: number; mask: number } {
  const u = Math.min(f.w - 1, Math.max(0, x * BED_RES)), v = Math.min(f.h - 1, Math.max(0, z * BED_RES));
  const i = Math.min(f.w - 2, Math.floor(u)), j = Math.min(f.h - 2, Math.floor(v));
  const fx = u - i, fz = v - j;
  const mix = (c: number) => {
    const at = (a: number, b: number) => f.data[2 * (b * f.w + a) + c];
    const top = at(i, j) * (1 - fx) + at(i + 1, j) * fx;
    const bot = at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx;
    return top * (1 - fz) + bot * fz;
  };
  return { bed: mix(0), mask: mix(1) };
}

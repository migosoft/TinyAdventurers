import type { TileMap } from '../../sim/map';
import { DIP, WATER_LEVEL, dipOf } from '../dips/shape';
import { cellHeight } from '../heights';
import { CHUNK } from '../worldMesh';

/** A height-0 cell that is water, or has a water tile among its eight neighbours (the rounded outline reaches into those). */
export function waterCell(map: TileMap, x: number, z: number): boolean {
  if (cellHeight(map.get(x, z)) !== 0) return false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (dipOf(map.get(x + dx, z + dz)) === DIP.water) return true;
  }
  return false;
}

export interface WaterChunk { cx: number; cz: number; position: Float32Array; count: number }

/** Two triangles per waterCell of chunk (cx, cz) at y = WATER_LEVEL, counter-clockwise seen from above; null when the chunk has none. */
export function buildWaterChunk(map: TileMap, cx: number, cz: number): WaterChunk | null {
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(map.w, x0 + CHUNK), z1 = Math.min(map.h, z0 + CHUNK);
  const p: number[] = [];
  const y = WATER_LEVEL;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (!waterCell(map, x, z)) continue;
    // (x, z) -> (x, z + 1) -> (x + 1, z + 1) and (x, z) -> (x + 1, z + 1) -> (x + 1, z): normal +y
    p.push(x, y, z, x, y, z + 1, x + 1, y, z + 1, x, y, z, x + 1, y, z + 1, x + 1, y, z);
  }
  if (p.length === 0) return null;
  return { cx, cz, position: new Float32Array(p), count: p.length / 3 };
}

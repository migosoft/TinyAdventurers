import type { TileMap } from '../../sim/map';
import { DIP, WATER_LEVEL, liquidCell } from '../dips/shape';
import { heightAt } from '../heights';
import type { Puddle } from '../stone/place';
import { PUDDLE_LEVEL } from '../stone/shape';
import { chunkBounds, pushFlatQuad } from '../stone/grid';

/** A height-0 cell that is water, or has a water tile among its eight neighbours (the rounded outline reaches into those). */
export function waterCell(map: TileMap, x: number, z: number): boolean {
  return liquidCell(map, x, z, DIP.water);
}

/** A height-0 cell a puddle's disc reaches. */
function puddleCell(map: TileMap, x: number, z: number, puddles: readonly Puddle[]): boolean {
  return heightAt(map, x, z) === 0 && puddles.some((p) => Math.hypot(Math.max(x - p.x, 0, p.x - x - 1), Math.max(z - p.z, 0, p.z - z - 1)) < p.r);
}

export interface WaterChunk { cx: number; cz: number; position: Float32Array; count: number }

/**
 * Two triangles per waterCell of chunk (cx, cz) at y = WATER_LEVEL, and per other cell a puddle reaches at PUDDLE_LEVEL, counter-clockwise
 * seen from above; null when the chunk has none.
 */
export function buildWaterChunk(map: TileMap, cx: number, cz: number, puddles: readonly Puddle[] = []): WaterChunk | null {
  const { x0, z0, x1, z1 } = chunkBounds(map, cx, cz);
  const p: number[] = [];
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    const y = waterCell(map, x, z) ? WATER_LEVEL : puddleCell(map, x, z, puddles) ? PUDDLE_LEVEL : null;
    if (y !== null) pushFlatQuad(p, x, y, z);
  }
  if (p.length === 0) return null;
  return { cx, cz, position: new Float32Array(p), count: p.length / 3 };
}

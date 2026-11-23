import type { TileMap } from '../../sim/map';
import { DIP, LAVA_LEVEL, bedAt, isLava, liquidCell, maskAt } from '../dips/shape';
import { chunkBounds, pushFlatQuad } from '../stone/grid';

/** Quads per tile side of the lava's surface (the bubbles' domes need it; the dip mesh's DIP_RES). */
export const LAVA_RES = 12;
/** The heights of the shimmer's sheets above LAVA_LEVEL (tiles). */
export const SHIMMER_SHEETS = [0.02, 0.8, 1.6] as const;

/** A height-0 cell that is lava, or has a lava tile among its eight neighbours (the rounded outline reaches into those). */
export function lavaCell(map: TileMap, x: number, z: number): boolean {
  return liquidCell(map, x, z, DIP.lava);
}

export interface LavaChunk {
  cx: number; cz: number;
  /** Indexed: per lavaCell (LAVA_RES + 1) squared vertices at y = LAVA_LEVEL, counter-clockwise seen from above. */
  position: Float32Array; index: Uint32Array;
  /** Per vertex: x the lava's outline mask (maskAt(isLava)), y the lava over the bed (max(LAVA_LEVEL - bedAt, 0), tiles). */
  shore: Float32Array;
  /** The ground the cells cover (tiles), for the in-view test. */
  box: { x0: number; z0: number; x1: number; z1: number };
}

/** The surface of the lava cells of chunk (cx, cz); null when the chunk has none. Vertices are per cell: `maskAt` and `bedAt` are pure functions of the point, so a shared edge agrees. */
export function buildLavaChunk(map: TileMap, cx: number, cz: number): LavaChunk | null {
  const { x0, z0, x1, z1 } = chunkBounds(map, cx, cz);
  const R = LAVA_RES, N = R + 1;
  const position: number[] = [], shore: number[] = [], index: number[] = [];
  const box = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  let base = 0;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (!lavaCell(map, x, z)) continue;
    box.x0 = Math.min(box.x0, x); box.z0 = Math.min(box.z0, z);
    box.x1 = Math.max(box.x1, x + 1); box.z1 = Math.max(box.z1, z + 1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const px = x + i / R, pz = z + j / R;
      position.push(px, LAVA_LEVEL, pz);
      shore.push(maskAt(map, px, pz, isLava), Math.max(LAVA_LEVEL - bedAt(map, px, pz), 0));
    }
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const a = base + j * N + i, b = a + N, c = b + 1, d = a + 1;
      // (i, j) -> (i, j + 1) -> (i + 1, j + 1) and (i, j) -> (i + 1, j + 1) -> (i + 1, j): normal +y
      index.push(a, b, c, a, c, d);
    }
    base += N * N;
  }
  if (position.length === 0) return null;
  return { cx, cz, position: new Float32Array(position), index: new Uint32Array(index), shore: new Float32Array(shore), box };
}

/** Two triangles per lavaCell and sheet at LAVA_LEVEL + SHIMMER_SHEETS[k], facing up; null when the chunk has no lavaCell. */
export function buildShimmerChunk(map: TileMap, cx: number, cz: number): { position: Float32Array; count: number } | null {
  const { x0, z0, x1, z1 } = chunkBounds(map, cx, cz);
  const p: number[] = [];
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (!lavaCell(map, x, z)) continue;
    for (const h of SHIMMER_SHEETS) pushFlatQuad(p, x, LAVA_LEVEL + h, z);
  }
  if (p.length === 0) return null;
  return { position: new Float32Array(p), count: p.length / 3 };
}

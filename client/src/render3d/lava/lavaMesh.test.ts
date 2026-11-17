import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { LAVA_LEVEL, OUTLINE_EDGE, bedAt, isLava, maskAt } from '../dips/shape';
import { LAVA_RES, SHIMMER_SHEETS, buildLavaChunk, buildShimmerChunk, lavaCell } from './lavaMesh';

const T = TILE_ID;
function with_(w: number, h: number, cells: [number, number, number][]) {
  const t = new Array(w * h).fill(T.Floor);
  for (const [x, z, id] of cells) t[z * w + x] = id;
  return new TileMap(w, h, Uint8Array.from(t));
}
const pool = (x0: number, z0: number, n: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let z = z0; z < z0 + n; z++) for (let x = x0; x < x0 + n; x++) out.push([x, z, T.Lava]);
  return out;
};
const V = (LAVA_RES + 1) ** 2;
/** The cells (x,z) a chunk covers, from its vertex blocks (the first vertex of each block is the cell's corner). */
const cellsOf = (c: { position: Float32Array }) => {
  const out: string[] = [];
  for (let b = 0; b < c.position.length / 3 / V; b++) out.push(`${c.position[b * V * 3]},${c.position[b * V * 3 + 2]}`);
  return out;
};

describe('lava mesh', () => {
  it('builds nothing without lava', () => {
    expect(buildLavaChunk(with_(5, 5, []), 0, 0)).toBeNull();
    expect(buildShimmerChunk(with_(5, 5, []), 0, 0)).toBeNull();
    const water = with_(5, 5, [[2, 2, T.ShallowWater], [1, 1, T.DeepWater]]);
    expect(buildLavaChunk(water, 0, 0)).toBeNull();
    expect(buildShimmerChunk(water, 0, 0)).toBeNull();
  });

  it('covers the lava cells and their height-0 neighbours', () => {
    const map = with_(9, 9, pool(3, 3, 3));
    const c = buildLavaChunk(map, 0, 0)!;
    expect(new Set(cellsOf(c)).size).toBe(25);
    expect(c.position.length / 3).toBe(25 * V);
    for (let v = 0; v < c.position.length / 3; v++) expect(c.position[v * 3 + 1]).toBe(Math.fround(LAVA_LEVEL));
    expect(c.index.length).toBe(25 * LAVA_RES * LAVA_RES * 6);
    expect(c.box).toEqual({ x0: 2, z0: 2, x1: 7, z1: 7 });
  });

  it('leaves walls and the outside of the map out', () => {
    const map = with_(5, 5, [[0, 0, T.Lava], [1, 0, T.Wall], [1, 1, T.Wall], [0, 1, T.Wall]]);
    const c = buildLavaChunk(map, 0, 0)!;
    expect(cellsOf(c)).toEqual(['0,0']);
    for (let v = 0; v < c.position.length / 3; v++) {
      const x = c.position[v * 3], z = c.position[v * 3 + 2];
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(map.w);
      expect(z).toBeGreaterThanOrEqual(0); expect(z).toBeLessThanOrEqual(map.h);
    }
  });

  it('counts a closed door as a neighbour cell and skips a chasm or water cell', () => {
    const map = with_(8, 6, [[2, 2, T.Lava], [3, 2, T.DoorClosed], [1, 2, T.Chasm], [2, 3, T.ShallowWater]]);
    expect(lavaCell(map, 3, 2)).toBe(true);
    expect(lavaCell(map, 1, 2)).toBe(true);
    expect(lavaCell(map, 2, 3)).toBe(true);
    const c = buildLavaChunk(map, 0, 0)!;
    const cells = new Set(cellsOf(c));
    expect(cells.has('3,2')).toBe(true);
    expect(cells.has('1,2')).toBe(true);
    expect(cells.has('2,3')).toBe(true);
    expect(maskAt(map, 1.5, 2.5, isLava)).toBeLessThan(OUTLINE_EDGE);
    expect(maskAt(map, 2.5, 3.5, isLava)).toBeLessThan(OUTLINE_EDGE);
  });

  it('carries the mask and the depth', () => {
    const map = with_(9, 9, pool(3, 3, 3));
    const c = buildLavaChunk(map, 0, 0)!;
    for (let v = 0; v < c.position.length / 3; v++) {
      const x = c.position[v * 3], z = c.position[v * 3 + 2];
      expect(c.shore[v * 2]).toBeCloseTo(maskAt(map, x, z, isLava), 5);
      expect(c.shore[v * 2 + 1]).toBeCloseTo(Math.max(LAVA_LEVEL - bedAt(map, x, z), 0), 5);
    }
    expect(maskAt(map, 4.5, 4.5, isLava)).toBe(1);
    expect(LAVA_LEVEL - bedAt(map, 4.5, 4.5)).toBeGreaterThan(1);
  });

  it('agrees across a chunk border', () => {
    const map = with_(32, 6, [[15, 2, T.Lava], [16, 2, T.Lava]]);
    const a = buildLavaChunk(map, 0, 0)!, b = buildLavaChunk(map, 1, 0)!;
    const at = (c: typeof a) => {
      const m = new Map<string, string>();
      for (let v = 0; v < c.position.length / 3; v++) {
        if (c.position[v * 3] === 16) m.set(`${c.position[v * 3 + 2]}`, `${c.shore[v * 2]},${c.shore[v * 2 + 1]}`);
      }
      return m;
    };
    const ma = at(a), mb = at(b);
    expect(ma.size).toBeGreaterThan(0);
    for (const [k, s] of ma) expect(mb.get(k)).toBe(s);
  });

  it('faces up', () => {
    const c = buildLavaChunk(with_(6, 6, pool(2, 2, 2)), 0, 0)!;
    const p = c.position, ix = c.index;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, d = ix[t + 2] * 3;
      const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[d] - p[a], vz = p[d + 2] - p[a + 2];
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });

  it('follows a tile change', () => {
    const map = with_(7, 7, []);
    expect(buildLavaChunk(map, 0, 0)).toBeNull();
    map.set(3, 3, T.Lava);
    expect(new Set(cellsOf(buildLavaChunk(map, 0, 0)!)).size).toBe(9);
    map.set(3, 3, T.Floor);
    expect(buildLavaChunk(map, 0, 0)).toBeNull();
  });

  it('lays three sheets per cell', () => {
    const map = with_(9, 9, pool(3, 3, 3));
    const s = buildShimmerChunk(map, 0, 0)!;
    expect(s.count).toBe(25 * 3 * 6);
    expect(s.position.length).toBe(s.count * 3);
    const heights = new Set<number>();
    for (let v = 0; v < s.count; v++) heights.add(s.position[v * 3 + 1]);
    expect(heights).toEqual(new Set(SHIMMER_SHEETS.map((h) => Math.fround(LAVA_LEVEL + h))));
  });
});

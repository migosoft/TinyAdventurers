import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { WATER_LEVEL } from '../dips/shape';
import { PUDDLE_LEVEL } from '../stone/shape';
import { buildWaterChunk, waterCell } from './waterMesh';

const T = TILE_ID;
function with_(w: number, h: number, cells: [number, number, number][]) {
  const t = new Array(w * h).fill(T.Floor);
  for (const [x, z, id] of cells) t[z * w + x] = id;
  return new TileMap(w, h, Uint8Array.from(t));
}
/** The "x,z" of every quad's first vertex. */
const quadsOf = (c: { position: Float32Array }) => {
  const out: string[] = [];
  for (let q = 0; q < c.position.length / 18; q++) out.push(`${c.position[q * 18]},${c.position[q * 18 + 2]}`);
  return out;
};

describe('buildWaterChunk', () => {
  it('has no chunk without water', () => {
    expect(buildWaterChunk(with_(5, 5, []), 0, 0)).toBeNull();
    expect(buildWaterChunk(with_(5, 5, [[2, 2, T.Lava], [1, 1, T.Chasm]]), 0, 0)).toBeNull();
  });

  it('covers the pool and its border cells', () => {
    const c = buildWaterChunk(with_(5, 5, [[2, 2, T.ShallowWater]]), 0, 0)!;
    expect(c.count).toBe(54);
    expect(c.position.length).toBe(162);
    for (let v = 0; v < c.count; v++) expect(c.position[v * 3 + 1]).toBe(Math.fround(WATER_LEVEL));
    expect(new Set(quadsOf(c))).toEqual(new Set(['1,1', '2,1', '3,1', '1,2', '2,2', '3,2', '1,3', '2,3', '3,3']));
  });

  it('faces up', () => {
    const c = buildWaterChunk(with_(6, 6, [[2, 2, T.DeepWater], [3, 2, T.ShallowWater]]), 0, 0)!;
    const p = c.position;
    for (let t = 0; t < c.count / 3; t++) {
      const o = t * 9;
      const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
      const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
      const ny = uz * vx - ux * vz;
      expect(ny).toBeGreaterThan(0);
      expect(uy * vz - uz * vy).toBeCloseTo(0);
      expect(ux * vy - uy * vx).toBeCloseTo(0);
    }
  });

  it('stops at walls and the map edge', () => {
    // water at (1, 1) beside the map edge; a wall at (2, 1); a door at (1, 2)
    const map = with_(5, 5, [[1, 1, T.ShallowWater], [2, 1, T.Wall], [1, 2, T.DoorClosed]]);
    const c = buildWaterChunk(map, 0, 0)!;
    const cells = new Set(quadsOf(c));
    expect(cells.has('2,1')).toBe(false);          // the wall
    for (const k of cells) {
      const [x, z] = k.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(map.w);
      expect(z).toBeLessThan(map.h);
      expect(waterCell(map, x, z)).toBe(true);
    }
    // water in the corner: no quad outside the map, and Void counts as wall
    const corner = buildWaterChunk(with_(3, 3, [[0, 0, T.ShallowWater]]), 0, 0)!;
    expect(new Set(quadsOf(corner))).toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
    expect(waterCell(map, -1, 1)).toBe(false);
    expect(waterCell(map, 2, 1)).toBe(false);
    expect(waterCell(map, 1, 2)).toBe(true);        // a door is a height-0 cell, like the dip mesh counts it
    const voided = with_(4, 4, [[1, 1, T.ShallowWater], [2, 1, T.Void]]);
    expect(waterCell(voided, 2, 1)).toBe(false);
  });

  it('reaches across a chunk border', () => {
    const map = with_(32, 5, [[15, 2, T.ShallowWater]]);
    const left = buildWaterChunk(map, 0, 0)!;
    const right = buildWaterChunk(map, 1, 0)!;
    const l = quadsOf(left);
    expect(new Set(l.map((k) => k.split(',')[0]))).toEqual(new Set(['14', '15']));
    expect(l.length).toBe(6);
    expect(quadsOf(right).filter((k) => l.includes(k))).toEqual([]);
    expect(new Set(quadsOf(right))).toEqual(new Set(['16,1', '16,2', '16,3']));
    expect(left.cx).toBe(0);
    expect(right.cx).toBe(1);
  });

  it('has the cells a puddle touches at the puddle level, and no other floor cell (#380)', () => {
    // a puddle of radius 0.6 in the middle of cell (3, 3): it reaches the four cells beside it, not the corners
    const c = buildWaterChunk(with_(8, 8, []), 0, 0, [{ x: 3.5, z: 3.5, r: 0.6 }])!;
    expect(new Set(quadsOf(c))).toEqual(new Set(['3,2', '2,3', '3,3', '4,3', '3,4']));
    for (let v = 0; v < c.count; v++) expect(c.position[v * 3 + 1]).toBe(Math.fround(PUDDLE_LEVEL));
    // a pool's own cells keep the pool's level
    const both = buildWaterChunk(with_(8, 8, [[3, 3, T.ShallowWater]]), 0, 0, [{ x: 6.5, z: 6.5, r: 0.3 }])!;
    expect(quadsOf(both)).toHaveLength(10);
    expect(both.position[1]).toBe(Math.fround(WATER_LEVEL));
    expect(both.position[both.position.length - 2]).toBe(Math.fround(PUDDLE_LEVEL));
  });

  it('covers a chasm or lava cell beside the pool', () => {
    const map = with_(7, 5, [[2, 2, T.ShallowWater], [3, 2, T.Chasm], [2, 3, T.Lava]]);
    const cells = new Set(quadsOf(buildWaterChunk(map, 0, 0)!));
    expect(cells.has('3,2')).toBe(true);
    expect(cells.has('2,3')).toBe(true);
    expect(waterCell(map, 3, 2)).toBe(true);
  });
});

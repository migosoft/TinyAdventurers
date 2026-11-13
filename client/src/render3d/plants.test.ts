import { describe, expect, it } from 'vitest';
import type { PlantShape } from '../game/vegetation';
import { CHUNK } from './worldMesh';
import { ChunkSync, clumpDepth, newClumpBuf, newPlantBuf, plantChunks, pushClumps, pushPlant, pushTrunkCaster, ROOT_LIE, type PlantPlace, type PlantSprite } from './plants';

const place = (over: Partial<PlantPlace> = {}): PlantPlace => ({ x: 10, z: 20, mirrored: false, amp: 0.11, seed: 7, ...over });
const leafy: PlantShape = { cast: 'parts', trunkTop: 40, trunkX0: 14, trunkX1: 17, clumps: [{ x: 16, y: 20, r: 12 }, { x: 8, y: 26, r: 8 }] };
const sprite = (shape: PlantShape | null, over: Partial<PlantSprite> = {}): PlantSprite => ({ page: 0, rect: { x: 100, y: 200, w: 32, h: 64 }, foot: { x: 16, y: 56 }, shape, ...over });
const col = (a: number[], k: number, size: number) => a.filter((_, i) => i % size === k);
const range = (a: number[]) => [Math.min(...a), Math.max(...a)];

describe('pushPlant', () => {
  it('writes the card and the root decal, 6 vertices each', () => {
    const b = newPlantBuf();
    pushPlant(b, place(), sprite(leafy));
    expect(b.n).toBe(12);
    expect(range(col(b.corner, 1, 2).slice(0, 6))).toEqual([0, 56 / 16]);
    const decal = col(b.corner, 1, 2).slice(6);
    expect(Math.max(...decal)).toBeLessThanOrEqual(0);
    expect(Math.min(...decal)).toBeCloseTo(-8 / 16);
    expect(b.part.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(b.part.slice(6)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(b.foot.slice(0, 2)).toEqual([10, 20]);
    expect(b.sway.slice(0, 2)).toEqual([0.11, 56 / 16]);
  });
  it('writes one quad when nothing lies below the foot', () => {
    const b = newPlantBuf();
    pushPlant(b, place(), sprite(null, { foot: { x: 16, y: 64 } }));
    expect(b.n).toBe(6);
  });
  it('keeps uv inside the rect and swaps u for a mirrored plant', () => {
    const a = newPlantBuf(), m = newPlantBuf();
    pushPlant(a, place(), sprite(null));
    pushPlant(m, place({ mirrored: true }), sprite(null, { foot: { x: 10, y: 56 } }));
    for (const b of [a, m]) {
      const [u0, u1] = range(col(b.uv, 0, 2)), [v0, v1] = range(col(b.uv, 1, 2));
      expect(u0).toBeGreaterThanOrEqual(100); expect(u1).toBeLessThanOrEqual(132);
      expect(v0).toBeGreaterThanOrEqual(200); expect(v1).toBeLessThanOrEqual(264);
    }
    // vertex 0 is the top left: unmirrored reads the rect's left edge, mirrored its right edge
    expect(a.uv[0]).toBe(100);
    expect(m.uv[0]).toBe(132);
    expect(a.corner[0]).toBeCloseTo(-16 / 16);
    expect(m.corner[0]).toBeCloseTo(-(32 - 10) / 16);
  });
});

describe('pushTrunkCaster', () => {
  it('casts nothing for a bush or without a shape', () => {
    const b = newPlantBuf();
    pushTrunkCaster(b, place(), sprite({ cast: 'parts', trunkTop: 56, trunkX0: 0, trunkX1: 0, clumps: [] }));
    pushTrunkCaster(b, place(), sprite(null));
    expect(b.n).toBe(0);
  });
  it('is a trunk card from the foot up to trunkTop for a leafy tree', () => {
    const b = newPlantBuf();
    pushTrunkCaster(b, place(), sprite(leafy));
    expect(b.n).toBe(6);
    expect(range(col(b.corner, 1, 2))).toEqual([0, (56 - 40) / 16]);
    expect(range(col(b.corner, 0, 2))).toEqual([(14 - 16) / 16, (18 - 16) / 16]);
    expect(range(col(b.uv, 1, 2))).toEqual([200 + 40, 200 + 56]);
    expect(range(col(b.uv, 0, 2))).toEqual([114, 118]);
  });
  it('is the whole card above the foot for a bare tree', () => {
    const b = newPlantBuf();
    pushTrunkCaster(b, place(), sprite({ cast: 'whole', trunkTop: 0, trunkX0: 0, trunkX1: 0, clumps: [] }));
    expect(b.n).toBe(6);
    expect(range(col(b.corner, 1, 2))).toEqual([0, 56 / 16]);
    expect(range(col(b.uv, 0, 2))).toEqual([100, 132]);
  });
});

describe('pushClumps', () => {
  it('writes one disc per clump at its world-fixed centre', () => {
    const b = newClumpBuf();
    pushClumps(b, place(), sprite(leafy));
    expect(b.n).toBe(12);
    expect(b.centre[0]).toBeCloseTo(10 + 0 / 16);
    expect(b.centre[1]).toBeCloseTo((56 - 20) / 16);
    expect(b.centre[2]).toBe(20); // on the axis
    expect(b.radius[0]).toBeCloseTo(12 / 16);
    const off = b.centre[18], dz = b.centre[20] - 20;
    expect(off).toBeCloseTo(10 + (8 - 16) / 16);
    expect(Math.abs(dz)).toBeLessThanOrEqual(0.65);
  });
  it('mirrors the clump offset', () => {
    const b = newClumpBuf();
    pushClumps(b, place({ mirrored: true }), sprite(leafy));
    expect(b.centre[18]).toBeCloseTo(10 + (16 - 8) / 16);
  });
  it('clumpDepth is bounded, zero on the axis and repeatable', () => {
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(clumpDepth(i * 31, i, false))).toBeLessThanOrEqual(0.65);
      expect(clumpDepth(i, i, true)).toBe(0);
    }
    for (let i = 0; i < 200; i++) expect(Math.abs(clumpDepth(i * 31, i, false, 4))).toBeLessThanOrEqual(4 / 16);
    expect(clumpDepth(5, 2, false, 1000)).toBe(clumpDepth(5, 2, false));
    expect(clumpDepth(5, 2, false)).toBe(clumpDepth(5, 2, false));
    expect(clumpDepth(5, 2, false)).not.toBe(clumpDepth(6, 2, false));
  });
});

describe('casters are world-fixed', () => {
  it('push no camera and repeat exactly', () => {
    expect(pushTrunkCaster.length).toBe(3);
    expect(pushClumps.length).toBe(3);
    const a = newPlantBuf(), b = newPlantBuf(), c = newClumpBuf(), d = newClumpBuf();
    pushTrunkCaster(a, place(), sprite(leafy)); pushTrunkCaster(b, place(), sprite(leafy));
    pushClumps(c, place(), sprite(leafy)); pushClumps(d, place(), sprite(leafy));
    expect(a).toEqual(b);
    expect(c).toEqual(d);
  });
});

describe('constants', () => {
  it('ROOT_LIE sits above the terrain layers', () => { expect(ROOT_LIE).toBeGreaterThan(0.002 * 1); });
});

describe('plantChunks', () => {
  it('puts feet into chunks, including chunk edges and the map edge', () => {
    const map = { w: 40, h: 20 }; // nx 3, nz 2
    const m = plantChunks([{ x: 0.5, z: 0.5 }, { x: CHUNK, z: 0 }, { x: CHUNK - 0.01, z: CHUNK }, { x: 40, z: 20 }], map);
    expect(m.get(0)).toEqual([0]);
    expect(m.get(1)).toEqual([1]);
    expect(m.get(3)).toEqual([2]);
    expect(m.get(5)).toEqual([3]);
  });
});

describe('ChunkSync', () => {
  it('reports everything to a new consumer, then only changes', () => {
    const v = new Map([[0, 1], [4, 1]]);
    const s = new ChunkSync();
    expect(s.changed(v).sort()).toEqual([0, 4]);
    expect(s.changed(v)).toEqual([]);
    v.set(4, 2);
    expect(s.changed(v)).toEqual([4]);
    expect(new ChunkSync().changed(v).sort()).toEqual([0, 4]);
  });
});

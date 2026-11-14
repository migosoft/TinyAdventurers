import { describe, expect, it } from 'vitest';
import { CHUNK } from '../worldMesh';
import { ChunkSync, plantChunks } from './chunks';

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

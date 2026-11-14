import { describe, expect, it } from 'vitest';
import { AtlasPlants } from './atlasPlants';
import { CHUNK } from './worldMesh';

const MAP = { w: 64, h: 32 };
const sprite = { rect: { x: 0, y: 0, w: 96, h: 100 }, foot: { x: 48, y: 80 } };
const item = (x: number, z: number, mirrored = false) => ({ place: { x, z, mirrored, amp: 0.11, seed: 1 }, sprite });

describe('AtlasPlants', () => {
  it('puts every item in the chunk of its foot at once', () => {
    const f = new AtlasPlants([item(3, 4), item(40, 20, true), item(5, 6)], MAP);
    const fr = f.frame(false, 0);
    const nx = Math.ceil(MAP.w / CHUNK);
    expect([...fr.chunks.keys()].sort((a, b) => a - b)).toEqual([0, Math.floor(20 / CHUNK) * nx + Math.floor(40 / CHUNK)]);
    expect(fr.chunks.get(0)!.n).toBe(2 * 6);
    expect(fr.chunks.size).toBe(2);
  });

  it('versions each chunk once and hands the wind switch and the time through', () => {
    const fr = new AtlasPlants([item(3, 4), item(5, 6)], MAP).frame(true, 12.5);
    expect([fr.wind, fr.t]).toEqual([true, 12.5]);
    expect([...fr.versions.values()]).toEqual([2]); // two plants added to the one chunk
    expect(new Set(fr.versions.keys())).toEqual(new Set(fr.chunks.keys()));
  });

  it('makes one upright quad per item', () => {
    const fr = new AtlasPlants([item(3, 4)], MAP).frame(false, 0);
    expect(fr.chunks.get(0)!.n).toBe(6);
  });
});

import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { WALL_H, cellHeight, heightAt, heightBytes } from './heights';
import { parseMap } from './demoMap';

describe('heights', () => {
  it('gives Wall and Void the wall height and every other tile none', () => {
    for (const [name, id] of Object.entries(TILE_ID)) {
      const want = name === 'Wall' || name === 'Void' ? WALL_H : 0;
      expect(cellHeight(id), name).toBe(want);
    }
    expect(WALL_H).toBe(2);
  });

  it('counts everything outside the map as wall', () => {
    const m = parseMap(['#.']);
    expect(heightAt(m, -1, 0)).toBe(2);
    expect(heightAt(m, 0, 0)).toBe(2);
    expect(heightAt(m, 1, 0)).toBe(0);
    expect(heightAt(m, 2, 0)).toBe(2);
    expect(heightAt(m, 1, 1)).toBe(2);
  });

  it('packs heights into bytes, row by row', () => {
    expect(heightBytes(parseMap(['#.']))).toEqual(new Uint8Array([200, 0]));
  });
});

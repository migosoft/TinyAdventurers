import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { WALL_H, cellHeight, floorAt, heightAt, heightBytes, wallOf } from './heights';
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

  it('has one floor level for now: 0 on a floor, a wall and outside the map (#347)', () => {
    const m = parseMap(['#.']);
    expect(floorAt(m, 1, 0)).toBe(0);
    expect(floorAt(m, 0, 0)).toBe(0);
    expect(floorAt(m, -3, 9)).toBe(0);
  });

  it('puts a light on the edge of the wall it hangs on', () => {
    const at = { x: 4, y: 6 };
    expect(wallOf({ ...at, wall: 1 })).toEqual({ x: 4.5, z: 6, nx: 0, nz: 1 });
    expect(wallOf({ ...at, wall: 2 })).toEqual({ x: 4, z: 6.5, nx: 1, nz: 0 });
    expect(wallOf({ ...at, wall: 3 })).toEqual({ x: 5, z: 6.5, nx: -1, nz: 0 });
    expect(wallOf({ ...at, wall: 0 })).toEqual({ x: 4.5, z: 6.5, nx: 0, nz: 0 });
  });

  it('packs heights into bytes, row by row', () => {
    expect(heightBytes(parseMap(['#.']))).toEqual(new Uint8Array([200, 0]));
  });
});

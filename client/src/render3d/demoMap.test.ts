import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { MAP_ROWS, parseMap } from './demoMap';
import { WALL_H, heightAt, heightBytes } from './heights';

describe('demoMap', () => {
  const m = parseMap(MAP_ROWS);
  const solid = (x: number, z: number) => heightAt(m, x, z) > 0;

  it('has 22 rows of 40 columns', () => {
    expect(MAP_ROWS.length).toBe(22);
    for (const r of MAP_ROWS) expect(r.length).toBe(40);
    expect(m.w).toBe(40);
    expect(m.h).toBe(22);
  });

  it('parses walls and floors into tiles', () => {
    expect(m.get(0, 0)).toBe(TILE_ID.Wall);
    expect(m.get(2, 2)).toBe(TILE_ID.Floor);
    expect(heightAt(m, 0, 0)).toBe(WALL_H);
    expect(heightAt(m, 2, 2)).toBe(0);
  });

  it('pads short rows with wall', () => {
    const p = parseMap(['##', '#']);
    expect(p.w).toBe(2);
    expect(p.h).toBe(2);
    expect(Array.from(p.tiles)).toEqual([2, 2, 2, 2].map(() => TILE_ID.Wall));
  });

  it('treats everything outside the map as wall', () => {
    expect(solid(-1, 5)).toBe(true);
    expect(solid(5, -1)).toBe(true);
    expect(solid(40, 5)).toBe(true);
    expect(solid(5, 22)).toBe(true);
  });

  it('has 3-wide corridors', () => {
    const floors: [number, number, number, number][] = [[8, 10, 11, 14], [22, 35, 5, 7], [33, 35, 8, 12]];
    for (const [x0, x1, z0, z1] of floors)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) expect(solid(x, z), `${x},${z}`).toBe(false);
    for (const [x, z] of [[7, 11], [11, 11], [22, 4], [22, 8]]) expect(solid(x, z), `${x},${z}`).toBe(true);
  });

  it('packs heights into bytes', () => {
    const b = heightBytes(m);
    expect(b.length).toBe(m.w * m.h);
    expect(b[0]).toBe(200);
    expect(b[2 * m.w + 2]).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { WALL_H, MAP_ROWS, parseMap, heightAt, solid, heightBytes } from './demoMap';

describe('demoMap', () => {
  const m = parseMap(MAP_ROWS);

  it('has 22 rows of 40 columns', () => {
    expect(MAP_ROWS.length).toBe(22);
    for (const r of MAP_ROWS) expect(r.length).toBe(40);
    expect(m.w).toBe(40);
    expect(m.h).toBe(22);
  });

  it('parses walls and floors', () => {
    expect(heightAt(m, 0, 0)).toBe(WALL_H);
    expect(heightAt(m, 2, 2)).toBe(0);
    expect(solid(m, 0, 0)).toBe(true);
    expect(solid(m, 2, 2)).toBe(false);
  });

  it('treats everything outside the map as wall', () => {
    expect(heightAt(m, -1, 5)).toBe(WALL_H);
    expect(heightAt(m, 5, -1)).toBe(WALL_H);
    expect(heightAt(m, 40, 5)).toBe(WALL_H);
    expect(heightAt(m, 5, 22)).toBe(WALL_H);
    expect(solid(m, -3, -3)).toBe(true);
  });

  it('has 3-wide corridors', () => {
    const floors: [number, number, number, number][] = [[8, 10, 11, 14], [22, 35, 5, 7], [33, 35, 8, 12]];
    for (const [x0, x1, z0, z1] of floors)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) expect(solid(m, x, z), `${x},${z}`).toBe(false);
    for (const [x, z] of [[7, 11], [11, 11], [22, 4], [22, 8]]) expect(solid(m, x, z), `${x},${z}`).toBe(true);
  });

  it('packs heights into bytes', () => {
    const b = heightBytes(m);
    expect(b.length).toBe(m.w * m.h);
    expect(b[0]).toBe(200);
    expect(b[2 * m.w + 2]).toBe(0);
  });
});

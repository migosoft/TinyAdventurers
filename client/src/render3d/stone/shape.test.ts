import { describe, expect, it } from 'vitest';
import { LIGHT_KIND, TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { WALL_H, heightAt } from '../heights';
import { ROCK, stoneField } from './field';
import { noMarks, placeMarks } from './place';
import { REACH_MAX, floorHeight, stoneHeight } from './shape';
import { CRYSTAL_TILES, STONE_SEED, STONE_SPAWN, stoneMap } from './stoneMap';
import { PLATE_H, PLATE_W, PLATE_Y } from '../torch/torch';

/** A cave of 8 by 6 cells in solid rock, with a lone wall cell at (4, 4) and a group of two at (7, 5) and (8, 5). */
function cave(): TileMap {
  const m = new TileMap(12, 10, new Uint8Array(120).fill(TILE_ID.Wall));
  for (let z = 2; z < 8; z++) for (let x = 2; x < 10; x++) m.set(x, z, TILE_ID.Floor);
  for (const [x, z] of [[4, 4], [7, 5], [8, 5]]) m.set(x, z, TILE_ID.Wall);
  return m;
}
const rock = (m: TileMap, seed = 7) => stoneField(m, new Uint8Array(m.w * m.h).fill(ROCK), seed);

/** The stone page's level as all rock, with the marks of its crystals: puddles and crevices. */
function rockLevel() {
  const map = stoneMap(), f = rock(map, STONE_SEED);
  const marks = placeMarks(map, f, { lights: CRYSTAL_TILES.map(([x, y], i) => ({ id: i + 1, kind: LIGHT_KIND.Crystal, x, y, wall: 1 })), spawn: STONE_SPAWN });
  return { map, f, marks };
}

describe('stoneHeight', () => {
  it('is 0 on the open edge of a wall cell and WALL_H one cell deep', () => {
    const m = cave(), f = rock(m), none = noMarks();
    for (let t = 0.05; t < 1; t += 0.1) {
      // the west wall (cell 1, z) meets the cave at x = 2; the north wall (x, 1) at z = 2
      for (const z of [3, 5, 6]) {
        expect(stoneHeight(f, m, none, 2, z + t)).toBeCloseTo(0, 9);
        expect(stoneHeight(f, m, none, 2 - 1e-9, z + t)).toBeCloseTo(0, 6);
        expect(stoneHeight(f, m, none, 1, z + t)).toBe(WALL_H);
        expect(stoneHeight(f, m, none, 0.5, z + t)).toBe(WALL_H);
      }
      expect(stoneHeight(f, m, none, 5 + t, 2 - 1e-9)).toBeCloseTo(0, 6);
      expect(stoneHeight(f, m, none, 5 + t, 1)).toBe(WALL_H);
    }
    // in between it rises all the way, more gently at the foot than above
    // in between it rises from the edge itself all the way, gently at the foot: within the longest reach
    for (const z of [3.5, 5.5, 6.25]) {
      const up = Array.from({ length: Math.round(REACH_MAX * 100) + 2 }, (_, i) => stoneHeight(f, m, none, 2 - i / 100, z));
      expect(up[1]).toBeGreaterThan(0);
      expect(up[2]).toBeLessThan(0.2);
      for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1]);
      expect(up.filter((h) => h > 0.05 && h < WALL_H - 0.05).length).toBeGreaterThan(5); // a slope, not a step
      expect(up[up.length - 1]).toBe(WALL_H);
    }
  });

  it('the rock is hewn upright where a torch hangs', () => {
    // a torch on the north wall cell (5, 1): its point on that cell's edge, the normal into the cave
    const m = cave(), f = rock(m), none = noMarks(), hewn = { ...noMarks(), torches: [{ x: 5.5, z: 2, nx: 0, nz: 1, lightId: 1 }] };
    for (const x of [5.5, 5.5 - PLATE_W / 2, 5.5 + PLATE_W / 2]) {
      expect(stoneHeight(f, m, hewn, x, 2 - 0.02)).toBeGreaterThanOrEqual(PLATE_Y + PLATE_H / 2);
      expect(stoneHeight(f, m, none, x, 2 - 0.02)).toBeLessThan(PLATE_Y - PLATE_H / 2);
    }
    // two tiles along the wall the rock is as it was
    for (let d = 0.02; d < 1; d += 0.07) expect(stoneHeight(f, m, hewn, 7.5, 2 - d)).toBe(stoneHeight(f, m, none, 7.5, 2 - d));
  });

  it('is equal on both sides of every shared cell edge', () => {
    const m = cave(), f = rock(m), none = noMarks(), e = 1e-5;
    let walls = 0;
    for (let z = 1; z < m.h - 1; z++) for (let x = 1; x < m.w - 1; x++) for (let t = 0.03; t < 1; t += 0.047) {
      // the cell's west edge and its north edge
      for (const [ax, az, bx, bz] of [[x - e, z + t, x + e, z + t], [x + t, z - e, x + t, z + e]]) {
        const a = stoneHeight(f, m, none, ax, az), b = stoneHeight(f, m, none, bx, bz);
        expect(Math.abs(a - b), `edge at ${ax},${az}: ${a} against ${b}`).toBeLessThan(0.01);
        if (a > 0.1) walls++;
      }
    }
    expect(walls).toBeGreaterThan(500);
  });
});

describe('floorHeight', () => {
  it('is 0 or below everywhere on open ground, of rock and of laid stone', () => {
    const { map, f, marks } = rockLevel();
    const laid = stoneField(map, null, STONE_SEED), none = noMarks();
    let low = 0, laidLow = 0;
    for (let z = 0.013; z < map.h; z += 0.21) for (let x = 0.017; x < map.w; x += 0.19) {
      if (heightAt(map, Math.floor(x), Math.floor(z)) > 0) continue;
      const h = floorHeight(f, map, marks, x, z), l = floorHeight(laid, map, none, x, z);
      expect(h).toBeLessThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(0);
      low = Math.min(low, h); laidLow = Math.min(laidLow, l);
      expect(stoneHeight(f, map, marks, x, z)).toBe(h);
    }
    expect(low).toBeLessThan(-0.03); // uneven
    expect(low).toBeGreaterThan(-0.5);
    expect(laidLow).toBeLessThan(-0.04); // a sunk block
  });

  it('lies lower in a basin\'s centre than at its rim, and about the crevice\'s depth on its line', () => {
    // a puddle and a crevice of two pieces with a branch, in the cave
    const map = cave(), f = rock(map), marks = noMarks();
    marks.puddles.push({ x: 3.2, z: 6.3, r: 0.6 });
    marks.crevices.push({ pts: [[5.3, 2.8], [6.4, 3.9], [8.2, 3.6]], branch: [[6.4, 3.9, 6, 4.7]], width: 0.08, depth: 0.3 });
    for (const p of marks.puddles) {
      const mid = floorHeight(f, map, marks, p.x, p.z);
      for (let a = 0; a < 6; a++) expect(mid).toBeLessThan(floorHeight(f, map, marks, p.x + Math.cos(a) * p.r, p.z + Math.sin(a) * p.r) - 0.02);
    }
    for (const c of marks.crevices) {
      const segs = [...c.pts.slice(1).map((q, i) => [...c.pts[i], ...q]), ...c.branch];
      for (const [x0, z0, x1, z1] of segs) for (const t of [0.2, 0.5, 0.8]) {
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, h = floorHeight(f, map, marks, x, z);
        expect(h).toBeLessThanOrEqual(-c.depth);
        expect(h).toBeGreaterThan(-c.depth - 0.1);
        // a width beside the line the floor is back up
        const len = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
        expect(floorHeight(f, map, marks, x + nx * c.width * 1.5, z + nz * c.width * 1.5)).toBeGreaterThan(-0.1);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { MAP_ROWS, parseMap } from '../demoMap';
import { FACE_H, FACE_W, PAGE } from './format';
import { CHUNK, chunkGrid } from './grid';
import { facesKey, layoutMoved, planKeys, planSheets, samePlan } from './plan';

const filled = (w: number, h: number, t: number) => new TileMap(w, h, new Uint8Array(w * h).fill(t));

describe('planSheets', () => {
  it('gives every face exactly one slot, inside its page, with no two slots overlapping', () => {
    const map = parseMap(MAP_ROWS);
    const plan = planSheets(map);
    const { nx, nz } = chunkGrid(map);
    const seen = new Set<string>();
    let faces = 0;
    for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) for (const f of plan.facesOf(cx, cz)) {
      const s = plan.slotOf(f);
      faces++;
      expect(s.layer).toBeGreaterThanOrEqual(0);
      expect(s.layer).toBeLessThan(plan.wallLayers);
      expect(s.u % FACE_W).toBe(0);
      expect(s.v % FACE_H).toBe(0);
      expect(s.u + FACE_W).toBeLessThanOrEqual(PAGE);
      expect(s.v + FACE_H).toBeLessThanOrEqual(PAGE);
      const key = `${s.layer}:${s.u}:${s.v}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(faces).toBeGreaterThan(0);
    expect(seen.size).toBe(faces);
  });

  it('lists a face for every wall side that borders a lower cell, in z, x, side order', () => {
    const map = filled(3, 3, TILE_ID.Floor);
    map.set(1, 1, TILE_ID.Wall);
    const faces = planSheets(map).facesOf(0, 0);
    expect(faces.map((f) => [f.x, f.z, f.side])).toEqual([[1, 1, 0], [1, 1, 1], [1, 1, 2], [1, 1, 3]]);
  });

  it('a chunk with 129 faces owns two wall pages', () => {
    // A comb of single wall cells in a floor field: each interior one has four faces. 33 of them = 132 faces.
    const map = filled(CHUNK, CHUNK, TILE_ID.Floor);
    let n = 0;
    for (let z = 1; z < CHUNK - 1 && n < 33; z += 2) for (let x = 1; x < CHUNK - 1 && n < 33; x += 2) { map.set(x, z, TILE_ID.Wall); n++; }
    const plan = planSheets(map);
    expect(plan.facesOf(0, 0).length).toBe(132);
    expect(plan.wallLayers).toBe(2);
    const layers = new Set(plan.facesOf(0, 0).map((f) => plan.slotOf(f).layer));
    expect(layers).toEqual(new Set([0, 1]));
    // exactly 128 on the first page
    expect(plan.facesOf(0, 0).filter((f) => plan.slotOf(f).layer === 0).length).toBe(128);
  });

  it('a chunk of only Void has ground layer -1, one with floor or Wall has a layer', () => {
    const map = filled(CHUNK * 2, CHUNK, TILE_ID.Void);
    map.set(CHUNK + 3, 3, TILE_ID.Floor);
    const plan = planSheets(map);
    expect(plan.groundOf(0, 0)).toBe(-1);
    expect(plan.groundOf(1, 0)).toBe(0);
    expect(plan.groundLayers).toBe(1);
    const walls = filled(CHUNK, CHUNK, TILE_ID.Wall);
    expect(planSheets(walls).groundOf(0, 0)).toBe(0);
  });

  it('a 20 by 12 map plans one ground page per chunk, 2 for 20 wide', () => {
    const plan = planSheets(parseMap(['#'.repeat(20), ...Array.from({ length: 10 }, () => '#' + '.'.repeat(18) + '#'), '#'.repeat(20)]));
    // 20 by 12 tiles: two chunks wide and one high
    expect(plan.groundLayers).toBe(2);
    const small = planSheets(filled(8, 8, TILE_ID.Floor));
    expect(small.groundLayers).toBe(1);
  });

  it('facesKey changes when a wall cell becomes floor and not when a door closes', () => {
    const map = filled(5, 5, TILE_ID.Floor);
    map.set(2, 2, TILE_ID.Wall);
    map.set(1, 1, TILE_ID.DoorOpen);
    const before = facesKey(map, 0, 0);
    map.set(1, 1, TILE_ID.DoorClosed);
    expect(facesKey(map, 0, 0)).toBe(before);
    map.set(2, 2, TILE_ID.Floor);
    expect(facesKey(map, 0, 0)).not.toBe(before);
  });

  it('layoutMoved: a door closing keeps the layout, a wall turning into floor moves it', () => {
    const map = filled(20, 20, TILE_ID.Floor);
    map.set(5, 5, TILE_ID.Wall);
    map.set(1, 1, TILE_ID.DoorOpen);
    const keys = planKeys(map);
    const was = map.get(1, 1);
    map.set(1, 1, TILE_ID.DoorClosed);
    expect(layoutMoved(map, 1, 1, was, keys)).toBe(false);
    const wall = map.get(5, 5);
    map.set(5, 5, TILE_ID.Floor);
    expect(layoutMoved(map, 5, 5, wall, keys)).toBe(true);
  });

  it('layoutMoved: a Void cell turning Wall in a chunk of only Void gives it a ground page', () => {
    const map = filled(CHUNK, CHUNK, TILE_ID.Void);
    const keys = planKeys(map);
    map.set(3, 3, TILE_ID.Wall);
    expect(layoutMoved(map, 3, 3, TILE_ID.Void, keys)).toBe(true);
  });

  it('samePlan tells equal layouts from different ones', () => {
    const a = filled(20, 20, TILE_ID.Floor), b = filled(20, 20, TILE_ID.Floor);
    expect(samePlan(planSheets(a), planSheets(b), a)).toBe(true);
    b.set(4, 4, TILE_ID.Wall);
    expect(samePlan(planSheets(a), planSheets(b), a)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { WALL_H } from './heights';
import { FIELD_EDGE, FIELD_FILL, overLayer, type Ops, buildField, sealedCells } from './fieldMesh';

const rows = (r: string[]) => {
  const w = r[0].length, t = new Uint8Array(w * r.length);
  r.forEach((row, z) => [...row].forEach((ch, x) => { t[z * w + x] = ch === '#' ? TILE_ID.Wall : ch === 'D' ? TILE_ID.DoorClosed : TILE_ID.Floor; }));
  return new TileMap(w, r.length, t);
};

describe('fieldMesh', () => {
  it('constants', () => {
    expect(FIELD_FILL).toEqual([0x3a / 255, 0x8c / 255, 1]);
    expect(FIELD_EDGE).toEqual([0x9f / 255, 0xd8 / 255, 1]);
  });
  it('no DoorClosed cell gives count 0', () => {
    const f = buildField(rows(['###', '...', '###']));
    expect(f.count).toBe(0);
    expect(sealedCells(rows(['###', '...', '###']))).toEqual([]);
  });
  it('one DoorClosed in a wall gap has a top and two sides toward the floor', () => {
    const m = rows(['###', '.D.', '###']);
    expect(sealedCells(m)).toEqual([[1, 1]]);
    const f = buildField(m);
    expect(f.count).toBe(6 + 2 * 18);
    expect(f.position.length).toBe(f.count * 3);
    const maxY = Math.max(...Array.from({ length: f.count }, (_, i) => f.position[i * 3 + 1]));
    expect(maxY).toBe(WALL_H);
  });
  it('two adjacent DoorClosed cells have no side between them', () => {
    const f = buildField(rows(['####', '.DD.', '####']));
    expect(f.count).toBe(2 * (6 + 18));
  });
  it('a door on the map edge has no side outward', () => {
    expect(buildField(rows(['D.'])).count).toBe(6 + 18);
  });
  it('edge attribute marks the rims', () => {
    const f = buildField(rows(['###', '.D.', '###']));
    expect(f.edge.length).toBe(f.count);
    expect(f.y01.length).toBe(f.count);
    // a vertex at the floor or the top of a side is a rim; the middle band and the top cap are not
    let rim = 0;
    for (let i = 0; i < f.count; i++) {
      const y = f.position[i * 3 + 1];
      expect(f.y01[i]).toBeCloseTo(y / WALL_H, 6);
      if (f.edge[i] === 1) rim++;
    }
    expect(rim).toBe(2 * 12);
    const lo = Array.from(f.y01).filter((v) => v === 0).length, hi = Array.from(f.y01).filter((v) => v === 1).length;
    expect(lo).toBe(2 * 3);
    expect(hi).toBe(2 * 3 + 6);
    expect(Array.from(f.edge).every((e) => e === 0 || e === 1)).toBe(true);
  });
  it('a band over the fill is mostly the band', () => {
    const num: Ops<number> = { one: 1, eps: 1e-4, add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b, max: Math.max, mix: (a, b, k) => a + (b - a) * k };
    // one channel: the fill 0 at alpha 0.3, a layer of 1 at alpha 0.9
    const [c, a] = overLayer(num, 0.3, 0, 1, 0.9);
    expect(c).toBeGreaterThanOrEqual(0.95);
    expect(a).toBeCloseTo(0.93, 9);
    expect(overLayer(num, 0.3, 0, 1, 0)[0]).toBe(0);
  });
});

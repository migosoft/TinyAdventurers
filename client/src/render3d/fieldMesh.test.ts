import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TileMap } from '../sim/map';
import { WALL_H } from './heights';
import { FIELD_ALPHA, FIELD_COLOUR, buildField, sealedCells } from './fieldMesh';

const rows = (r: string[]) => {
  const w = r[0].length, t = new Uint8Array(w * r.length);
  r.forEach((row, z) => [...row].forEach((ch, x) => { t[z * w + x] = ch === '#' ? TILE_ID.Wall : ch === 'D' ? TILE_ID.DoorClosed : TILE_ID.Floor; }));
  return new TileMap(w, r.length, t);
};

describe('fieldMesh', () => {
  it('constants', () => {
    expect(FIELD_COLOUR).toEqual([0.3, 0.55, 1.0]);
    expect(FIELD_ALPHA).toBe(0.35);
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
    expect(f.count).toBe(18);
    expect(f.position.length).toBe(54);
    const maxY = Math.max(...Array.from({ length: 18 }, (_, i) => f.position[i * 3 + 1]));
    expect(maxY).toBe(WALL_H);
  });
  it('two adjacent DoorClosed cells have no side between them', () => {
    const f = buildField(rows(['####', '.DD.', '####']));
    expect(f.count).toBe(6 * (2 + 2));
  });
  it('a door on the map edge has no side outward', () => {
    expect(buildField(rows(['D.'])).count).toBe(6 * 2);
  });
});

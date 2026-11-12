import { describe, expect, it } from 'vitest';
import { FLAG, KIND, SIDE, TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import type { Opener } from './figures';
import { opensWalls, seenOpeners } from './openers';

const e = (kind: number, side: number, flags = 0) => ({ kind, side, flags });

describe('opensWalls', () => {
  it('lets heroes, hostile and friendly creatures, chests and hiding mimics open walls', () => {
    expect(opensWalls(e(KIND.Knight, SIDE.Friendly), false)).toBe(true);
    expect(opensWalls(e(KIND.SkeletonWarrior, SIDE.Hostile), false)).toBe(true);
    expect(opensWalls(e(KIND.DireWolf, SIDE.Friendly), false)).toBe(true);
    expect(opensWalls(e(KIND.Chest, SIDE.Neutral), false)).toBe(true);
    expect(opensWalls(e(KIND.Mimic, SIDE.Neutral, FLAG.HIDING), false)).toBe(true);
  });

  it('counts a revealed mimic as an enemy', () => {
    expect(opensWalls(e(KIND.Mimic, SIDE.Hostile), false)).toBe(true);
    expect(opensWalls(e(KIND.Mimic, SIDE.Hostile, FLAG.DEAD), false)).toBe(false);
  });

  it('keeps neutral creatures, barrels, torches, hazards and shots closed', () => {
    expect(opensWalls(e(KIND.Knight, SIDE.Neutral), false)).toBe(false);
    expect(opensWalls(e(KIND.Bunny, SIDE.Neutral), false)).toBe(false);
    expect(opensWalls(e(KIND.Barrel, SIDE.Neutral), false)).toBe(false);
    expect(opensWalls(e(KIND.Torch, SIDE.Neutral), false)).toBe(false);
    expect(opensWalls(e(KIND.FirePatch, SIDE.Hostile), false)).toBe(false);
    expect(opensWalls(e(KIND.Arrow, SIDE.Hostile), false)).toBe(false);
  });

  it('keeps the dead and the sinking closed', () => {
    expect(opensWalls(e(KIND.Knight, SIDE.Friendly, FLAG.DEAD), false)).toBe(false);
    expect(opensWalls(e(KIND.Knight, SIDE.Friendly), true)).toBe(false);
  });
});

describe('seenOpeners', () => {
  const op = (id: number, x: number, z: number): Opener => ({ id, x, z, mid: 0.5, who: 'hero' });
  const sight = { isVisible: (x: number, y: number) => x < 5 && y < 5 };

  it('drops what stands on an unseen tile and keeps what stands on a seen one', () => {
    const out = seenOpeners([op(1, 2.5, 3.5), op(2, 9.5, 3.5), op(3, 4.9, 4.9), op(4, 3.5, 5.1)], sight);
    expect(out.map((o) => o.id)).toEqual([1, 3]);
  });

  it('drops a teammate behind a wall in the real sight, and keeps one in the open', () => {
    // A room cut by a wall at column 10; the viewer stands left of it.
    const rows = Array.from({ length: 11 }, (_, y) => Array.from({ length: 21 }, (_, x) => (x === 0 || y === 0 || x === 20 || y === 10 || x === 10 ? '#' : '.')).join(''));
    const w = rows[0].length;
    const tiles = new Uint8Array(w * rows.length);
    rows.forEach((row, y) => [...row].forEach((c, x) => (tiles[y * w + x] = c === '#' ? TILE_ID.Wall : TILE_ID.Floor)));
    const map = new TileMap(w, rows.length, tiles);
    const v = new View(map.w, map.h);
    v.compute(map, 5.5 * TILE, 5.5 * TILE, 9, 'hard');
    const ids = seenOpeners([op(1, 3.5, 5.5), op(2, 14.5, 5.5)], v).map((o) => o.id);
    expect(ids).toEqual([1]);
  });
});

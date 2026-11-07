import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import { shadeCovers } from './shademask';

/** A 20x20 map ringed by walls, `extra` placed on top. */
function map(extra: [number, number, number][]): TileMap {
  const m = new TileMap(20, 20, new Uint8Array(400).fill(TILE_ID.Floor));
  for (let i = 0; i < 20; i++) for (const [x, y] of [[i, 0], [i, 19], [0, i], [19, i]]) m.set(x, y, TILE_ID.Wall);
  for (const [x, y, t] of extra) m.set(x, y, t);
  return m;
}

function views(m: TileMap, px: number, py: number): [View, View] {
  const hard = new View(m.w, m.h);
  const all = new View(m.w, m.h);
  hard.compute(m, px, py, 12, 'hard');
  all.compute(m, px, py, 12, 'all');
  return [hard, all];
}

describe('the soft shadow', () => {
  it('the ground behind a trunk is shaded, the rest is not', () => {
    const m = map([[10, 10, TILE_ID.Trunk]]);
    const [hard, all] = views(m, 10.5 * TILE, 14.5 * TILE);
    expect(shadeCovers(hard, all, 10.5 * TILE, 6.5 * TILE)).toBe(true);
    expect(shadeCovers(hard, all, 10.5 * TILE, 12.5 * TILE)).toBe(false);
    expect(shadeCovers(hard, all, 4.5 * TILE, 14.5 * TILE)).toBe(false);
  });
  it('no soft blockers, no shade', () => {
    const m = map([]);
    const [hard, all] = views(m, 10.5 * TILE, 14.5 * TILE);
    for (let y = 1; y < 19; y++) for (let x = 1; x < 19; x++) expect(shadeCovers(hard, all, (x + 0.5) * TILE, (y + 0.5) * TILE)).toBe(false);
  });
  it('walls stay black', () => {
    const m = map([[10, 10, TILE_ID.Wall]]);
    const [hard, all] = views(m, 10.5 * TILE, 14.5 * TILE);
    expect(shadeCovers(hard, all, 10.5 * TILE, 6.5 * TILE)).toBe(false);
  });
});

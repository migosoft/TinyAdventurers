import { describe, expect, it, vi } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import { LazyView } from './lightview';
import { ShadeMask } from './shademask';

vi.mock('phaser', () => ({ default: {} }));

/** A 20x20 map ringed by walls, `extra` placed on top. */
function map(extra: [number, number, number][]): TileMap {
  const m = new TileMap(20, 20, new Uint8Array(400).fill(TILE_ID.Floor));
  for (let i = 0; i < 20; i++) for (const [x, y] of [[i, 0], [i, 19], [0, i], [19, i]]) m.set(x, y, TILE_ID.Wall);
  for (const [x, y, t] of extra) m.set(x, y, t);
  return m;
}

describe('the full view is computed on demand', () => {
  it('a LazyView computes only when read, and once per request', () => {
    const m = map([]);
    const lazy = new LazyView(m.w, m.h, 'all');
    lazy.request(m, 10.5 * TILE, 10.5 * TILE, 8);
    lazy.request(m, 11.5 * TILE, 10.5 * TILE, 8);
    expect(lazy.view.version).toBe(0);
    expect(lazy.get().version).toBe(1);
    expect(lazy.get().px).toBe(11.5 * TILE);
    lazy.request(m, 12.5 * TILE, 10.5 * TILE, 8);
    expect(lazy.get().version).toBe(2);
  });

  it('the shade layer never asks for it when no soft tile lies in the window', () => {
    const m = map([]);
    const shade = new ShadeMask({} as never, m);
    let asked = 0;
    const lazy = new LazyView(m.w, m.h, 'all');
    const hard = new View(m.w, m.h);
    shade.update({ y: 0, bottom: 20 * TILE } as never, hard, () => (asked++, lazy.get()));
    expect(asked).toBe(0);
    expect(lazy.view.version).toBe(0);
  });
});

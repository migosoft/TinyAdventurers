// The TypeScript ports must reproduce the Rust results exactly.
// Fixtures are written by `cargo test` (server/src/export.rs).
import { describe, expect, it } from 'vitest';
import fixtures from '../generated/fixtures.json';
import { lineOfSight, moveBox, stepMove, type MoveState } from './collision';
import { Fov } from './fov';
import { View } from './view';
import { TILE, TileMap, type Mover } from './map';
import { TILE_ID } from '../generated/defs';

const map = new TileMap(fixtures.w, fixtures.h, Uint8Array.from(fixtures.tiles));

describe('collision port', () => {
  it('matches the server step for step', () => {
    const solids = fixtures.solids.map(([x, y, half]) => ({ x, y, half }));
    for (const c of fixtures.moves) {
      let s: MoveState = { x: c.start[0], y: c.start[1], dashT: 0, dashDx: 0, dashDy: 0, knockVx: 0, knockVy: 0 };
      c.inputs.forEach((inp, i) => {
        if (inp.dash) {
          s = { ...s, dashT: 0.18, dashDx: inp.dash[0], dashDy: inp.dash[1] };
        }
        if (inp.knock) s = { ...s, knockVx: inp.knock[0], knockVy: inp.knock[1] };
        s = stepMove(map, s, inp.mx, inp.my, c.speed, fixtures.dashSpeed, fixtures.radius, fixtures.dt, solids);
        expect([s.x, s.y]).toEqual(c.out[i]);
      });
    }
  });
});

describe('fov port', () => {
  it('matches the server visible set', () => {
    const fov = new Fov(map.w, map.h);
    for (const c of fixtures.fov) {
      fov.compute(map, c.x, c.y, fixtures.fovRadius, c.hard ? 'hard' : 'all');
      const vis: number[] = [];
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (fov.isVisible(x, y)) vis.push(y * map.w + x);
      expect(vis, `fov ${c.x},${c.y} ${c.hard ? 'hard' : 'all'}`).toEqual(c.visible);
    }
  });
});

describe('trunk tile', () => {
  const m = new TileMap(5, 3, new Uint8Array(15).fill(TILE_ID.Floor));
  m.set(2, 1, TILE_ID.Trunk);

  it('blocks sight and shots like a column, lets light through, and blocks every walker, a dash too', () => {
    expect(m.opaque(2, 1)).toBe(true);
    expect(m.hardOpaque(2, 1)).toBe(false);
    expect(m.blocksSight(2, 1, 'all')).toBe(true);
    expect(m.blocksSight(2, 1, 'hard')).toBe(false);
    for (const mover of ['hero', 'enemy', 'demon', 'dash'] as Mover[]) expect(m.blocks(2, 1, mover)).toBe(true);
  });

  it('stops a hero and a dash at its edge', () => {
    for (const mover of ['hero', 'dash'] as Mover[]) {
      const [x] = moveBox(m, 1.5 * TILE, 1.5 * TILE, 12, 0, 5, mover);
      expect(x).toBe(2 * TILE - 5);
    }
  });
});

describe('a predicted shot stops at a trunk', () => {
  const m = new TileMap(8, 3, new Uint8Array(24).fill(TILE_ID.Floor));
  m.set(4, 1, TILE_ID.Trunk);

  it('has no line of sight across a trunk, and the shot test sees it as opaque', () => {
    expect(lineOfSight(m, 1.5 * TILE, 1.5 * TILE, 6.5 * TILE, 1.5 * TILE)).toBe(false);
    expect(lineOfSight(m, 1.5 * TILE, 0.5 * TILE, 6.5 * TILE, 0.5 * TILE)).toBe(true);
    expect(m.opaqueAt(4.5 * TILE, 1.5 * TILE)).toBe(true);
  });
});

describe('trunk and thicket block like the server', () => {
  const tileAt = (id: number) => {
    for (let i = 0; i < fixtures.tiles.length; i++) if (fixtures.tiles[i] === id) return [i % fixtures.w, Math.floor(i / fixtures.w)];
    throw new Error(`no tile ${id} in the fixture`);
  };

  it('the fixture holds a trunk, a thicket and a road', () => {
    const [tx, ty] = tileAt(TILE_ID.Trunk);
    const [hx, hy] = tileAt(TILE_ID.Thicket);
    const [rx, ry] = tileAt(TILE_ID.Road);
    expect([map.opaque(tx, ty), map.hardOpaque(tx, ty)]).toEqual([true, false]);
    expect([map.opaque(hx, hy), map.hardOpaque(hx, hy)]).toEqual([true, false]);
    expect([map.opaque(rx, ry), map.hardOpaque(rx, ry)]).toEqual([false, false]);
    for (const mover of ['hero', 'enemy', 'demon', 'dash'] as Mover[]) {
      expect(map.blocks(tx, ty, mover)).toBe(true);
      expect(map.blocks(hx, hy, mover)).toBe(true);
      expect(map.blocks(rx, ry, mover)).toBe(false);
    }
  });

  it('hides what is behind them under Blocker all and not under hard', () => {
    const [tx, ty] = tileAt(TILE_ID.Trunk);
    const fov = new Fov(map.w, map.h);
    fov.compute(map, tx, ty - 3, fixtures.fovRadius, 'all');
    expect(fov.isVisible(tx, ty + 2)).toBe(false);
    fov.compute(map, tx, ty - 3, fixtures.fovRadius, 'hard');
    expect(fov.isVisible(tx, ty + 2)).toBe(true);
    const v = new View(map.w, map.h);
    v.compute(map, (tx + 0.5) * TILE, (ty - 2.5) * TILE, 9, 'all');
    expect(v.isVisible(tx, ty + 2)).toBe(false);
    v.compute(map, (tx + 0.5) * TILE, (ty - 2.5) * TILE, 9, 'hard');
    expect(v.isVisible(tx, ty + 2)).toBe(true);
  });
});

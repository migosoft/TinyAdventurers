// The TypeScript ports must reproduce the Rust results exactly.
// Fixtures are written by `cargo test` (server/src/export.rs).
import { describe, expect, it } from 'vitest';
import fixtures from '../generated/fixtures.json';
import { lineOfSight, moveBox, stepMove, type MoveState } from './collision';
import { Fov } from './fov';
import { View } from './view';
import { TILE, TileMap, type Mover } from './map';
import { CONST, TILE_ID } from '../generated/defs';

const map = new TileMap(fixtures.w, fixtures.h, Uint8Array.from(fixtures.tiles));

describe('collision port', () => {
  it('matches the server step for step', () => {
    const solids = fixtures.solids.map(([x, y, half]) => ({ x, y, half }));
    for (const c of fixtures.moves) {
      let s: MoveState = { x: c.start[0], y: c.start[1], dashT: 0, dashDx: 0, dashDy: 0, knockVx: 0, knockVy: 0, waterT: 0 };
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

  it('the invisible wall (#259) blocks every mover but not sight or light', () => {
    const [bx, by] = tileAt(TILE_ID.Barrier);
    expect([map.opaque(bx, by), map.hardOpaque(bx, by)]).toEqual([false, false]);
    for (const mover of ['hero', 'enemy', 'demon', 'dash'] as Mover[]) expect(map.blocks(bx, by, mover)).toBe(true);
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

describe('tile rules', () => {
  it('every server tile has the same sight, light, walking and speed rules here', () => {
    expect(fixtures.tileRules.length).toBe(Object.keys(TILE_ID).length);
    const one = new TileMap(1, 1, new Uint8Array(1));
    for (const r of fixtures.tileRules) {
      one.set(0, 0, r.id);
      expect([one.opaque(0, 0), one.hardOpaque(0, 0)], `tile ${r.id}`).toEqual([r.opaque, r.hardOpaque]);
      for (const mover of ['hero', 'enemy', 'demon', 'dash', 'breathless'] as Mover[]) {
        expect(one.blocks(0, 0, mover), `tile ${r.id} blocks ${mover}`).toBe(r.blocks[mover]);
        expect(one.speedFactor(TILE / 2, TILE / 2, mover), `tile ${r.id} speed ${mover}`).toBe(r.speed[mover]);
      }
    }
  });
});

describe('deep water (server collision.rs: water_t_counts_in_deep_water_and_slows)', () => {
  // Like the server's `room()`: floor inside, walls around.
  const m = new TileMap(10, 10, new Uint8Array(100).fill(TILE_ID.Wall));
  for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) m.set(x, y, TILE_ID.Floor);
  for (let y = 1; y < 9; y++) for (let x = 3; x <= 6; x++) m.set(x, y, TILE_ID.DeepWater);
  const dt = 1 / 60;
  const start: MoveState = { x: 20, y: 40, dashT: 0, dashDx: 0, dashDy: 0, knockVx: 0, knockVy: 0, waterT: 0 };

  it('counts from the first step that starts inside, slows, and resets on leaving', () => {
    let s = start;
    let want = 0;
    let headSeen = false;
    for (let i = 0; i < 200; i++) {
      const inside = m.tileAt(s.x, s.y) === TILE_ID.DeepWater;
      const prev = s.x;
      s = stepMove(m, s, 1, 0, 60, 300, 5, dt);
      want = inside ? want + dt : 0;
      expect(s.waterT).toBeCloseTo(want, 9);
      if (inside) {
        const k = want >= CONST.HEAD_UNDER ? CONST.UNDER_SPEED : CONST.SWIM_SPEED;
        headSeen ||= want >= CONST.HEAD_UNDER;
        expect(s.x - prev).toBeCloseTo(60 * k * dt, 9);
      }
    }
    expect(headSeen).toBe(true);
    expect(s.waterT).toBe(0);
  });

  it('walk-in and walk-out numbers equal the server\'s (collision.rs: walk_in_and_out_numbers)', () => {
    const want: [number, number, number][] = [[28, 48.0, 0.0], [30, 49.400000000000006, 0.03333333333333333], [60, 70.40000000000009, 0.5333333333333333], [100, 98.0500000000002, 1.2000000000000006], [140, 112.04999999999997, 1.866666666666665], [160, 132.04999999999995, 0.0], [200, 139.0, 0.0]];
    let s = start;
    const got: [number, number, number][] = [];
    for (let i = 1; i <= 200; i++) {
      s = stepMove(m, s, 1, 0, 60, 300, 5, dt);
      if (want.some((w) => w[0] === i)) got.push([i, s.x, s.waterT]);
    }
    got.forEach((g, k) => {
      expect(g[0]).toBe(want[k][0]);
      expect(g[1]).toBeCloseTo(want[k][1], 9);
      expect(g[2]).toBeCloseTo(want[k][2], 9);
    });
    expect(got.length).toBe(want.length);
  });

  it('a dash stops the clock', () => {
    const d = stepMove(m, { ...start, x: 3.5 * TILE, dashT: 0.3, dashDx: 1 }, 0, 0, 60, 300, 5, dt);
    expect(d.waterT).toBe(0);
    expect(d.x).toBeCloseTo(3.5 * TILE + 5, 9);
  });

  it('breathless is blocked by chasm and lava only; a hero by nothing', () => {
    const t = new TileMap(4, 1, Uint8Array.from([TILE_ID.DeepWater, TILE_ID.Chasm, TILE_ID.Lava, TILE_ID.Floor]));
    expect([0, 1, 2].map((x) => t.blocks(x, 0, 'breathless'))).toEqual([false, true, true]);
    expect([0, 1, 2].map((x) => t.blocks(x, 0, 'hero'))).toEqual([false, false, false]);
  });
});

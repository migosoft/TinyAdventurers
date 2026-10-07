// The TypeScript ports must reproduce the Rust results exactly.
// Fixtures are written by `cargo test` (server/src/export.rs).
import { describe, expect, it } from 'vitest';
import fixtures from '../generated/fixtures.json';
import { stepMove, type MoveState } from './collision';
import { Fov } from './fov';
import { TileMap } from './map';

const map = new TileMap(fixtures.w, fixtures.h, Uint8Array.from(fixtures.tiles));

describe('collision port', () => {
  it('matches the server step for step', () => {
    for (const c of fixtures.moves) {
      let s: MoveState = { x: c.start[0], y: c.start[1], dashT: 0, dashDx: 0, dashDy: 0 };
      c.inputs.forEach((inp, i) => {
        if (inp.dash) {
          s = { ...s, dashT: 0.18, dashDx: inp.dash[0], dashDy: inp.dash[1] };
        }
        s = stepMove(map, s, inp.mx, inp.my, c.speed, fixtures.dashSpeed, fixtures.radius, fixtures.dt);
        expect([s.x, s.y]).toEqual(c.out[i]);
      });
    }
  });
});

describe('fov port', () => {
  it('matches the server visible set', () => {
    const fov = new Fov(map.w, map.h);
    for (const c of fixtures.fov) {
      fov.compute(map, c.x, c.y, fixtures.fovRadius);
      const vis: number[] = [];
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (fov.isVisible(x, y)) vis.push(y * map.w + x);
      expect(vis).toEqual(c.visible);
    }
  });
});

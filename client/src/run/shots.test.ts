import { describe, expect, it } from 'vitest';
import { KIND, SIDE } from '../generated/defs';
import { TileMap } from '../sim/map';
import type { EntState } from '../game/world';
import { Shots, type Shot } from './shots';
import { ability, startInfo } from './testing';

const ROWS = ['#####', '#...#', '#####'];

function map(): TileMap {
  const info = startInfo(ROWS);
  return new TileMap(info.width, info.height, info.tiles as Uint8Array);
}

const NO_ENTS = new Map<number, EntState>();
const ctx = (m: TileMap) => ({ map: m, ents: NO_ENTS, rtt: 50, interpDelay: 0.1 });

const server = (id: number, extra: number): EntState => ({ id, kind: KIND.Arrow, x: 30, y: 24, hp: 1, anim: 0, aim: 0, animMs: 0, flags: 0, extra, effects: 0, side: 1, entangled: 0 });

describe('Shots', () => {
  it('a shot ends at a wall and reports it', () => {
    const m = map();
    const shots = new Shots();
    shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 200 }), 2, 5, { x: 24, y: 24 }, 0);
    const ended: string[] = [];
    for (let i = 0; i < 20 && shots.live.length > 0; i++) shots.update(0.05, i * 0.05, ctx(m), (_s: Shot, how) => ended.push(how));
    expect(ended).toEqual(['wall']);
    expect(shots.live).toEqual([]);
  });

  it('a shot that runs out of life ends as gone', () => {
    const shots = new Shots();
    shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 200 }), 2, 0.01, { x: 24, y: 24 }, 0);
    const ended: string[] = [];
    shots.update(0.05, 0.05, ctx(map()), (_s, how) => ended.push(how));
    expect(ended).toEqual(['gone']);
  });

  it('an ended own shot stays hidden', () => {
    const m = map();
    const shots = new Shots();
    shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 200 }), 2, 5, { x: 24, y: 24 }, 0);
    for (let i = 0; i < 20 && shots.live.length > 0; i++) shots.update(0.05, i * 0.05, ctx(m), () => {});
    expect(shots.live).toEqual([]);
    const ents = new Map([[99, server(99, (1 << 16) | 7)]]);
    expect(shots.hidden(ents, undefined, 1).has(99)).toBe(true);
  });

  it('a shot seen on the server ends as gone when the server shot is gone', () => {
    const shots = new Shots();
    shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 20 }), 2, 5, { x: 24, y: 24 }, 0);
    const ents = new Map([[99, server(99, (1 << 16) | 7)]]);
    shots.hidden(ents, undefined, 1);
    const ended: string[] = [];
    shots.update(0.05, 0.05, ctx(map()), (_s, how) => ended.push(how));
    expect(ended).toEqual([]);
    shots.hidden(NO_ENTS, undefined, 1);
    shots.update(0.05, 0.1, ctx(map()), (_s, how) => ended.push(how));
    expect(ended).toEqual(['gone']);
  });

  it("another hero's shot is not hidden", () => {
    const shots = new Shots();
    shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 200 }), 2, 5, { x: 24, y: 24 }, 0);
    const ents = new Map([[98, server(98, (2 << 16) | 7)]]);
    expect(shots.hidden(ents, undefined, 1).has(98)).toBe(false);
  });

  describe('arcing shots (#321)', () => {
    const WIDE = ['#'.repeat(22), '#' + '.'.repeat(20) + '#', '#'.repeat(22)];
    const wide = () => {
      const info = startInfo(WIDE);
      return new TileMap(info.width, info.height, info.tiles as Uint8Array);
    };
    const orc = (x: number): EntState => ({ ...server(5, 0), kind: KIND.OrcWarrior, x, y: 24, side: SIDE.Hostile });
    const fly = (shots: Shots, ents: Map<number, EntState>) => {
      const ended: [string, number, number][] = [];
      for (let i = 0; i < 200 && shots.live.length > 0; i++) {
        shots.update(0.01, i * 0.01, { map: wide(), ents, rtt: 50, interpDelay: 0.1 }, (s, how) => ended.push([how, s.x, s.y]));
      }
      return ended;
    };

    it("ends 'landed' at its landing point", () => {
      const shots = new Shots();
      shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 200, range: 260 }), 2, 1, { x: 24, y: 24 }, 0, undefined, 100);
      expect(fly(shots, new Map())).toEqual([['landed', 124, 24]]);
    });

    it("knows the server copy of an own shot that landed ('ownLanded'), not another's or one that was not landed", () => {
      const shots = new Shots();
      shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 200, range: 260 }), 2, 1, { x: 24, y: 24 }, 0, undefined, 100);
      expect(shots.ownLanded((1 << 16) | 7, 1)).toBe(false); // still flying
      fly(shots, new Map());
      expect(shots.ownLanded((1 << 16) | 7, 1)).toBe(true);
      expect(shots.ownLanded((2 << 16) | 7, 1)).toBe(false); // another hero's shot with the same number
      expect(shots.ownLanded((1 << 16) | 8, 1)).toBe(false);
      // a shot that ends at an enemy is not a landing
      const hit = new Shots();
      hit.spawn(KIND.Arrow, 9, 0, ability('Shoot', { speed: 290, range: 260 }), 2, 1, { x: 24, y: 24 }, 0, undefined, 260);
      fly(hit, new Map([[5, orc(284)]]));
      expect(hit.ownLanded((1 << 16) | 9, 1)).toBe(false);
    });

    it('flies over an enemy halfway on a far shot and hits one at the landing point', () => {
      const a = ability('Shoot', { speed: 290, range: 260 });
      const over = new Shots();
      over.spawn(KIND.Arrow, 7, 0, a, 2, 1, { x: 24, y: 24 }, 0, undefined, 260);
      expect(fly(over, new Map([[5, orc(154)]]))[0][0]).toBe('landed');
      const at = new Shots();
      at.spawn(KIND.Arrow, 7, 0, a, 2, 1, { x: 24, y: 24 }, 0, undefined, 260);
      expect(fly(at, new Map([[5, orc(284)]]))[0][0]).toBe('enemy');
    });

    it('a flat shot is unchanged', () => {
      const shots = new Shots();
      shots.spawn(KIND.Arrow, 7, 0, ability('Shoot', { speed: 290, range: 260 }), 2, 1, { x: 24, y: 24 }, 0);
      expect(fly(shots, new Map([[5, orc(154)]]))[0][0]).toBe('enemy');
    });
  });
});

import { describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
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
});

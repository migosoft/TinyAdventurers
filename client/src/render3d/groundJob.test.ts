import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { paintGround } from '../game/woodland/ground';
import { TILE, TileMap } from '../sim/map';
import { groundJob, GROUND_BUDGET_MS } from './groundJob';

const floorMap = (): TileMap => new TileMap(6, 4, new Uint8Array(6 * 4).fill(TILE_ID.Floor));

/** A clock that advances 1 ms per call. */
const ticking = (): (() => number) => {
  let t = 0;
  return () => t++;
};

const rowSum = (img: { w: number; data: Uint8ClampedArray }, ty: number): number => {
  let s = 0;
  for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = 0; x < img.w; x++) s += img.data[(y * img.w + x) * 4 + 3];
  return s;
};

describe('groundJob', () => {
  it('has a 4 ms budget', () => {
    expect(GROUND_BUDGET_MS).toBe(4);
  });

  it('gives the same image as paintGround, byte for byte', () => {
    const map = floorMap();
    const job = groundJob(map, 7, 1);
    expect(job.done).toBe(false);
    const now = ticking();
    let guard = 0;
    while (!job.done && guard++ < 10_000) job.step(3, now);
    expect(job.done).toBe(true);
    const want = paintGround(map, 7);
    const got = job.image();
    expect(got.w).toBe(want.w);
    expect(got.h).toBe(want.h);
    expect(Array.from(got.data)).toEqual(Array.from(want.data));
  });

  it('does one unit of work even with a budget of 0, so it always ends', () => {
    const job = groundJob(floorMap(), 7, 0);
    let calls = 0;
    while (!job.done && calls < 100) {
      job.step(0, () => 0);
      calls++;
    }
    expect(job.done).toBe(true);
    expect(calls).toBe(4 + 2); // four bands, blades, flowers
  });

  it('returns true on the call that finishes and false before', () => {
    const job = groundJob(floorMap(), 7, 0);
    const results: boolean[] = [];
    while (!job.done) results.push(job.step(0, () => 0));
    expect(results.slice(0, -1).every((r) => !r)).toBe(true);
    expect(results[results.length - 1]).toBe(true);
  });

  it('paints the spawn row first', () => {
    const job = groundJob(floorMap(), 7, 2);
    job.step(0, () => 0);
    const img = job.image();
    expect(rowSum(img, 2)).toBeGreaterThan(0);
    expect(rowSum(img, 0)).toBe(0);
    expect(rowSum(img, 3)).toBe(0);
  });
});

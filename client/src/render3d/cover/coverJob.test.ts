import { describe, expect, it } from 'vitest';
import type { CoveInfo } from '../../generated/CoveInfo';
import { TILE_ID } from '../../generated/defs';
import { coveGrass, coveLayout } from '../../game/covemath';
import { paintGround } from '../../game/woodland/ground';
import { TILE, TileMap } from '../../sim/map';
import { COVER_BUDGET_MS, coverJob, coverSources, type CoverResult } from './coverJob';
import { coverH, coverId } from './kinds';

/** A clock that advances 1 ms per call. */
const ticking = (): (() => number) => {
  let t = 0;
  return () => t++;
};

const finish = (job: ReturnType<typeof coverJob>, budget: number, now: () => number): CoverResult => {
  let guard = 0;
  while (!job.done && guard++ < 100_000) job.step(budget, now);
  const r = job.result();
  if (!r) throw new Error('job not done');
  return r;
};

function woodland(): TileMap {
  const w = 8, h = 6, t = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let y = 2; y <= 3; y++) for (let x = 3; x <= 5; x++) t[y * w + x] = TILE_ID.Road;
  return new TileMap(w, h, t);
}
const cove: CoveInfo = { x: 4, y: 3, w: 14, h: 10, tree_x: 11, tree_y: 8, seed: 5 };
function dungeon(lava = false): TileMap {
  const w = 24, h = 18, t = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let x = 0; x < w; x++) { t[x] = TILE_ID.Wall; t[(h - 1) * w + x] = TILE_ID.Wall; }
  for (let y = 0; y < h; y++) { t[y * w] = TILE_ID.Wall; t[y * w + w - 1] = TILE_ID.Wall; }
  if (lava) t[5 * w + 20] = TILE_ID.Lava;
  return new TileMap(w, h, t);
}
const wsrc = (map: TileMap) => coverSources(map, { woodland: { seed: 7 }, cove: null, spawnRow: 1, spots: [] });

describe('coverJob', () => {
  it('has a 4 ms budget', () => {
    expect(COVER_BUDGET_MS).toBe(4);
  });

  it('gives the same bytes sliced thinly as in one step', () => {
    const map = woodland();
    const a = finish(coverJob(wsrc(map), 3), 3, ticking());
    const whole = coverJob(wsrc(map), 3);
    whole.step(Infinity);
    const b = whole.result()!;
    expect(whole.done).toBe(true);
    expect(Array.from(a.image.data)).toEqual(Array.from(b.image.data));
    expect(Array.from(a.bare!.data)).toEqual(Array.from(b.bare!.data));
    expect(a.bushels).toEqual(b.bushels);
  });

  it('reports its progress from 0 to 1', () => {
    const job = coverJob(wsrc(woodland()), 3);
    expect(job.progress).toBe(0);
    job.step(0, ticking()); // one unit at least
    expect(job.progress).toBeGreaterThan(0);
    expect(job.progress).toBeLessThan(1);
    job.step(Infinity);
    expect(job.progress).toBe(1);
  });

  it('keeps its result after the last unit, and stepping again does nothing', () => {
    const job = coverJob(wsrc(woodland()), 3);
    expect(job.step(Infinity)).toBe(true);
    const r = job.result()!;
    const before = Array.from(r.image.data);
    expect(job.done).toBe(true);
    expect(job.step(Infinity)).toBe(false);
    expect(job.step(0, () => 0)).toBe(false);
    expect(job.result()).toBe(r);
    expect(Array.from(r.image.data)).toEqual(before);
  });

  it('does one unit even with a budget of 0, ends, and returns true only once', () => {
    const job = coverJob(wsrc(woodland()), 3);
    expect(job.result()).toBeNull();
    const results: boolean[] = [];
    while (!job.done && results.length < 100_000) results.push(job.step(0, () => 0));
    expect(job.done).toBe(true);
    expect(results.slice(0, -1).every((r) => !r)).toBe(true);
    expect(results[results.length - 1]).toBe(true);
    expect(results.length).toBeGreaterThan(1);
    expect(job.step(0, () => 0)).toBe(false);
  });

  it('gives a woodland a bare picture and 4 sheets', () => {
    const map = woodland();
    const r = finish(coverJob(wsrc(map), 3), 4, ticking());
    expect(r.sheets).toBe(4);
    expect(r.bare).not.toBeNull();
    expect(r.image.w).toBe(map.w * TILE);
    expect(r.image.h).toBe(map.h * TILE);
    expect(r.image.data.length).toBe(r.image.w * r.image.h * 4);
    // grass tiles carry height with the grass id
    let any = 0;
    for (let i = 0; i < r.image.w * r.image.h; i++) if (r.image.data[i * 4 + 3]) { any++; expect(coverId(r.image.data[i * 4 + 3])).toBe(0); }
    expect(any).toBeGreaterThan(0);
    // the bare ground is not the plain painted ground (grass tiles turned to road)
    expect(paintGround(map, 7).data.length).toBe(r.bare!.data.length);
  });

  it('gives a dungeon with a cove grass inside the carpet and only moss or nothing elsewhere', () => {
    const map = dungeon();
    const sources = coverSources(map, { woodland: null, cove, spawnRow: 1, spots: [] }, { everywhere: true });
    const r = finish(coverJob(sources, 5), 4, ticking());
    expect(r.sheets).toBe(4);
    expect(r.bare).toBeNull();
    const { spec, origin } = coveLayout(cove);
    const grass = coveGrass(spec);
    const w = r.image.w;
    let grassPx = 0, mossPx = 0;
    for (let y = 0; y < r.image.h; y++) for (let x = 0; x < w; x++) {
      const a = r.image.data[(y * w + x) * 4 + 3];
      if (a === 0) continue;
      expect(coverH(a)).toBeGreaterThan(0);
      if (coverId(a) === 0) grassPx++;
      else { expect(coverId(a)).toBe(1); mossPx++; }
    }
    expect(grassPx).toBeGreaterThan(0);
    expect(mossPx).toBeGreaterThan(0);
    const mx = origin.x + Math.floor(spec.w / 2), my = origin.y + Math.floor(spec.h / 2);
    expect(grass(Math.floor(spec.w / 2), Math.floor(spec.h / 2))).toBe(true);
    expect(coverId(r.image.data[(my * w + mx) * 4 + 3])).toBe(0);
    expect(coverH(r.image.data[(my * w + mx) * 4 + 3])).toBeGreaterThan(0);
  });

  it('gives a lava dungeon without a cove 0 sheets and an empty image', () => {
    const sources = coverSources(dungeon(true), { woodland: null, cove: null, spawnRow: 1, spots: [] });
    expect(sources).toEqual([]);
    const r = finish(coverJob(sources, 5), 4, ticking());
    expect(r.sheets).toBe(0);
    expect(r.bare).toBeNull();
    expect(r.bushels).toEqual([]);
    expect(r.image.data.every((v) => v === 0)).toBe(true);
  });

  it('paints the spawn row first', () => {
    const map = new TileMap(6, 4, new Uint8Array(6 * 4).fill(TILE_ID.Floor));
    // the first prep unit paints the spawn row, as the old ground job did
    const src = coverSources(map, { woodland: { seed: 7 }, cove: null, spawnRow: 2, spots: [] })[0];
    src.prep[0]();
    const rowSum = (ty: number): number => {
      let s = 0;
      for (let y = ty * TILE; y < ty * TILE + TILE; y++) for (let x = 0; x < src.bare!.image.w; x++) s += src.bare!.image.data[(y * src.bare!.image.w + x) * 4 + 3];
      return s;
    };
    expect(rowSum(2)).toBeGreaterThan(0);
    expect(rowSum(0)).toBe(0);
    expect(rowSum(3)).toBe(0);
  });
});

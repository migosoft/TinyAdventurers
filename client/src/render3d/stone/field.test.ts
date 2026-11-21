import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { kindAt, LAID, ROCK, rockAmount, stoneField } from './field';

const W = 24, H = 12;
/** An open floor map; `door` puts a closed door at (door.x, door.y). */
function room(door?: { x: number; y: number }): TileMap {
  const tiles = new Uint8Array(W * H).fill(TILE_ID.Floor);
  const m = new TileMap(W, H, tiles);
  if (door) m.set(door.x, door.y, TILE_ID.DoorClosed);
  return m;
}
/** Cells with x >= 12 are rock: a straight border at x = 12. */
function halves(): Uint8Array {
  const k = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 12; x < W; x++) k[y * W + x] = ROCK;
  return k;
}

describe('stone field', () => {
  it('missing_kinds_are_all_laid', () => {
    const m = room();
    for (const kinds of [null, undefined, new Uint8Array(0), new Uint8Array(W * H - 1)]) {
      const f = stoneField(m, kinds);
      expect(f.kinds.length).toBe(W * H);
      expect(f.kinds.every((k) => k === LAID)).toBe(true);
      expect(rockAmount(f, m, 18, 6)).toBe(0);
    }
  });

  it('keeps kinds of the right length and defaults the seed to the map', () => {
    const m = room();
    const f = stoneField(m, halves());
    expect(f.w).toBe(W);
    expect(f.h).toBe(H);
    expect(kindAt(f, 13, 5)).toBe(ROCK);
    expect(f.seed).toBe(stoneField(m).seed);
    expect(stoneField(m, halves(), 7).seed).toBe(7);
  });

  it('kindAt clamps outside the map', () => {
    const f = stoneField(room(), halves());
    expect(kindAt(f, -5, 3)).toBe(LAID);
    expect(kindAt(f, 99, 3)).toBe(ROCK);
    expect(kindAt(f, 3, -9)).toBe(LAID);
    expect(kindAt(f, 20, 99)).toBe(ROCK);
  });

  it('rockAmount is 0 deep in laid and 1 deep in rock', () => {
    const m = room();
    const f = stoneField(m, halves());
    for (let z = 2; z < 10; z += 1.7) {
      expect(rockAmount(f, m, 4.3, z)).toBe(0);
      expect(rockAmount(f, m, 19.6, z)).toBe(1);
    }
  });

  it('rockAmount is strictly between within half a tile of a straight border (the wobble moves it up to 0.4)', () => {
    const m = room();
    const f = stoneField(m, halves());
    for (let z = 2; z < 10; z += 0.37) for (const x of [11.55, 11.8, 12, 12.2, 12.45]) {
      const a = rockAmount(f, m, x, z);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('rockAmount strictly increases across a straight border', () => {
    const m = room();
    const f = stoneField(m, halves());
    for (let z = 2; z < 10; z += 0.37) {
      const xs = [11.2, 11.6, 12.0, 12.4, 12.8].map((x) => rockAmount(f, m, x, z));
      for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  it('rockAmount is equal for equal inputs', () => {
    const m = room();
    const f = stoneField(m, halves());
    expect(rockAmount(f, m, 12.3, 5.7)).toBe(rockAmount(f, m, 12.3, 5.7));
    expect(rockAmount(stoneField(m, halves()), m, 12.3, 5.7)).toBe(rockAmount(f, m, 12.3, 5.7));
  });

  it('rockAmount is 0 beside a door inside rock', () => {
    const m = room({ x: 18, y: 6 });
    const f = stoneField(m, halves());
    expect(rockAmount(f, m, 18.5, 6.5)).toBe(0);
    expect(rockAmount(f, m, 19.9, 6.5)).toBe(0);
    expect(rockAmount(f, m, 18.5, 5.2)).toBe(0);
    expect(rockAmount(f, m, 18.5, 10.5)).toBe(1);
    const fade = rockAmount(f, m, 18.5, 4.5); // 2 tiles from the door: in the fade band
    expect(fade).toBeGreaterThan(0);
    expect(fade).toBeLessThan(1);
  });
});

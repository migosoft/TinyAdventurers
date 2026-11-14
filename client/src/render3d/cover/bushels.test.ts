import { describe, expect, it } from 'vitest';
import { placeBushels } from './bushels';
import { COVER } from './kinds';
import type { BushelSpot } from './source';

const look = COVER.grass.bushels!;
const W = 40 * 16, H = 30 * 16; // 40 x 30 tiles
function field(f: (px: number, py: number) => number): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x, y);
  return a;
}
const full = field(() => 4);
const at = (a: Uint8Array, x: number, z: number) =>
  a[Math.min(H - 1, Math.max(0, Math.floor(z * 16))) * W + Math.min(W - 1, Math.max(0, Math.floor(x * 16)))];

describe('placeBushels', () => {
  it('stands every bushel on thick cover, in the size ranges, on the 1/16 grid', () => {
    const list = placeBushels(full, W, H, look, 7);
    expect(list.length).toBeGreaterThan(20);
    for (const b of list) {
      expect(at(full, b.x, b.z)).toBeGreaterThanOrEqual(2);
      expect(b.w).toBeGreaterThanOrEqual(look.w[0]); expect(b.w).toBeLessThanOrEqual(look.w[1]);
      expect(b.h).toBeGreaterThanOrEqual(look.h[0]); expect(b.h).toBeLessThanOrEqual(look.h[1]);
      expect(b.x * 16).toBeCloseTo(Math.round(b.x * 16)); expect(b.z * 16).toBeCloseTo(Math.round(b.z * 16));
      expect(b.fern).toBe(false);
    }
  });
  it('respects the foot rule on patchy cover', () => {
    const patchy = field((x, y) => ((x >> 5) + (y >> 5)) % 2 ? 4 : 1);
    const list = placeBushels(patchy, W, H, look, 3);
    expect(list.length).toBeGreaterThan(0);
    for (const b of list) {
      expect(at(patchy, b.x, b.z)).toBeGreaterThanOrEqual(2);
      expect(at(patchy, b.x - 0.4, b.z)).toBeGreaterThanOrEqual(1);
      expect(at(patchy, b.x + 0.4, b.z)).toBeGreaterThanOrEqual(1);
    }
  });
  it('places none on an all-zero image', () => {
    expect(placeBushels(new Uint8Array(W * H), W, H, look, 1)).toEqual([]);
  });
  it('places roughly twice as many when the density doubles', () => {
    const one = placeBushels(full, W, H, look, 5, () => 1).length;
    const two = placeBushels(full, W, H, look, 5, () => 2).length;
    expect(two).toBeGreaterThan(one * 1.7);
    expect(two).toBeLessThan(one * 2.3);
  });
  it('is deterministic', () => {
    expect(placeBushels(full, W, H, look, 9)).toEqual(placeBushels(full, W, H, look, 9));
    expect(placeBushels(full, W, H, look, 9)).not.toEqual(placeBushels(full, W, H, look, 10));
  });
  it('gives a spot its count of bushels, ferns with fern sizes', () => {
    const none = field(() => 0);
    const grass: BushelSpot = { x: 10, z: 10, fern: false, count: 4 };
    const fern: BushelSpot = { x: 20, z: 15, fern: true, count: 5 };
    const list = placeBushels(none.fill(4), W, H, look, 2, undefined, [grass, fern]);
    // spots add to the clusters, so count the ones near each spot
    const near = (s: BushelSpot) => list.filter((b) => Math.abs(b.x - s.x) <= 5 / 16 && Math.abs(b.z - s.z) <= 5 / 16);
    expect(near(grass).length).toBeGreaterThanOrEqual(4);
    const ferns = list.filter((b) => b.fern);
    expect(ferns.length).toBe(5);
    for (const b of ferns) {
      expect(b.w).toBeGreaterThanOrEqual(look.fernW[0]); expect(b.w).toBeLessThanOrEqual(look.fernW[1]);
      expect(b.h).toBeGreaterThanOrEqual(look.fernH[0]); expect(b.h).toBeLessThanOrEqual(look.fernH[1]);
    }
  });
  it('gives a spot over bare ground nothing', () => {
    const list = placeBushels(new Uint8Array(W * H), W, H, look, 2, undefined, [{ x: 10, z: 10, fern: true, count: 5 }]);
    expect(list).toEqual([]);
  });
});

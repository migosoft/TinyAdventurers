import { describe, expect, it } from 'vitest';
import { newPlantBuf, pushPlant, type PlantPlace, type PlantSprite } from './plants';

const place = (over: Partial<PlantPlace> = {}): PlantPlace => ({ x: 10, z: 20, mirrored: false, amp: 0.11, seed: 7, ...over });
const sprite = (over: Partial<PlantSprite> = {}): PlantSprite => ({ rect: { x: 100, y: 200, w: 32, h: 64 }, foot: { x: 16, y: 56 }, ...over });
const col = (a: number[], k: number, size: number) => a.filter((_, i) => i % size === k);
const range = (a: number[]) => [Math.min(...a), Math.max(...a)];

describe('pushPlant', () => {
  it('writes the upright card above the foot, 6 vertices, and nothing for the rows below it', () => {
    const b = newPlantBuf();
    pushPlant(b, place(), sprite());
    expect(b.n).toBe(6);
    expect(range(col(b.corner, 1, 2))).toEqual([0, 56 / 16]);
    expect(range(col(b.uv, 1, 2))).toEqual([200, 256]);
    expect(b.foot.slice(0, 2)).toEqual([10, 20]);
    expect(b.sway.slice(0, 2)).toEqual([0.11, 56 / 16]);
  });
  it('keeps uv inside the rect and swaps u for a mirrored plant', () => {
    const a = newPlantBuf(), m = newPlantBuf();
    pushPlant(a, place(), sprite());
    pushPlant(m, place({ mirrored: true }), sprite({ foot: { x: 10, y: 56 } }));
    for (const b of [a, m]) {
      const [u0, u1] = range(col(b.uv, 0, 2)), [v0, v1] = range(col(b.uv, 1, 2));
      expect(u0).toBeGreaterThanOrEqual(100); expect(u1).toBeLessThanOrEqual(132);
      expect(v0).toBeGreaterThanOrEqual(200); expect(v1).toBeLessThanOrEqual(264);
    }
    // vertex 0 is the top left: unmirrored reads the rect's left edge, mirrored its right edge
    expect(a.uv[0]).toBe(100);
    expect(m.uv[0]).toBe(132);
    expect(a.corner[0]).toBeCloseTo(-16 / 16);
    expect(m.corner[0]).toBeCloseTo(-(32 - 10) / 16);
  });
});

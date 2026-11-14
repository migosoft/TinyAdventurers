import { describe, expect, it } from 'vitest';
import type { CoverResult } from './coverJob';
import { CoverField } from './coverField';
import { encodeCover, GH_MAX } from './kinds';

/** A cover result of w x h tiles with the given art px heights set (kind id 0). */
function result(wTiles: number, hTiles: number, px: [number, number, number][]): CoverResult {
  const w = wTiles * 16, h = hTiles * 16;
  const data = new Uint8Array(w * h * 4);
  for (const [x, y, height] of px) data[(y * w + x) * 4 + 3] = encodeCover(height, 0);
  return { image: { w, h, data }, bare: null, bushels: [], sheets: 4 };
}

describe('CoverField', () => {
  it('is 0 without cover', () => {
    expect(new CoverField(null).topAt(3, 3, 0.3, 1)).toBe(0);
  });

  it('reads the cover height at a point in tiles (px / 16)', () => {
    const f = new CoverField(result(4, 4, [[40, 24, 4]])); // px (40, 24) is tile (2.5, 1.5)
    expect(f.topAt(2.5, 1.5, 0, 1)).toBeCloseTo(4 / 16, 6);
    expect(f.topAt(3.5, 1.5, 0, 1)).toBe(0);
  });

  it('takes the largest height of the centre and the four points at +-r', () => {
    const f = new CoverField(result(4, 4, [[40, 24, 2], [40 + 8, 24, 4], [40, 24 - 8, 3]]));
    expect(f.topAt(2.5, 1.5, 0, 1)).toBeCloseTo(2 / 16, 6);
    expect(f.topAt(2.5, 1.5, 0.5, 1)).toBeCloseTo(4 / 16, 6); // the +x point
    const g = new CoverField(result(4, 4, [[40, 24 - 8, 3]]));
    expect(g.topAt(2.5, 1.5, 0.5, 1)).toBeCloseTo(3 / 16, 6); // the -z point
  });

  it('scales with gh, clamped to 0..GH_MAX like the layer', () => {
    const f = new CoverField(result(4, 4, [[40, 24, 4]]));
    expect(f.topAt(2.5, 1.5, 0, 2)).toBeCloseTo(8 / 16, 6);
    expect(f.topAt(2.5, 1.5, 0, 0)).toBe(0);
    expect(f.topAt(2.5, 1.5, 0, 99)).toBeCloseTo((4 * GH_MAX) / 16, 6);
  });

  it('is 0 outside the image', () => {
    const f = new CoverField(result(2, 2, [[0, 0, 4]]));
    expect(f.topAt(-5, -5, 0.3, 1)).toBe(0);
    expect(f.topAt(99, 99, 0.3, 1)).toBe(0);
  });
});

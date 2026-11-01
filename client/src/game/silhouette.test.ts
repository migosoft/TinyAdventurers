import { describe, expect, it } from 'vitest';
import { behindOccluder, heroBox } from './silhouette';

// canopy box: x 100-196, top 20, trunk foot y 99
const OCC = { left: 100, right: 196, top: 20, footY: 99 };

describe('behindOccluder', () => {
  it('true: north of the trunk foot, inside the canopy box', () => {
    expect(behindOccluder({ left: 140, right: 156, top: 40, footY: 70 }, OCC)).toBe(true);
  });
  it('false: same box but the feet are below the trunk foot', () => {
    expect(behindOccluder({ left: 140, right: 156, top: 80, footY: 110 }, OCC)).toBe(false);
  });
  it('false: north but left of the box', () => {
    expect(behindOccluder({ left: 60, right: 90, top: 40, footY: 70 }, OCC)).toBe(false);
  });
  it('true: head above the canopy top but feet behind', () => {
    expect(behindOccluder({ left: 140, right: 156, top: 10, footY: 40 }, OCC)).toBe(true);
  });
});

describe('heroBox', () => {
  it('judges "behind" by the sprite y, not the bounds bottom (untrimmed frame, bottom 14 px below y)', () => {
    const bounds = { left: 140, right: 156, top: 70 };
    const box = heroBox(bounds, 90); // y 90 < 99, bounds.bottom 104 > 99
    expect(box.footY).toBe(90);
    expect(behindOccluder(box, OCC)).toBe(true);
  });
});

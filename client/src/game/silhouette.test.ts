import { describe, expect, it } from 'vitest';
import { behindOccluder, copyProps } from './silhouette';

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

describe('copyProps', () => {
  it('copies flipX, origin, position and scale of the hero', () => {
    const hero = { x: 5, y: 9, flipX: true, originX: 0.5, originY: 0.8, scaleX: 2, scaleY: 3 };
    expect(copyProps(hero)).toEqual(hero);
  });
});

import { describe, expect, it } from 'vitest';
import { coveLayout } from './cove';

describe('coveLayout', () => {
  it('a 26x20 cove: origin, trunk foot and spec in world px', () => {
    const l = coveLayout({ x: 10, y: 20, w: 26, h: 20, tree_x: 23, tree_y: 30, seed: 5 });
    expect(l.origin).toEqual({ x: 160, y: 320 });
    expect(l.foot).toEqual({ x: 376, y: 496 });
    expect(l.spec).toEqual({ w: 416, h: 320, tree: { x: 216, y: 176 }, seed: 5 });
  });
  it('a rotated 20x26 cove', () => {
    const l = coveLayout({ x: 10, y: 20, w: 20, h: 26, tree_x: 23, tree_y: 30, seed: 5 });
    expect(l.origin).toEqual({ x: 160, y: 320 });
    expect(l.foot).toEqual({ x: 376, y: 496 });
    expect(l.spec).toEqual({ w: 320, h: 416, tree: { x: 216, y: 176 }, seed: 5 });
  });
});

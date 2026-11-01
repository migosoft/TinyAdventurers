import { describe, expect, it } from 'vitest';
import { pixieAt, wingUp } from './pixies';

const C = { x: 100, y: 60 };

describe('pixies', () => {
  it('pixieAt stays in the ellipse', () => {
    for (let i = 0; i < 7; i++) {
      for (let k = 0; k < 1000; k++) {
        const p = pixieAt(i, (k / 999) * 60, C, 202);
        expect(((p.x - C.x) / 56) ** 2 + ((p.y - C.y) / 32) ** 2).toBeLessThanOrEqual(1.05);
      }
    }
  });
  it('pixieAt is deterministic and pixies differ', () => {
    expect(pixieAt(3, 12.5, C, 202)).toEqual(pixieAt(3, 12.5, C, 202));
    const a = pixieAt(0, 12.5, C, 202);
    const b = pixieAt(1, 12.5, C, 202);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(4);
  });
  it('pixieAt moves smoothly', () => {
    for (let i = 0; i < 7; i++) {
      for (let k = 0; k < 600; k++) {
        const a = pixieAt(i, k / 60, C, 202);
        const b = pixieAt(i, (k + 1) / 60, C, 202);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(2);
      }
    }
  });
  it('wings flicker every frame', () => {
    for (let i = 0; i < 7; i++) {
      for (let f = 0; f < 20; f++) expect(wingUp(i, f)).not.toBe(wingUp(i, f + 1));
    }
  });
});

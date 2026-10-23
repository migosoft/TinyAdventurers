import { describe, expect, it } from 'vitest';
import { DEPTH, numberDepth } from './effects';

describe('numbers and bars against the darkness', () => {
  it('draws hero numbers and bars over the darkness', () => {
    expect(numberDepth(true)).toBe(DEPTH.numbers);
    expect(numberDepth(true)).toBeGreaterThan(DEPTH.fog);
    expect(DEPTH.heroBars).toBeGreaterThan(DEPTH.fog);
    expect(DEPTH.heroBars).toBeLessThan(DEPTH.numbers);
  });
  it('draws enemy numbers and bars under the darkness, over figures and effects', () => {
    expect(numberDepth(false)).toBe(DEPTH.enemyNumbers);
    for (const d of [DEPTH.enemyBars, DEPTH.enemyNumbers]) {
      expect(d).toBeLessThan(DEPTH.tint);
      expect(d).toBeGreaterThan(DEPTH.fx);
    }
    expect(DEPTH.enemyBars).toBeLessThan(DEPTH.enemyNumbers);
  });
});

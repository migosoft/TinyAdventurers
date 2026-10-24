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

describe('the dungeon air depths', () => {
  it('sits over effects and under enemy bars, ordered haze to embers', () => {
    const air = [DEPTH.airHaze, DEPTH.airDust, DEPTH.airSmoke, DEPTH.airDrips, DEPTH.airEmbers];
    for (const d of air) {
      expect(d).toBeGreaterThan(DEPTH.fx);
      expect(d).toBeLessThan(DEPTH.enemyBars);
    }
    expect([...air].sort((a, b) => a - b)).toEqual(air);
    expect(new Set(air).size).toBe(air.length);
  });
  it('draws torch smoke just over the darkness and under the lich beams', () => {
    expect(DEPTH.torchSmoke).toBeGreaterThan(DEPTH.fog);
    expect(DEPTH.torchSmoke).toBeLessThan(DEPTH.beam);
  });
});

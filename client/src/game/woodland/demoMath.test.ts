import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOUDS } from './clouds';
import { nextSeed, stepCloud, stepToward, zoomForTiles } from './demoMath';

describe('woodland demo math', () => {
  it('steps each cloud value up and down without float drift', () => {
    let l = DEFAULT_CLOUDS;
    for (let i = 0; i < 3; i++) l = stepCloud(l, 'dark', 1);
    expect(l.dark).toBe(0.34);
    l = stepCloud(l, 'dark', -1);
    expect(l.dark).toBe(0.3);
    expect(stepCloud(l, 'size', 1).size).toBe(420);
    expect(stepCloud(l, 'speed', -1).speed).toBe(10);
    expect(stepCloud(l, 'cover', 1).cover).toBe(0.4);
  });
  it('clamps at the ends of the range', () => {
    expect(stepCloud({ ...DEFAULT_CLOUDS, dark: 0.02 }, 'dark', -1).dark).toBe(0);
    expect(stepCloud({ ...DEFAULT_CLOUDS, cover: 0.98 }, 'cover', 1).cover).toBe(1);
    expect(stepCloud({ ...DEFAULT_CLOUDS, size: 130 }, 'size', -1).size).toBe(120);
  });
  it('fits 20 tiles across the width', () => {
    expect(zoomForTiles(320, 20, 16)).toBe(1);
    expect(zoomForTiles(412, 20, 16) * 20 * 16).toBeCloseTo(412);
  });
  it('wraps the seed', () => {
    expect([nextSeed(1, 3), nextSeed(2, 3), nextSeed(3, 3)]).toEqual([2, 3, 1]);
  });
  it('walks towards a target and arrives', () => {
    expect(stepToward(0, 0, 10, 0, 4)).toEqual({ x: 4, y: 0, arrived: false });
    expect(stepToward(8, 0, 10, 0, 4)).toEqual({ x: 10, y: 0, arrived: true });
  });
});

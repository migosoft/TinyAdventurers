import { describe, expect, it } from 'vitest';
import { BurstOnce, cloudCount, dustTint, spawnCount } from './moodmath';

describe('cloudCount', () => {
  it('scales with the world area and clamps to 4..24', () => {
    expect(cloudCount(240, 256)).toBe(7);
    expect(cloudCount(640, 360)).toBe(24);
    expect(cloudCount(32, 32)).toBe(4);
  });
});

describe('spawnCount', () => {
  it('returns whole spawns and the remainder', () => {
    const [c, a] = spawnCount(0, 1, 12, 4.2);
    expect(c).toBe(2);
    expect(a).toBeCloseTo(0.857, 3);
  });
  it('carries the remainder into the next call', () => {
    const [c1, a1] = spawnCount(0.9, 0.05, 1, 1);
    expect(c1).toBe(0);
    expect(a1).toBeCloseTo(0.95, 6);
    const [c2, a2] = spawnCount(a1, 0.05, 1, 1);
    expect(c2).toBe(1);
    expect(a2).toBeCloseTo(0, 6);
  });
  it('spawns nothing and resets with no sources', () => {
    expect(spawnCount(0.5, 1, 0, 4.2)).toEqual([0, 0]);
    expect(spawnCount(0.5, 1, 3, Infinity)).toEqual([0, 0]);
  });
});

describe('dustTint', () => {
  it('takes brightness from the brightest channel and blends the hue halfway to white', () => {
    expect(dustTint(255, 170, 90)).toEqual([1, 0xffd5ad]);
    expect(dustTint(0, 0, 0)[0]).toBe(0);
  });
});

describe('BurstOnce', () => {
  it('reports each key once while it stays present', () => {
    const b = new BurstOnce();
    expect(b.fresh(['a'])).toEqual(['a']);
    expect(b.fresh(['a'])).toEqual([]);
    expect(b.fresh([])).toEqual([]);
    expect(b.fresh(['a'])).toEqual(['a']);
  });
});

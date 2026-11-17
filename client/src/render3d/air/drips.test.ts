import { describe, expect, it } from 'vitest';
import { DRIP_EVERY, MAX_DRIPS } from '../../game/moodmath';
import { WATER_LEVEL } from '../dips/shape';
import { newParts } from './airParts';
import { DRIP_FALL, Drips } from './drips';
import { seeded } from './air.testutil';

const water = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [10 + (i % 30), 10 + Math.floor(i / 30)]);

describe('drips', () => {
  it('spawns about n / DRIP_EVERY per second', () => {
    const d = new Drips(seeded(1));
    const parts = newParts();
    const w = water(2);
    for (let i = 0; i < 70 / 0.05; i++) d.step(0.05, w, true, parts);
    expect(d.spawned).toBeGreaterThanOrEqual((70 * 2) / DRIP_EVERY - 8);
    expect(d.spawned).toBeLessThanOrEqual((70 * 2) / DRIP_EVERY + 8);
  });

  it('never has more than MAX_DRIPS at once, and the parts stay inside their arrays', () => {
    const d = new Drips(seeded(2));
    const parts = newParts();
    const w = water(600);
    let peak = 0;
    for (let i = 0; i < 400; i++) {
      d.step(0.05, w, true, parts);
      peak = Math.max(peak, d.count);
      expect(d.count).toBeLessThanOrEqual(MAX_DRIPS);
      expect(parts.drops.count).toBeLessThanOrEqual(parts.drops.alpha.length);
      expect(parts.landed.count).toBeLessThanOrEqual(MAX_DRIPS);
    }
    expect(peak).toBe(MAX_DRIPS);
  });

  it('a drop falls from above the walls onto the water, then two splash pixels hop from the water level', () => {
    const d = new Drips(seeded(3));
    const parts = newParts();
    const w = water(1);
    let guard = 0;
    while (parts.drops.count === 0 && guard++ < 2000) d.step(0.05, w, true, parts);
    expect(parts.drops.count).toBe(1);
    const y0 = parts.drops.pos[1];
    expect(y0).toBeGreaterThan(1.5);
    expect(parts.drops.splash[0]).toBe(0);
    d.step(0.2, w, true, parts);
    expect(parts.drops.pos[1]).toBeLessThan(y0);
    guard = 0;
    while (parts.drops.splash[0] !== 1 && guard++ < 100) d.step(0.05, w, true, parts);
    expect(parts.drops.count).toBe(2);
    expect(parts.drops.pos[1]).toBeGreaterThanOrEqual(WATER_LEVEL + 0.01 - 1e-6);
  });

  it('reports the landing once', () => {
    const d = new Drips(seeded(3));
    const parts = newParts();
    const w = water(1);
    let guard = 0;
    while (d.count === 0 && guard++ < 2000) d.step(0.05, w, true, parts);
    expect(d.count).toBe(1);
    expect(parts.landed.count).toBe(0);
    const x = parts.drops.pos[0], z = parts.drops.pos[2];
    d.step(DRIP_FALL - 0.06, w, true, parts);
    expect(parts.landed.count).toBe(0);
    d.step(0.1, w, true, parts);
    expect(parts.landed.count).toBe(1);
    expect(parts.landed.pos[0]).toBeCloseTo(x, 6);
    expect(parts.landed.pos[1]).toBeCloseTo(z, 6);
    d.step(0.05, w, true, parts);
    expect(parts.landed.count).toBe(0);
  });

  it('draws no ring', () => {
    const d = new Drips(seeded(3));
    const parts = newParts();
    expect('rings' in parts).toBe(false);
    let guard = 0;
    while (d.count === 0 && guard++ < 2000) d.step(0.05, water(1), true, parts);
    d.step(DRIP_FALL + 0.02, water(1), true, parts);
    // Only the two splash pixels of the landed drop.
    expect(parts.drops.count).toBe(2);
    expect(Array.from(parts.drops.splash.subarray(0, 2))).toEqual([1, 1]);
    expect(parts.drops.pos[1]).toBeGreaterThanOrEqual(WATER_LEVEL + 0.01 - 1e-6);
  });

  it('shows nothing and starts nothing with `on` false', () => {
    const d = new Drips(seeded(4));
    const parts = newParts();
    for (let i = 0; i < 400; i++) d.step(0.05, water(20), false, parts);
    expect(d.count).toBe(0);
    expect(parts.drops.count + parts.landed.count).toBe(0);
  });
});

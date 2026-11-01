import { describe, expect, it } from 'vitest';
import { AMBUSH_WARNING, deathCloud, HazeCloud, silhouetteAlpha } from './shadeHaze';

/** A steady pseudo-random source, so the tests do not flake. */
function lcg(seed = 7): () => number {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

const mean = (c: HazeCloud) => ({
  x: c.points.reduce((a, p) => a + p.x, 0) / c.points.length,
  y: c.points.reduce((a, p) => a + p.y, 0) / c.points.length,
});

describe('shade haze', () => {
  it('hazeTrailsWhenMoving: lags behind a 30 px move, then settles within 10 px', () => {
    const c = new HazeCloud(lcg());
    for (let i = 0; i < 30; i++) c.step({ x: 100, y: 100 }, 1 / 30);
    c.step({ x: 130, y: 100 }, 1 / 30);
    expect(mean(c).x).toBeLessThan(130 - 15);
    expect(mean(c).x).toBeGreaterThan(100);
    for (let i = 0; i < 15; i++) c.step({ x: 130, y: 100 }, 1 / 30);
    expect(Math.hypot(mean(c).x - 130, mean(c).y - 100)).toBeLessThan(10);
  });
  it('keeps 10 to 14 soft particles with alpha 0.35 to 0.5, each easing at its own rate', () => {
    const c = new HazeCloud(lcg());
    c.step({ x: 0, y: 0 }, 1 / 30);
    expect(c.points.length).toBeGreaterThanOrEqual(10);
    expect(c.points.length).toBeLessThanOrEqual(14);
    for (const p of c.points) {
      expect(p.alpha).toBeGreaterThanOrEqual(0.35);
      expect(p.alpha).toBeLessThanOrEqual(0.5);
    }
    // A step at once: they do not all land at the same spot.
    c.step({ x: 40, y: 0 }, 1 / 30);
    expect(new Set(c.points.map((p) => Math.round(p.x))).size).toBeGreaterThan(3);
  });
  it('hazeIsEmptyWhileInvisible: nothing while there is no target, and nothing left after it vanishes', () => {
    const c = new HazeCloud(lcg());
    c.step({ x: 10, y: 10 }, 1 / 30);
    expect(c.points.length).toBeGreaterThan(0);
    c.step(null, 1 / 30);
    expect(c.points).toEqual([]);
    c.step(null, 1 / 30);
    expect(c.points).toEqual([]);
  });
  it('starts again at the Shade when it reappears (no streak from where it vanished)', () => {
    const c = new HazeCloud(lcg());
    c.step({ x: 0, y: 0 }, 1 / 30);
    c.step(null, 1 / 30);
    c.step({ x: 200, y: 50 }, 1 / 30);
    expect(Math.hypot(mean(c).x - 200, mean(c).y - 50)).toBeLessThan(10);
  });
});

describe('silhouette warning', () => {
  it('silhouetteAlpha rises from 0.2 to 0.9 over AMBUSH_WARNING', () => {
    expect(AMBUSH_WARNING).toBe(0.5);
    expect(silhouetteAlpha(0)).toBeCloseTo(0.2, 10);
    expect(silhouetteAlpha(AMBUSH_WARNING)).toBeCloseTo(0.9, 10);
    expect(silhouetteAlpha(AMBUSH_WARNING / 2)).toBeCloseTo(0.55, 10);
    expect(silhouetteAlpha(-1)).toBeCloseTo(0.2, 10);
    expect(silhouetteAlpha(5)).toBeCloseTo(0.9, 10);
  });
});

describe('death cloud', () => {
  it('is about 20 particles that spread to at most 18 px over 0.8 s', () => {
    const cloud = deathCloud(lcg());
    expect(cloud.particles.length).toBeGreaterThanOrEqual(18);
    expect(cloud.particles.length).toBeLessThanOrEqual(22);
    for (const p of cloud.particles) expect(Math.hypot(p.vx, p.vy) * cloud.life).toBeLessThanOrEqual(18 + 1e-9);
    expect(cloud.life).toBe(0.8);
  });
});

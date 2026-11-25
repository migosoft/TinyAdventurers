import { describe, expect, it } from 'vitest';
import { growLeafy, growPlant, growWillow } from './grow';
import type { TreeForm, TreeSpec } from './spec';

const spec = (form: TreeForm, seed: number, scalePct = 100): TreeSpec => ({ form, x: 0, z: 0, seed, scalePct, mirrored: false, leaf: 1, dead: false });
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const FORMS = ['round', 'wide', 'tall'] as const;

/** Trunk radius at height `y`, interpolated between the skeleton's points. */
function trunkW(pts: { y: number; w: number }[], y: number): number {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (y >= a.y && y <= b.y) return a.w + ((b.w - a.w) * (y - a.y)) / (b.y - a.y || 1);
  }
  return pts[pts.length - 1].w;
}

describe('growLeafy', () => {
  it('is deterministic', () => {
    for (const f of FORMS) expect(growLeafy(spec(f, 5))).toEqual(growLeafy(spec(f, 5)));
  });

  it('gives every lobe a threshold in (0, 1], with some at 1 and some below 0.3', () => {
    for (const f of FORMS) for (const s of seeds) {
      const th = growLeafy(spec(f, s)).lobes.map((l) => l.th);
      expect(Math.min(...th)).toBeGreaterThan(0);
      expect(Math.max(...th)).toBeLessThanOrEqual(1);
      expect(Math.max(...th)).toBeCloseTo(1, 5);
      expect(Math.min(...th)).toBeLessThan(0.3);
    }
  });

  it('flares the trunk at the foot: radius at y = 0 is at least 1.6 x the radius at 0.3 tiles', () => {
    for (const f of FORMS) for (const s of seeds) {
      const k = growLeafy(spec(f, s));
      expect(k.trunk[0].y).toBeCloseTo(0, 5);
      expect(trunkW(k.trunk, 0)).toBeGreaterThanOrEqual(1.6 * trunkW(k.trunk, 0.3));
    }
  });

  it('has 3 to 5 root ridges that start at the flare and sink into the ground within 1.2 tiles of the foot', () => {
    for (const f of FORMS) for (const s of seeds) {
      const k = growLeafy(spec(f, s));
      expect(k.roots.length).toBeGreaterThanOrEqual(3);
      expect(k.roots.length).toBeLessThanOrEqual(5);
      for (const r of k.roots) {
        const a = r[0], e = r[r.length - 1];
        expect(a.y).toBeLessThanOrEqual(0.4);
        expect(Math.hypot(a.x - k.trunk[0].x, a.z - k.trunk[0].z)).toBeLessThanOrEqual(trunkW(k.trunk, 0));
        expect(e.y).toBeLessThanOrEqual(0);
        expect(Math.hypot(e.x, e.z)).toBeLessThanOrEqual(1.2);
      }
    }
  });

  it('grows taller with the scale', () => {
    for (const f of FORMS) expect(growLeafy(spec(f, 3, 120)).height).toBeGreaterThan(growLeafy(spec(f, 3, 50)).height);
  });
});

describe('growWillow and growPlant', () => {
  it('are deterministic', () => {
    expect(growWillow(spec('willow', 5))).toEqual(growWillow(spec('willow', 5)));
    for (const f of ['conifer', 'bush'] as const) expect(growPlant(spec(f, 5))).toEqual(growPlant(spec(f, 5)));
  });

  it('refuse the wrong form', () => {
    expect(() => growPlant(spec('willow', 1))).toThrow(/not a conifer or a bush/);
    expect(() => growLeafy(spec('bush', 1))).toThrow(/not a leafy tree/);
  });

  it('give a dead conifer no sway at all, and a dead bush its factor (the brush mark, #331; the wind is zeroed in the shader)', () => {
    const c = growPlant({ ...spec('conifer', 3), dead: true });
    expect(c.amp).toBe(0);
    for (const b of c.lobes) expect(b.k).toBe(0);
    for (const k of c.skirts) expect(k.k).toBe(0);
    expect(growPlant({ ...spec('bush', 3), dead: true }).amp).toBe(growPlant(spec('bush', 3)).amp);
  });
});

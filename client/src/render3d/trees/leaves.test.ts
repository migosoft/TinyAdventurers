import { describe, expect, it } from 'vitest';
import { buildTree } from './build';
import { GROUND, LEAF_FADE, LEAF_FALL, LEAF_LIE, leafAt, leafPeriod, newLeafBuf, pushLeaves } from './leaves';
import type { TreeForm, TreeSpec } from './spec';

const spec = (form: TreeForm, extra: Partial<TreeSpec> = {}): TreeSpec => ({ form, x: 5, z: 6, seed: 3, scalePct: 100, mirrored: false, leaf: 1, dead: false, ...extra });
const START = [2, 3, 4];
/** Params of a leaf with period 100 and phase 0: its age is the time. */
const PARAMS = [100, 0, 0.5, 0.37];
const TOTAL = LEAF_FALL + LEAF_LIE + LEAF_FADE;

describe('leafAt', () => {
  it('starts at its lobe and lands at y = 0.01 after LEAF_FALL', () => {
    const a = leafAt(START, PARAMS, 0, true);
    expect([a.x, a.y, a.z]).toEqual(START);
    expect(a.alpha).toBe(1);
    expect(leafAt(START, PARAMS, LEAF_FALL, true).y).toBe(GROUND);
    expect(GROUND).toBe(0.01);
    const mid = leafAt(START, PARAMS, LEAF_FALL / 2, true).y;
    expect(mid).toBeLessThan(START[1]);
    expect(mid).toBeGreaterThan(GROUND);
  });

  it('lies on the ground with alpha 1, then fades, and is gone after LEAF_FALL + LEAF_LIE + LEAF_FADE', () => {
    for (const t of [LEAF_FALL, LEAF_FALL + LEAF_LIE / 2, LEAF_FALL + LEAF_LIE - 0.01]) {
      const a = leafAt(START, PARAMS, t, true);
      expect(a.alpha).toBe(1);
      expect(a.y).toBe(GROUND);
    }
    const fading = leafAt(START, PARAMS, LEAF_FALL + LEAF_LIE + LEAF_FADE / 2, true);
    expect(fading.alpha).toBeCloseTo(0.5, 6);
    expect(fading.y).toBe(GROUND);
    expect(leafAt(START, PARAMS, TOTAL, true).alpha).toBe(0);
    expect(leafAt(START, PARAMS, TOTAL + 50, true).alpha).toBe(0);
  });

  it('does not move while it lies, and drifts with the wind only when the wind is on', () => {
    const a = leafAt(START, PARAMS, LEAF_FALL, true), b = leafAt(START, PARAMS, LEAF_FALL + LEAF_LIE - 0.1, true);
    expect([b.x, b.z]).toEqual([a.x, a.z]);
    const off = leafAt(START, PARAMS, LEAF_FALL, false);
    expect(Math.hypot(a.x - START[0], a.z - START[2])).toBeGreaterThan(0.2);
    expect(Math.hypot(off.x - START[0], off.z - START[2])).toBeLessThan(1e-9);
  });

  it('is deterministic, and repeats each period (the phase shifts where in it the time falls)', () => {
    expect(leafAt(START, PARAMS, 3.3, true)).toEqual(leafAt(START, PARAMS, 3.3, true));
    expect(leafAt(START, PARAMS, 3.3 + 100, true)).toEqual(leafAt(START, PARAMS, 3.3, true));
    const shifted = [100, 0.25, 0.5, 0.37];
    expect(leafAt(START, shifted, 10, true)).toEqual(leafAt(START, PARAMS, 35, true));
  });

  it('a rate shortens the period but never below one whole life of a leaf', () => {
    expect(leafPeriod(200, 1)).toBe(200);
    expect(leafPeriod(200, 10)).toBe(20);
    expect(leafPeriod(200, 1000)).toBe(TOTAL);
    // At rate 1000 the leaf falls again TOTAL seconds later.
    expect(leafAt(START, PARAMS, 1, true, 1000)).toEqual(leafAt(START, PARAMS, 1 + TOTAL, true, 1000));
  });
});

describe('pushLeaves', () => {
  it('pushes one leaf per lobe, from a point under the lobe within 0.9 of its radius, with a period of 90..300 s', () => {
    for (const form of ['round', 'wide', 'tall', 'willow'] as TreeForm[]) {
      const t = buildTree(spec(form));
      const out = newLeafBuf();
      pushLeaves(out, t, 5, 6, 77);
      expect(t.lobes.length, form).toBeGreaterThan(2);
      expect(out.n, form).toBe(t.lobes.length);
      expect(out.start).toHaveLength(out.n * 3);
      expect(out.params).toHaveLength(out.n * 4);
      t.lobes.forEach((l, i) => {
        const [x, y, z] = out.start.slice(i * 3, i * 3 + 3);
        const dx = x - (5 + l.x), dy = y - l.y, dz = z - (6 + l.z);
        expect(Math.hypot(dx, dy, dz), form).toBeLessThanOrEqual(0.9 * l.r + 1e-9);
        expect(dy, form).toBeLessThanOrEqual(1e-9);
        const [period, phase, threshold] = out.params.slice(i * 4, i * 4 + 3);
        expect(period).toBeGreaterThanOrEqual(90);
        expect(period).toBeLessThanOrEqual(300);
        expect(phase).toBeGreaterThanOrEqual(0);
        expect(phase).toBeLessThan(1);
        expect(threshold).toBe(l.th);
        expect(out.sway[i]).toBe(l.k);
        expect([out.foot[i * 2], out.foot[i * 2 + 1]]).toEqual([5, 6]);
      });
    }
  });

  it('is deterministic for a seed, and differs between seeds', () => {
    const t = buildTree(spec('round'));
    const a = newLeafBuf(), b = newLeafBuf(), c = newLeafBuf();
    pushLeaves(a, t, 5, 6, 1); pushLeaves(b, t, 5, 6, 1); pushLeaves(c, t, 5, 6, 2);
    expect(b).toEqual(a);
    expect(c.params).not.toEqual(a.params);
  });

  it('a dead tree pushes none', () => {
    for (const form of ['round', 'wide', 'tall', 'willow', 'conifer', 'bush'] as TreeForm[]) {
      const out = newLeafBuf();
      pushLeaves(out, buildTree(spec(form, { dead: true })), 5, 6, 1);
      expect(out.n, form).toBe(0);
    }
  });

  it('conifers and bushes push none', () => {
    for (const form of ['conifer', 'bush'] as TreeForm[]) {
      const out = newLeafBuf();
      pushLeaves(out, buildTree(spec(form)), 5, 6, 1);
      expect(out.n, form).toBe(0);
    }
  });

  it('a mirrored tree starts its leaves at the mirrored lobes', () => {
    const b = buildTree(spec('round', { mirrored: true }));
    const ob = newLeafBuf();
    pushLeaves(ob, b, 0, 0, 9);
    expect(ob.n).toBe(b.lobes.length);
    b.lobes.forEach((l, i) => {
      expect(Math.hypot(ob.start[i * 3] - l.x, ob.start[i * 3 + 1] - l.y, ob.start[i * 3 + 2] - l.z)).toBeLessThanOrEqual(0.9 * l.r + 1e-9);
    });
  });
});

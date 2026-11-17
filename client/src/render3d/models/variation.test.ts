import { describe, expect, it } from 'vitest';
import { VARY, variationOf } from './variation';

const KEYS = ['size', 'tone', 'crest'] as const;

describe('variationOf (#357)', () => {
  it('stays inside VARY and gives the same numbers on every call, for any id', () => {
    const ids = [0, 1, -1, -7, 2 ** 31 - 1];
    for (let i = 0; i < 1000; i++) ids.push(Math.floor((Math.random() - 0.5) * 2 ** 32));
    for (const id of ids) {
      const v = variationOf(id);
      for (const k of KEYS) {
        expect(v[k], `${k} of ${id}`).toBeGreaterThanOrEqual(VARY[k][0]);
        expect(v[k], `${k} of ${id}`).toBeLessThanOrEqual(VARY[k][1]);
      }
      expect(variationOf(id)).toEqual(v);
    }
  });

  it('covers most of each range over ids 1 to 200, and the three numbers are not one number', () => {
    for (const k of KEYS) {
      let lo = Infinity, hi = -Infinity;
      for (let id = 1; id <= 200; id++) { const x = variationOf(id)[k]; lo = Math.min(lo, x); hi = Math.max(hi, x); }
      expect((hi - lo) / (VARY[k][1] - VARY[k][0]), k).toBeGreaterThan(0.8);
    }
    const unitOf = (id: number, k: (typeof KEYS)[number]): number => (variationOf(id)[k] - VARY[k][0]) / (VARY[k][1] - VARY[k][0]);
    for (let id = 1; id <= 200; id++) {
      const [a, b, c] = KEYS.map((k) => unitOf(id, k));
      expect(a === b && b === c, String(id)).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { lookKey, treeSpecOf } from './spec';
import type { PlantInfo } from '../../generated/PlantInfo';

describe('treeSpecOf', () => {
  it('reads the plant tuple', () => {
    expect(treeSpecOf([1, 40, 56, 9, 110, true, 60, false])).toEqual({ form: 'wide', x: 2.5, z: 3.5, seed: 9, scalePct: 110, mirrored: true, leaf: 0.6, dead: false });
  });
  it('maps every wire kind id to a form', () => {
    const forms = [0, 1, 2, 3, 4].map((k) => treeSpecOf([k, 0, 0, 0, 100, false, 100, false]).form);
    expect(forms).toEqual(['round', 'wide', 'tall', 'conifer', 'bush']);
  });
  it('shares a look key when only the foot or the leaf amount differ', () => {
    const a: PlantInfo = [0, 16, 16, 5, 100, false, 100, false], b: PlantInfo = [0, 80, 32, 5, 100, false, 20, false];
    expect(lookKey(treeSpecOf(a))).toBe(lookKey(treeSpecOf(b)));
    expect(lookKey(treeSpecOf(a))).toBe('round:5:100:false:false');
    expect(lookKey(treeSpecOf([0, 16, 16, 6, 100, false, 100, false]))).not.toBe(lookKey(treeSpecOf(a)));
  });
});

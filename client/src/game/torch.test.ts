import { describe, expect, it } from 'vitest';
import { flameTip } from './torch';

describe('flameTip', () => {
  it('sits above the foot, half a pixel towards the flame side', () => {
    expect(flameTip(56, 48.5, 0)).toEqual([56.5, 29]);
    expect(flameTip(16.5, 152, 1)).toEqual([18.5, 137]);
    expect(flameTip(191.5, 152, 2)).toEqual([190.5, 137]);
  });
});

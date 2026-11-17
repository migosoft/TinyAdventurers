import { describe, expect, it } from 'vitest';
import { EFFECT } from '../generated/defs';
import { has } from './effectBits';

describe('effectBits', () => {
  it('reads effect bits', () => {
    const bits = (1 << EFFECT.Sleep) | (1 << EFFECT.Slowed);
    expect(has(bits, EFFECT.Sleep)).toBe(true);
    expect(has(bits, EFFECT.Blind)).toBe(false);
  });
});

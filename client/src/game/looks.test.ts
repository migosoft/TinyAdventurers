import { describe, expect, it } from 'vitest';
import { EFFECT, EFFECT_LOOK } from '../generated/defs';
import { lookOf } from './looks';

describe('looks', () => {
  it('looks up the look of an effect on an entity, Plain when none is sent', () => {
    const looks: [number, number, number][] = [[3, EFFECT.Entangled, EFFECT_LOOK.Vines]];
    expect(lookOf(looks, 3, EFFECT.Entangled)).toBe(EFFECT_LOOK.Vines);
    expect(lookOf(looks, 3, EFFECT.Frozen)).toBe(EFFECT_LOOK.Plain);
    expect(lookOf(looks, 4, EFFECT.Entangled)).toBe(EFFECT_LOOK.Plain);
    expect(lookOf([], 3, EFFECT.Entangled)).toBe(EFFECT_LOOK.Plain);
  });
});

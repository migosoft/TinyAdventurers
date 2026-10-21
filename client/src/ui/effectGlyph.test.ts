import { describe, expect, it } from 'vitest';
import { EFFECT } from '../generated/defs';
import { EFFECT_GLYPH, effectGlyph } from './text';

describe('effectGlyph', () => {
  it('has its own glyph for every effect (no fallback)', () => {
    for (const [name, id] of Object.entries(EFFECT)) expect(EFFECT_GLYPH[id], name).toMatch(/^.$/);
  });
  it('uses distinct glyphs', () => {
    const g = Object.values(EFFECT).map(effectGlyph);
    expect(new Set(g).size).toBe(g.length);
  });
});

describe('effectGlyph names', () => {
  it('ties each effect to its letter', () => {
    expect(effectGlyph(EFFECT.Blind)).toBe('B');
    expect(effectGlyph(EFFECT.Sleep)).toBe('Z');
    expect(effectGlyph(EFFECT.Petrified)).toBe('P');
    expect(effectGlyph(EFFECT.Slowed)).toBe('S');
    expect(effectGlyph(EFFECT.Accelerated)).toBe('A');
    expect(effectGlyph(EFFECT.Burning)).toBe('F');
    expect(effectGlyph(EFFECT.Frozen)).toBe('I');
    expect(effectGlyph(EFFECT.Poisoned)).toBe('X');
    expect(effectGlyph(EFFECT.Chilled)).toBe('C');
    expect(effectGlyph(EFFECT.Singed)).toBe('G');
    expect(effectGlyph(EFFECT.Tainted)).toBe('T');
  });
});

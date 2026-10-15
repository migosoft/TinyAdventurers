import { describe, expect, it } from 'vitest';
import { EFFECT } from '../generated/defs';
import { effectGlyph } from './text';

describe('effectGlyph', () => {
  it('has a non-empty glyph for every effect', () => {
    for (const id of Object.values(EFFECT)) expect(effectGlyph(id).length).toBeGreaterThan(0);
  });
  it('uses distinct glyphs', () => {
    const g = Object.values(EFFECT).map(effectGlyph);
    expect(new Set(g).size).toBe(g.length);
  });
});

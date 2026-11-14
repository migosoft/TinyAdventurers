import { describe, expect, it } from 'vitest';
import { bushelToneTable } from './coverRead';
import { COVER_KINDS } from './kinds';

describe('bushel tone table', () => {
  it('holds three colours per kind, every channel in 0..1 (the palette is 0..255)', () => {
    const t = bushelToneTable();
    expect(t.length).toBe(COVER_KINDS.length * 3);
    for (const c of t) for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
  it('scales the grass tones from the palette', () => {
    const [r, g, b] = bushelToneTable()[0];
    const [pr, pg, pb] = COVER_KINDS[0].bushels!.tones[0];
    expect([r, g, b]).toEqual([pr / 255, pg / 255, pb / 255]);
  });
});

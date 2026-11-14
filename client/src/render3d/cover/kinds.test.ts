import { describe, expect, it } from 'vitest';
import { COVER, COVER_KINDS, GH_MAX, coverH, coverId, encodeCover } from './kinds';

describe('cover kinds', () => {
  it('lists each kind at its own id', () => {
    COVER_KINDS.forEach((m, i) => expect(m.id).toBe(i));
    for (const m of Object.values(COVER)) expect(COVER_KINDS[m.id]).toBe(m);
  });
  it('keeps every height within 1..15 and below GH_MAX', () => {
    for (const m of COVER_KINDS) { expect(m.maxH).toBeGreaterThanOrEqual(1); expect(m.maxH).toBeLessThanOrEqual(15); }
    expect(GH_MAX).toBe(3);
  });
  it('packs a height and a kind id into one byte', () => {
    expect(coverH(encodeCover(3, 1))).toBe(3);
    expect(coverId(encodeCover(3, 1))).toBe(1);
    expect(encodeCover(0, 1)).toBe(0);
  });
  it('keeps moss lower than grass, without sway or bushels', () => {
    expect(COVER.moss.maxH).toBeLessThan(COVER.grass.maxH);
    expect(COVER.moss.sway).toBe(0);
    expect(COVER.moss.bushels).toBeNull();
  });
});

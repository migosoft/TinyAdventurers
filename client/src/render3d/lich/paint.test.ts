import { describe, expect, it } from 'vitest';
import { LICH_PAINT, REGION, paintLich } from './paint';

const inside = (r: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

describe('the lich paint', () => {
  const img = paintLich();
  const px = (x: number, y: number): number[] => Array.from(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

  it('is 512 x 512 RGBA and the same on every call', () => {
    expect(img.w).toBe(512);
    expect(img.h).toBe(512);
    expect(img.data.length).toBe(512 * 512 * 4);
    expect(Buffer.from(paintLich().data).equals(Buffer.from(img.data))).toBe(true);
  });

  it('keeps white, plain alpha 100 in the white corner', () => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(px(x, y)).toEqual([255, 255, 255, LICH_PAINT.plain]);
  });

  it('has the alpha classes the material reads, each where the spike paints it', () => {
    const regions = Object.values(REGION);
    const seen = new Set<number>();
    let skull255 = 0, staff170 = 0;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const o = (y * img.w + x) * 4, a = img.data[o + 3];
      seen.add(a);
      const inRegion = regions.some((r) => inside(r, x, y));
      // the spike fills the whole image with white at alpha 100; only the six regions are painted
      if (!inRegion) expect([img.data[o], img.data[o + 1], img.data[o + 2], a]).toEqual([255, 255, 255, 100]);
      // alpha below 100 (cut away, with antialiased edges) is the robe's frayed hem, slits and holes only
      if (a < 100) expect(inside(REGION.robe, x, y)).toBe(true);
      if (inside(REGION.staff, x, y)) { expect(a).toBeLessThanOrEqual(170); if (a === 170) staff170++; }
      // rune glow (above the staff's 170) is in the skull, the robe (clasp) and the tome's pages
      if (a > 170) expect([REGION.skull, REGION.robe, REGION.pages].some((r) => inside(r, x, y))).toBe(true);
      if (a === 255 && inside(REGION.skull, x, y)) skull255++;
      if (inside(REGION.cover, x, y)) expect(a).toBe(100);
    }
    for (const a of [0, 100, 170, 255]) expect(seen.has(a)).toBe(true);
    expect(skull255).toBeGreaterThan(0);
    expect(staff170).toBeGreaterThan(0);
  });

  it('paints the robe in at least three colours', () => {
    const colours = new Set<string>();
    for (let y = 0; y < REGION.robe.h; y++) for (let x = 0; x < REGION.robe.w; x++) {
      const p = px(REGION.robe.x + x, REGION.robe.y + y);
      colours.add(`${p[0] >> 5},${p[1] >> 5},${p[2] >> 5}`);
    }
    expect(colours.size).toBeGreaterThanOrEqual(3);
  });
});

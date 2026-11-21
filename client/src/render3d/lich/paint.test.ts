import { describe, expect, it } from 'vitest';
import { LICH_PAINT, REGION, paintLich } from './paint';

const inside = (r: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

describe('the lich paint', () => {
  const img = paintLich();
  /** The pixel at x and v-row y (REGION's units, counted from the bottom); the image has row 0 on top. */
  const px = (x: number, y: number): number[] => { const o = ((img.h - 1 - y) * img.w + x) * 4; return Array.from(img.data.subarray(o, o + 4)); };

  it('is 512 x 512 RGBA and the same on every call', () => {
    expect(img.w).toBe(512);
    expect(img.h).toBe(512);
    expect(img.data.length).toBe(512 * 512 * 4);
    expect(Buffer.from(paintLich().data).equals(Buffer.from(img.data))).toBe(true);
  });

  it('keeps white, plain alpha 100 in the white corner', () => {
    const off: number[][] = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (px(x, y).join() !== '255,255,255,100') off.push([x, y]);
    expect(off).toEqual([]);
  });

  it('has row 0 on top: the uv rows of v = 0 (the white corner, the robe hem) lie at the image bottom', () => {
    for (let r = img.h - 16; r < img.h; r++) for (let x = 0; x < 16; x++) {
      const o = (r * img.w + x) * 4;
      expect(Array.from(img.data.subarray(o, o + 4))).toEqual([255, 255, 255, LICH_PAINT.plain]);
    }
    const cut = (row: number): number => { let n = 0; for (let x = REGION.robe.x; x < REGION.robe.x + REGION.robe.w; x++) if (img.data[(row * img.w + x) * 4 + 3] === 0) n++; return n; };
    expect(cut(img.h - 1)).toBeGreaterThan(0); // the hem is cut away at v = 0
    expect(cut(0)).toBe(0); // and the neck is whole at the top of the robe's strip (v near 1 is outside the strip: plain)
  });

  it('has the alpha classes the material reads, each where the spike paints it', () => {
    const regions = Object.values(REGION), glowing = [REGION.skull, REGION.robe, REGION.pages];
    const seen = new Set<number>();
    const notPlainOutside: number[][] = [], cutOutsideRobe: number[][] = [], staffAbove: number[][] = [], glowElsewhere: number[][] = [], coverOff: number[][] = [];
    let skull255 = 0, staff170 = 0;
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const p = px(x, y), a = p[3];
      seen.add(a);
      // the spike fills the whole image with white at alpha 100; only the six regions are painted
      if (!regions.some((r) => inside(r, x, y)) && p.join() !== '255,255,255,100') notPlainOutside.push([x, y, ...p]);
      // alpha below 100 (cut away, with antialiased edges) is the robe's frayed hem, slits and holes only
      if (a < 100 && !inside(REGION.robe, x, y)) cutOutsideRobe.push([x, y, a]);
      if (inside(REGION.staff, x, y)) { if (a > 170) staffAbove.push([x, y, a]); if (a === 170) staff170++; }
      // rune glow (above the staff's 170) is in the skull, the robe (clasp) and the tome's pages
      if (a > 170 && !glowing.some((r) => inside(r, x, y))) glowElsewhere.push([x, y, a]);
      if (a === 255 && inside(REGION.skull, x, y)) skull255++;
      if (inside(REGION.cover, x, y) && a !== 100) coverOff.push([x, y, a]);
    }
    expect(notPlainOutside).toEqual([]);
    expect(cutOutsideRobe).toEqual([]);
    expect(staffAbove).toEqual([]);
    expect(glowElsewhere).toEqual([]);
    expect(coverOff).toEqual([]);
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

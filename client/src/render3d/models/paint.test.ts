import { describe, expect, it } from 'vitest';
import { FH, FW } from './grid';
import { paintOf, skyPaint, stonePaint } from './paint';
import { DESCS } from './table';
import type { FigureDesc } from './desc';

function baseOf(d: FigureDesc): { grid: Int32Array; alpha: Uint8Array } {
  const grid = new Int32Array(FW * FH).fill(-1), alpha = new Uint8Array(FW * FH);
  d.side.forEach((line, k) => {
    for (let x = 0; x < FW; x++) if (line[x] !== '.') { grid[(d.firstRow + k) * FW + x] = d.colours[line[x]]; alpha[(d.firstRow + k) * FW + x] = 1; }
  });
  return { grid, alpha };
}
const rgb = (p: { w: number; data: Uint8Array }, x: number, y: number): number => {
  const i = (y * p.w + x) * 4;
  return (p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2];
};

describe('paint', () => {
  it('sets the elf\'s eyes near the front with skin beside them', () => {
    const d = DESCS.elf, { grid, alpha } = baseOf(d), p = paintOf(d, grid, alpha, 1);
    const y = Math.round(15.5 * 6);
    const eye = [];
    for (let x = 0; x < p.w; x++) if (rgb(p, x, y) === 0x5698cc) eye.push(x);
    expect(eye.length).toBeGreaterThan(2);
    expect(eye[0]).toBeGreaterThan(p.w * 0.7);
    expect(rgb(p, eye[0] - 3, y)).toBe(0xfccba3);
  });

  it('paints the knight\'s visor with three slits of equal width', () => {
    const d = DESCS.knight, { grid, alpha } = baseOf(d), p = paintOf(d, grid, alpha, 1);
    const y = Math.round(16.5 * 6), runs: number[] = [];
    let len = 0;
    for (let x = p.w / 2; x <= p.w; x++) {
      if (x < p.w && rgb(p, x, y) === d.visor!.slit) len++;
      else if (len) { runs.push(len); len = 0; }
    }
    // The middle slit is half here and half in the mirror, so three slits are two runs, the first twice the second.
    expect(runs.length).toBe(2);
    expect(runs[0]).toBe(runs[1] * 2);
    expect(runs[1]).toBeGreaterThanOrEqual(2);
  });

  it('raises only the materials the description lists', () => {
    const d = DESCS.elf, { grid, alpha } = baseOf(d), p = paintOf(d, grid, alpha, 1);
    expect(p.raise(0.5, 1 - 24 / FH)).toBe(0);
    let max = 0;
    for (let v = 0; v < 1; v += 0.02) for (let u = 0; u < 1; u += 0.02) max = Math.max(max, p.raise(u, v));
    expect(max).toBeGreaterThan(0.1);
  });
});

describe('stonePaint', () => {
  const s = stonePaint();
  const at = (x: number, y: number): number[] => Array.from(s.data.subarray((y * s.w + x) * 4, (y * s.w + x) * 4 + 4));

  it('is a figure paint in size, opaque, and the same every time', () => {
    expect([s.w, s.h]).toEqual([FW * 6, FH * 6]);
    expect(s.data.length).toBe(s.w * s.h * 4);
    for (let i = 3; i < s.data.length; i += 4) expect(s.data[i]).toBe(255);
    expect(stonePaint().data).toEqual(s.data);
  });

  it('reads the base grey in the two corner patches that pieces without paint read', () => {
    for (const [x, y] of [[0, 0], [3, 3], [0, s.h - 1], [3, s.h - 4]]) expect(at(x, y)).toEqual([0x8f, 0x92, 0x8c, 255]);
  });

  it('has dark cracks and lighter and darker flecks on the grey', () => {
    let dark = 0, light = 0, flecks = 0;
    for (let i = 0; i < s.w * s.h; i++) {
      const r = s.data[i * 4];
      if (r < 0x60) dark++; else if (r > 0x96) light++; else if (r < 0x8c) flecks++;
    }
    expect(dark).toBeGreaterThan(s.w * s.h * 0.02);   // nine cracks, 3 px wide
    expect(dark).toBeLessThan(s.w * s.h * 0.2);
    expect(light).toBeGreaterThan(50);
    expect(flecks).toBeGreaterThan(50);
  });
});

describe('skyPaint', () => {
  const s = skyPaint();
  const at = (x: number, y: number): number[] => Array.from(s.data.subarray((y * s.w + x) * 4, (y * s.w + x) * 4 + 3));

  it('is a 128 x 64 gradient from white at the top to the dark green-grey of the ground', () => {
    expect([s.w, s.h]).toEqual([128, 64]);
    expect(at(100, 0).every((v) => v >= 250)).toBe(true);
    const bottom = at(100, 63);
    expect(Math.abs(bottom[0] - 0x5d)).toBeLessThanOrEqual(3);
    expect(Math.abs(bottom[1] - 0x6b)).toBeLessThanOrEqual(3);
    expect(Math.abs(bottom[2] - 0x58)).toBeLessThanOrEqual(3);
    // Half way the stop at 0.5 (the pale blue-grey of the horizon) is passed: row 32 reads at 0.5078, 0.0977 of the way to the stop at 0.58.
    const mid = at(100, 32), f = (0.5 + 0.5 / 64 - 0.5) / 0.08;
    expect(Math.abs(mid[0] - (0xb4 + (0x7d - 0xb4) * f))).toBeLessThanOrEqual(1);
    expect(Math.abs(mid[2] - (0xd4 + (0x78 - 0xd4) * f))).toBeLessThanOrEqual(1);
    expect(at(100, 31)[2]).toBeGreaterThan(mid[2]);
  });

  it('has a white ellipse (the sun) at (40, 12) with a soft edge about a texel wide', () => {
    expect(at(40, 12)).toEqual([255, 255, 255]);
    // Outside the ellipse the gradient shows: at (40, 12 + 9) a row below it, y = 21 is 0.33 of the way, not white.
    expect(at(40, 21)[0]).toBeLessThan(250);
    // On the edge (x = 40 + 14) the colour is between the gradient and white.
    const gradientOnly = at(80, 12)[0], edge = at(54, 12)[0];
    expect(edge).toBeGreaterThanOrEqual(gradientOnly);
  });
});

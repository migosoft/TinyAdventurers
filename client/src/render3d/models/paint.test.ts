import { describe, expect, it } from 'vitest';
import { FH, FW } from './grid';
import { paintOf } from './paint';
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

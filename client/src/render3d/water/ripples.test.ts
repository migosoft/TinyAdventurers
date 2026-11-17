import { describe, expect, it } from 'vitest';
import { RIPPLE_CAP, RIPPLE_LIFE, Ripples, rippleHeight } from './ripples';

function peak(age: number, strength = 1): { max: number; at: number } {
  let max = 0, at = 0;
  for (let d = 0; d <= 4; d += 0.005) {
    const h = Math.abs(rippleHeight(d, age, strength));
    if (h > max) { max = h; at = d; }
  }
  return { max, at };
}

describe('ripples', () => {
  it('is flat before it is born and after its life', () => {
    expect(rippleHeight(1, 0, 1)).toBe(0);
    expect(rippleHeight(1, RIPPLE_LIFE, 1)).toBe(0);
  });

  it('travels at RIPPLE_SPEED', () => {
    expect(Math.abs(peak(2).at - 1.5)).toBeLessThan(0.15);
  });

  it('fades', () => {
    expect(peak(3).max).toBeLessThan(peak(0.5).max / 10);
  });

  it('packs live sources with their age', () => {
    const r = new Ripples();
    r.add(3, 4, 1, 0.7);
    const out = new Float32Array(RIPPLE_CAP * 4).fill(9);
    expect(r.pack(1.5, out)).toBe(1);
    expect(Array.from(out.slice(0, 4))).toEqual([3, 4, 0.5, Math.fround(0.7)]);
    for (let i = 1; i < RIPPLE_CAP; i++) expect(out[i * 4 + 2]).toBe(-1);
  });

  it('drops the expired', () => {
    const r = new Ripples();
    r.add(3, 4, 1, 1);
    const out = new Float32Array(RIPPLE_CAP * 4);
    expect(r.pack(1 + RIPPLE_LIFE, out)).toBe(0);
    for (let i = 0; i < RIPPLE_CAP; i++) expect(out[i * 4 + 2]).toBe(-1);
  });

  it('replaces the oldest when full', () => {
    const r = new Ripples();
    // 40 adds 0.01 s apart: all stay live at the pack time.
    for (let i = 0; i < 40; i++) r.add(i, 0, i * 0.01, 1);
    const out = new Float32Array(RIPPLE_CAP * 4);
    expect(r.pack(0.5, out)).toBe(RIPPLE_CAP);
    const xs: number[] = [];
    for (let i = 0; i < RIPPLE_CAP; i++) xs.push(out[i * 4]);
    xs.sort((a, b) => a - b);
    expect(xs).toEqual(Array.from({ length: RIPPLE_CAP }, (_, i) => 24 + i));
  });

  it('reuses an expired slot before replacing a live one', () => {
    const r = new Ripples();
    r.add(0, 0, 0, 1);
    for (let i = 1; i < RIPPLE_CAP; i++) r.add(i, 0, 10 + i * 0.01, 1);
    r.add(99, 0, 10.5, 1); // the first source (born 0) is long expired
    const out = new Float32Array(RIPPLE_CAP * 4);
    expect(r.pack(10.6, out)).toBe(RIPPLE_CAP);
    const xs = Array.from({ length: RIPPLE_CAP }, (_, i) => out[i * 4]);
    expect(xs).toContain(99);
    expect(xs).toContain(1);
  });
});

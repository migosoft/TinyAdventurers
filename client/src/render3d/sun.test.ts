import { describe, expect, it } from 'vitest';
import { HOUR_RATE, HourClock, cardSunGain, hourLabel, mistLightOf, sky, startHour } from './sun';

const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

describe('sky', () => {
  it('follows the elevation curve', () => {
    expect(sky(13).elevation).toBeCloseTo(62, 6);
    expect(sky(6).elevation).toBeCloseTo(0, 6);
    expect(Math.abs(sky(9.5).elevation - 43.84)).toBeLessThan(0.01);
    expect(Math.abs(sky(18.5).elevation - 20.477)).toBeLessThan(0.01);
  });
  it('switches to the moon at -1.5 degrees', () => {
    const m = sky(0);
    expect(m.moon).toBe(true);
    const n = Math.hypot(0.35, 0.85, 0.45);
    expect(m.dir[0]).toBeCloseTo(0.35 / n, 9);
    expect(m.dir[1]).toBeCloseTo(0.85 / n, 9);
    expect(m.dir[2]).toBeCloseTo(-0.45 / n, 9);
    expect(sky(5.5).moon).toBe(false);
    expect(sky(5.4).moon).toBe(true);
  });
  it('puts the morning sun in the west and unit directions', () => {
    expect(sky(9.5).dir[0]).toBeLessThan(0);
    expect(sky(16).dir[0]).toBeGreaterThan(0);
    for (let h = 0; h <= 24; h += 0.25) expect(Math.abs(len(sky(h).dir) - 1)).toBeLessThan(1e-9);
  });
  it('has night and ambient values', () => {
    expect(sky(13).night).toBe(0);
    expect(sky(0).night).toBe(1);
    const a = sky(0).ambient;
    expect(a[0]).toBeCloseTo(0.035, 9);
    expect(a[1]).toBeCloseTo(0.045, 9);
    expect(a[2]).toBeCloseTo(0.09, 9);
  });
  it('wraps any hour', () => {
    expect(sky(37).elevation).toBeCloseTo(sky(13).elevation, 9);
  });
});

describe('mistLightOf', () => {
  it('is full at noon, dim at night, and within 0..1', () => {
    expect(mistLightOf(sky(13))).toEqual([1, 1, 1]);
    expect(mistLightOf(sky(0))[0]).toBeLessThan(0.3);
    for (let h = 0; h <= 24; h += 0.25) for (const v of mistLightOf(sky(h))) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe('startHour', () => {
  it('reaches the sun elevation on the right side', () => {
    for (const side of [-1, 1]) for (const el of [35, 50, 62, 70]) {
      const h = startHour({ side, elevation: el });
      expect(Math.abs(sky(h).elevation - Math.min(el, 62))).toBeLessThan(1e-6);
      if (el >= 62) expect(h).toBeCloseTo(13, 9);
      else if (side === -1) expect(h).toBeLessThan(13);
      else expect(h).toBeGreaterThan(13);
    }
  });
});

describe('HourClock', () => {
  it('runs from its anchor', () => {
    expect(HOUR_RATE).toBeCloseTo(1 / 720, 12);
    const c = new HourClock(9);
    expect(c.hourAt(null, 1)).toBe(9);
    expect(c.hourAt(720, 1)).toBeCloseTo(10, 9);
    expect(c.hourAt(720, 0)).toBe(9);
    expect(c.hourAt(720 * 16, 1)).toBeCloseTo(1, 9);
    c.anchor(20, 100);
    expect(c.hourAt(100, 1)).toBe(20);
    expect(c.hourAt(100 + 720, 1)).toBeCloseTo(21, 9);
  });
});

describe('helpers', () => {
  it('card sun gain and labels', () => {
    expect(cardSunGain([0, 1, 0])).toBeCloseTo(0.86, 9);
    expect(hourLabel(9.5)).toBe('09:30');
    expect(hourLabel(24.25)).toBe('00:15');
  });
});

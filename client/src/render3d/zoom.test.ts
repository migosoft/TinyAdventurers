import { describe, expect, it } from 'vitest';
import { pickZoom } from './quality';
import { WheelZoom, labelZoom, wheelFactor, zoomLimits } from './zoom';

function settle(z: WheelZoom, w: number, h: number, frames = 600): number {
  let v = 0;
  for (let i = 0; i < frames; i++) v = z.frame(1 / 60, w, h);
  return v;
}

describe('zoomLimits', () => {
  it('spans the far and near views', () => {
    const l = zoomLimits(1280, 768, 5);
    expect(l.min).toBeCloseTo(1280 / 448, 3);
    expect(l.max).toBeCloseTo(768 / 60.8, 3);
  });
  it('widens to contain the start zoom', () => {
    const a = zoomLimits(300, 200, 2);
    expect(a.min).toBeLessThanOrEqual(2);
    expect(a.max).toBeGreaterThanOrEqual(2);
    const b = zoomLimits(8000, 8000, 8);
    expect(b.min).toBeLessThanOrEqual(8);
    expect(b.max).toBeGreaterThanOrEqual(8);
  });
});

describe('wheelFactor', () => {
  it('is one notch per 100 px, 3 lines or 1 page', () => {
    expect(wheelFactor(-100, 0)).toBeCloseTo(1.12, 6);
    expect(wheelFactor(100, 0)).toBeCloseTo(1 / 1.12, 6);
    expect(wheelFactor(-3, 1)).toBeCloseTo(1.12, 6);
    expect(wheelFactor(-1, 2)).toBeCloseTo(1.12, 6);
    expect(wheelFactor(-10, 0)).toBeCloseTo(1.12 ** 0.1, 6);
    expect(wheelFactor(0, 0)).toBe(1);
  });
});

describe('labelZoom', () => {
  it('follows the square root of the zoom ratio, capped', () => {
    expect(labelZoom(5, 5)).toBe(5);
    expect(labelZoom(20, 5)).toBeCloseTo(6.5, 6);
    expect(labelZoom(3, 5)).toBeCloseTo(5 * Math.sqrt(0.6), 6);
    expect(labelZoom(2.5, 5)).toBeCloseTo(3.75, 6);
    expect(labelZoom(1, 5)).toBeCloseTo(3.75, 6);
  });
});

describe('WheelZoom', () => {
  it('stays at the start zoom without wheel input', () => {
    const z = new WheelZoom();
    for (let i = 0; i < 10; i++) expect(z.frame(1 / 60, 1280, 768)).toBeCloseTo(5, 6);
  });
  it('glides to one notch', () => {
    const z = new WheelZoom();
    z.wheel(-100, 0);
    const first = z.frame(1 / 60, 1280, 768);
    expect(first).toBeGreaterThan(5);
    expect(first).toBeLessThan(5.6);
    let v = first;
    for (let i = 0; i < 30; i++) v = z.frame(1 / 60, 1280, 768);
    expect(v).toBeCloseTo(5 * 1.12, 3);
  });
  it('stops at the limits', () => {
    const l = zoomLimits(1280, 768, 5);
    const a = new WheelZoom();
    for (let i = 0; i < 40; i++) a.wheel(-100, 0);
    expect(settle(a, 1280, 768)).toBeCloseTo(l.max, 3);
    const b = new WheelZoom();
    for (let i = 0; i < 40; i++) b.wheel(100, 0);
    expect(settle(b, 1280, 768)).toBeCloseTo(l.min, 3);
  });
  it('adds small deltas up', () => {
    const a = new WheelZoom();
    for (let i = 0; i < 10; i++) a.wheel(-10, 0);
    const b = new WheelZoom();
    b.wheel(-100, 0);
    expect(settle(a, 1280, 768)).toBeCloseTo(settle(b, 1280, 768), 4);
  });
  it('n notches in and n out return exactly to the start zoom', () => {
    const z = new WheelZoom();
    for (let i = 0; i < 7; i++) z.wheel(-100, 0);
    for (let i = 0; i < 7; i++) z.wheel(100, 0);
    expect(settle(z, 1280, 768)).toBe(pickZoom(1280, 768));
  });
  it('keeps the ratio on resize', () => {
    const z = new WheelZoom();
    z.wheel(-100, 0);
    z.wheel(-100, 0);
    settle(z, 1280, 768);
    expect(settle(z, 1920, 1080)).toBeCloseTo(7 * 1.12 ** 2, 3);
  });
  it('re-clamps the ratio on resize', () => {
    const z = new WheelZoom();
    for (let i = 0; i < 40; i++) z.wheel(100, 0);
    settle(z, 1280, 768);
    expect(settle(z, 1920, 1080)).toBeCloseTo(zoomLimits(1920, 1080, 7).min, 3);
  });
});

import { describe, expect, it } from 'vitest';
import { columnPath, niceMax, ticks } from './charts';
import { compact, duration, percent, since } from './dom';

describe('chart scales', () => {
  it('rounds the axis maximum up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(200)).toBe(200);
    expect(niceMax(201)).toBe(500);
    expect(niceMax(0.3)).toBe(0.5);
  });

  it('ticks are whole numbers from 0 to the maximum', () => {
    expect(ticks(1)).toEqual([0, 1]);
    expect(ticks(2)).toEqual([0, 1, 2]);
    expect(ticks(5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ticks(10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(ticks(200)).toEqual([0, 50, 100, 150, 200]);
  });

  it('a column has a rounded top and a square base', () => {
    const d = columnPath(10, 20, 24, 100, 4);
    expect(d.startsWith('M10,120V24Q10,20 14,20')).toBe(true);
    expect(d.endsWith('V120Z')).toBe(true);
    // A tiny column never gets a radius larger than itself.
    expect(columnPath(0, 0, 24, 1, 4)).toContain('Q0,0 1,0');
  });
});

describe('formatting', () => {
  it('compacts large numbers only', () => {
    expect(compact(1284)).toBe('1,284');
    expect(compact(12900)).toBe('12.9K');
    expect(compact(4_200_000)).toBe('4.2M');
  });

  it('formats durations and shares', () => {
    expect(duration(754)).toBe('12:34');
    expect(duration(3725)).toBe('1:02:05');
    expect(percent(1, 3)).toBe('33%');
    expect(percent(0, 0)).toBe('–');
    expect(since(0, 125 * 60_000)).toBe('2 h 5 min');
  });
});

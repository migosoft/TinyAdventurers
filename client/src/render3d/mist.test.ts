import { describe, expect, it } from 'vitest';
import { DEFAULT_HAZE } from '../game/sightField';
import { MIST, NIGHT_MIST, cardShown, mistAmount, mistColour, mistHeight, unseenDay } from './mist';

describe('mistHeight', () => {
  it('is 1 up to low and top from high up', () => {
    expect(mistHeight(0, MIST)).toBe(1);
    expect(mistHeight(0.5, MIST)).toBe(1);
    expect(mistHeight(3, MIST)).toBeCloseTo(MIST.top, 12);
    expect(mistHeight(10, MIST)).toBeCloseTo(MIST.top, 12);
  });
  it('is strictly between in the ramp and never below top', () => {
    const h = mistHeight(1.5, MIST);
    expect(h).toBeLessThan(1);
    expect(h).toBeGreaterThan(MIST.top);
    for (let y = -1; y < 12; y += 0.25) expect(mistHeight(y, MIST)).toBeGreaterThanOrEqual(MIST.top - 1e-12);
  });
});

describe('mistAmount', () => {
  it('never exceeds u and is 0 where u is 0', () => {
    for (const u of [0, 0.1, 0.5, 0.8, 1]) {
      for (const y of [0, 0.5, 1, 2, 3, 6]) {
        for (const n of [0, 0.25, 0.5, 1]) {
          const a = mistAmount(u, y, n, MIST);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThanOrEqual(u + 1e-12);
        }
        for (const n of [0, 0.5, 1]) expect(mistAmount(0, y, n, MIST)).toBe(0);
      }
    }
  });
  it('the drift only thins', () => {
    for (const y of [0, 1.5, 4]) {
      expect(mistAmount(0.8, y, 1, MIST)).toBeCloseTo(0.8 * mistHeight(y, MIST) * 0.75, 12);
      expect(mistAmount(0.8, y, 0, MIST)).toBeCloseTo(0.8 * mistHeight(y, MIST), 12);
    }
  });
});

describe('unseenDay', () => {
  it('is the larger of the outside and the soft strength', () => {
    expect(unseenDay(1, 0, DEFAULT_HAZE)).toBeCloseTo(0.8, 12);
    expect(unseenDay(0, 1, DEFAULT_HAZE)).toBeCloseTo(0.7, 12);
    expect(unseenDay(1, 1, DEFAULT_HAZE)).toBeCloseTo(0.8, 12);
    expect(unseenDay(0, 0, DEFAULT_HAZE)).toBe(0);
  });
});

describe('mistColour', () => {
  it('blends the day colour toward the night colour', () => {
    const day = mistColour(1);
    expect(day[0]).toBeCloseTo(0xb8 / 255, 12);
    expect(day[1]).toBeCloseTo(0xc4 / 255, 12);
    expect(day[2]).toBeCloseTo(0xcc / 255, 12);
    const night = mistColour(0);
    for (let i = 0; i < 3; i++) expect(night[i]).toBeCloseTo(NIGHT_MIST[i], 12);
    const half = mistColour(0.5);
    for (let i = 0; i < 3; i++) expect(half[i]).toBeCloseTo((day[i] + NIGHT_MIST[i]) / 2, 12);
  });
});

describe('cardShown', () => {
  it('hides cards beyond sight, but not scenery on a daylight map', () => {
    expect(cardShown(1, false, false)).toBe(0);
    expect(cardShown(1, true, false)).toBe(0);
    expect(cardShown(1, true, true)).toBe(1);
    expect(cardShown(0.25, false, true)).toBeCloseTo(0.75, 12);
  });
});

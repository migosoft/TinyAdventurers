import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE } from '../sim/map';
import { MOOD_FIGURES, MOOD_TORCHES, moodMap, moodScript } from './moodDemoScript';
import { SECOND, SUN, SUNLIGHT_KNIGHTS, SUNLIGHT_TORCHES, sunlightMap } from './sunlightDemoScript';

describe('moodScript', () => {
  it('the arrow shows only inside its crossing window', () => {
    // ap = (t - 1.5) mod 3, ax = 1.5 tiles + ap * 260 px, shown while ax < 13.5 tiles
    expect(moodScript(1.5).arrow).toEqual({ x: 1.5 * TILE, y: 8.5 * TILE });
    expect(moodScript(1.5 + 2).arrow).toBeNull(); // ap = 2: 24 + 520 > 216
    expect(moodScript(1.5 + 0.5).arrow!.x).toBeCloseTo(1.5 * TILE + 130);
    expect(moodScript(1.4).arrow).toBeNull();
  });
  it('the fireball crosses for 2 s of every 4; the blast follows at the east wall for 0.4 s', () => {
    expect(moodScript(1).fireball).toEqual({ x: 7.5 * TILE, y: 5.5 * TILE });
    expect(moodScript(1).blast).toBeNull();
    expect(moodScript(2.1).fireball).toBeNull();
    expect(moodScript(2.1).blast).toEqual({ x: 12.5 * TILE, y: 5.5 * TILE });
    expect(moodScript(2.5).blast).toBeNull();
    expect(moodScript(3).blast).toBeNull();
  });
  it('the walker dashes for 0.25 s every 6 s and its path is continuous', () => {
    expect(moodScript(0.1).walker.dashing).toBe(true);
    expect(moodScript(1).walker.dashing).toBe(false);
    expect(moodScript(6.1).walker.dashing).toBe(true);
    let prev = moodScript(0).walker;
    for (let t = 0.01; t < 30; t += 0.01) {
      const w = moodScript(t).walker;
      expect(Math.hypot(w.x - prev.x, w.y - prev.y)).toBeLessThan(4);
      prev = w;
    }
  });
  it('the maps hold floor and the scripts list torches and figures', () => {
    expect(moodMap().get(5, 5)).toBe(TILE_ID.Floor);
    expect(sunlightMap().get(SUN.x, SUN.y)).toBe(TILE_ID.Floor);
    expect(sunlightMap().get(SECOND.x, SECOND.y)).toBe(TILE_ID.Floor);
    expect(MOOD_TORCHES).toHaveLength(4);
    expect(MOOD_FIGURES.length).toBeGreaterThan(0);
    expect(SUNLIGHT_KNIGHTS).toHaveLength(2);
    expect(SUNLIGHT_TORCHES.map((t) => t.lit)).toEqual([false, true]);
  });
});

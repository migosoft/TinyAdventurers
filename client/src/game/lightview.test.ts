import { describe, expect, it, vi } from 'vitest';
import { LIGHT_KIND } from '../generated/defs';
import { catmullRom, darknessAlpha, darkReach, DV_DARK, dvMask, flicker, nextDarkvision, seenForDark, seenForLight, tileDark, warmTint, WARM } from './lightview';

vi.mock('phaser', () => ({ default: {} }));

describe('darkness', () => {
  it('is black where not seen or not lit', () => {
    expect(darknessAlpha(false, true, 255, 255, 255)).toBe(1);
    expect(darknessAlpha(true, false, 0, 0, 0)).toBe(1);
  });
  it('never draws a lit tile fully black', () => {
    expect(darknessAlpha(true, true, 10, 5, 0)).toBeCloseTo(0.92); // the floor: 0.08 bright
    expect(darknessAlpha(true, true, 0, 0, 0)).toBeLessThan(1);
    expect(darknessAlpha(true, true, 51, 0, 0)).toBeCloseTo(0.8); // a dim rim stays dim
    expect(darknessAlpha(true, true, 255, 120, 60)).toBe(0);
    expect(darknessAlpha(true, true, 600, 0, 0)).toBe(0); // over-bright sums are capped
  });
  it('flickers around 1 by the kind', () => {
    for (let t = 0; t < 5; t += 0.37) {
      const f = flicker(LIGHT_KIND.Torch, 7, t);
      expect(f).toBeGreaterThan(0.84);
      expect(f).toBeLessThan(1.16);
    }
  });
});

describe('the upsampling weights (the shader in lightshader.ts uses the same ones)', () => {
  it('weights the four taps to 1 and passes through the tile centres', () => {
    for (const t of [0, 0.125, 0.5, 0.875]) expect(catmullRom(t).reduce((a, b) => a + b)).toBeCloseTo(1);
    expect(catmullRom(0)).toEqual([0, 1, 0, 0]);
  });
});

describe('darkvision', () => {
  it('reaches tiles within the range, never at range 0', () => {
    expect(darkReach(0, 0, 0)).toBe(false);
    expect(darkReach(0, 0, 4.5)).toBe(true);
    expect(darkReach(4, 2, 4.5)).toBe(true); // 16 + 4 = 20 <= 20.25
    expect(darkReach(5, 0, 4.5)).toBe(false);
    expect(darkReach(3, 4, 5)).toBe(true); // exactly on the circle
    expect(darkReach(3, 4, 4.99)).toBe(false);
  });
  it('dims a seen unlit tile in reach, else leaves darknessAlpha', () => {
    expect(tileDark(true, false, true, 0, 0, 0)).toBe(DV_DARK);
    expect(tileDark(true, false, false, 0, 0, 0)).toBe(1);
    expect(tileDark(false, false, true, 0, 0, 0)).toBe(1);
    expect(tileDark(true, true, true, 10, 5, 0)).toBe(DV_DARK);
  });
  it('never makes a light rim in reach darker than darkvision, but keeps brighter light', () => {
    expect(tileDark(true, true, true, 25, 0, 0)).toBe(DV_DARK);
    expect(tileDark(true, true, true, 200, 0, 0)).toBeCloseTo(darknessAlpha(true, true, 200, 0, 0));
    expect(tileDark(true, true, false, 25, 0, 0)).toBe(darknessAlpha(true, true, 25, 0, 0));
  });
  it('greys fully where only darkvision shows the tile, fading out as light takes over', () => {
    expect(dvMask(false, 1)).toBe(0);
    expect(dvMask(true, 1)).toBe(1);
    expect(dvMask(true, DV_DARK)).toBe(0);
    expect(dvMask(true, 0.2)).toBe(0);
    const rim = dvMask(true, 0.9);
    expect(rim).toBeGreaterThan(0.5);
    expect(rim).toBeLessThan(1);
  });
  it('debug cycle: 0 -> 0.5 -> 1 -> 0, from any value', () => {
    expect(nextDarkvision(0)).toBe(0.5);
    expect(nextDarkvision(0.5)).toBe(1);
    expect(nextDarkvision(1)).toBe(0);
    expect(nextDarkvision(0.3)).toBe(0.5);
    expect(nextDarkvision(0.6)).toBe(1);
    expect(nextDarkvision(50 / 100)).toBe(1); // the snapshot's percent
  });
});

describe('seenForLight', () => {
  // Row 0: floor; the view = only tile (1, 0). Tile (3, 0) is a wall.
  const inView = (x: number, y: number) => x === 1 && y === 0;
  const opaque = (x: number, _y: number) => x === 3;
  it('keeps the view', () => {
    expect(seenForLight(inView, opaque, 1, 0)).toBe(true);
  });
  it('lights open tiles next to an open tile in view, so a grazed tile does not darken the edge', () => {
    expect(seenForLight(inView, opaque, 2, 0)).toBe(true);
    expect(seenForLight(inView, opaque, 0, 1)).toBe(true); // diagonal
  });
  it('never adds walls or tiles two steps away', () => {
    expect(seenForLight(inView, opaque, 3, 0)).toBe(false);
    expect(seenForLight(inView, opaque, 4, 0)).toBe(false);
  });
  it('does not grow from a wall in view', () => {
    const wallView = (x: number, y: number) => x === 3 && y === 0;
    expect(seenForLight(wallView, opaque, 4, 0)).toBe(false);
  });
});

describe('seenForDark (#258)', () => {
  it('a dark map blacks out what lies beyond sight', () => {
    expect(seenForDark(false, false)).toBe(false);
    expect(tileDark(seenForDark(false, false), true, false, 255, 255, 255)).toBe(1);
  });
  it('a daylight map leaves the darkness off beyond sight (the vision mask only dims it)', () => {
    expect(seenForDark(false, true)).toBe(true);
    expect(tileDark(seenForDark(false, true), true, false, 255, 255, 255)).toBe(0);
  });
  it('a tile in sight is seen on both', () => {
    expect(seenForDark(true, false)).toBe(true);
    expect(seenForDark(true, true)).toBe(true);
  });
});

describe('warmTint', () => {
  it('is white where the tile is not lit', () => {
    expect(warmTint(0, 0, 0, false)).toEqual([255, 255, 255]);
    expect(warmTint(255, 170, 90, false)).toEqual([255, 255, 255]);
  });
  it('multiplies by the light hue, its brightest channel staying 255', () => {
    const [r, g, b] = warmTint(255, 170, 90, true);
    expect(r).toBe(255);
    expect(g).toBeCloseTo(255 * (1 - WARM * (1 - 170 / 255)), 1);
    expect(b).toBeCloseTo(255 * (1 - WARM * (1 - 90 / 255)), 1);
  });
  it('scales the strength with a dim light', () => {
    const [, g] = warmTint(127.5, 85, 45, true);
    expect(g).toBeCloseTo(255 * (1 - 0.225 * (1 - 85 / 127.5)), 1);
  });
  it('clamps the strength for over-bright sums', () => {
    expect(warmTint(510, 340, 180, true)).toEqual(warmTint(255, 170, 90, true));
  });
  it('is never paler than white', () => {
    for (let n = 0; n < 200; n++) {
      const [r, g, b] = warmTint(Math.random() * 600, Math.random() * 600, Math.random() * 600, true);
      expect(Math.max(r, g, b)).toBeCloseTo(255, 9);
      for (const c of [r, g, b]) expect(c).toBeLessThanOrEqual(255 + 1e-9);
    }
  });
});

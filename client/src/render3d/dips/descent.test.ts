import { describe, expect, it } from 'vitest';
import { CONST, TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { bedAt, LAVA_LEVEL } from './shape';
import {
  FALL_GONE, FALL_MAX_AGE, LAVA_SINK, SLIDE_MAX, drownY, standY, startFall, stepFall, stepLavaSink,
} from './descent';

const DROWN_TIME = CONST.DROWN_TIME;

describe('descent', () => {
  it('drops with gravity over the hole', () => {
    const f = startFall(5.5, 5.5, 0, 1, 0);
    for (let i = 0; i < 60; i++) stepFall(f, 1 / 60, () => -12);
    expect(Math.abs(f.y + 7)).toBeLessThan(0.2);
    expect(f.x).toBeCloseTo(5.5 + 1, 1);
  });

  it('is gone before the bottom', () => {
    const f = startFall(5.5, 5.5, 0, 0, 0);
    let t = 0;
    while (stepFall(f, 1 / 60, () => -12)) t += 1 / 60;
    expect(f.y).toBeLessThanOrEqual(-FALL_GONE + 1e-9);
    expect(t).toBeGreaterThan(1.2);
    expect(t).toBeLessThan(1.4);
  });

  it('gives up after FALL_MAX_AGE', () => {
    const f = startFall(5.5, 5.5, 0, 0, 0);
    let t = 0, low = 0;
    while (stepFall(f, 1 / 60, () => 0)) { t += 1 / 60; low = Math.min(low, f.y); }
    expect(t).toBeGreaterThan(FALL_MAX_AGE - 0.05);
    expect(t).toBeLessThan(FALL_MAX_AGE + 0.05);
    expect(low).toBe(0);
  });

  it('caps the slide', () => {
    const f = startFall(0, 0, 0, 30, 40);
    expect(Math.hypot(f.vx, f.vz)).toBeCloseTo(SLIDE_MAX);
  });

  it('never enters rock', () => {
    // A chasm strip one cell wide (column 5) through floor; the faller starts mid-strip, sliding across it.
    const w = 11, h = 11;
    const tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
    for (let j = 0; j < h; j++) tiles[j * w + 5] = TILE_ID.Chasm;
    const map = new TileMap(w, h, tiles);
    const bed = (x: number, z: number) => bedAt(map, x, z);
    for (const dt of [1 / 60, 0.05]) {
      const f = startFall(5.5, 5.5, 0, SLIDE_MAX, 0);
      let steps = 0;
      while (stepFall(f, dt, bed)) {
        expect(bed(f.x, f.z)).toBeLessThanOrEqual(f.y + 1e-6);
        if (++steps > 1000) throw new Error('never gone');
      }
    }
  });

  it('slides off a rim first', () => {
    // 3x3 chasm block; start on its rounded outer corner, where the bed is about 0.
    const w = 10, h = 10;
    const tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
    for (let j = 3; j < 6; j++) for (let i = 3; i < 6; i++) tiles[j * w + i] = TILE_ID.Chasm;
    const map = new TileMap(w, h, tiles);
    const bed = (x: number, z: number) => bedAt(map, x, z);
    const sx = 3.08, sz = 3.08;
    expect(Math.abs(bed(sx, sz))).toBeLessThan(0.1);
    const f = startFall(sx, sz, bed(sx, sz), 0, 0);
    let t = 0;
    const d0 = Math.hypot(f.x - f.cx, f.z - f.cz);
    expect(stepFall(f, 1 / 60, bed)).toBe(true);
    // First step: pulled toward the cell centre, still standing on the bed.
    expect(Math.hypot(f.x - f.cx, f.z - f.cz)).toBeLessThan(d0);
    expect(f.y).toBeCloseTo(bed(f.x, f.z), 9);
    expect(f.vy).toBe(0);
    while (stepFall(f, 1 / 60, bed)) {
      t += 1 / 60;
      expect(bed(f.x, f.z)).toBeLessThanOrEqual(f.y + 1e-6);
    }
    expect(t).toBeLessThan(FALL_MAX_AGE);
  });

  it('drowns onto the bed', () => {
    expect(drownY(-0.3, -2.3, 0)).toBe(-0.3);
    expect(drownY(-0.3, -2.3, DROWN_TIME)).toBe(-2.3);
    expect(drownY(-0.3, -2.3, 9)).toBe(-2.3);
    let prev = -0.3;
    for (let i = 1; i <= 20; i++) {
      const y = drownY(-0.3, -2.3, (DROWN_TIME * i) / 20);
      expect(y).toBeLessThanOrEqual(prev);
      prev = y;
    }
  });

  it('sinks slowly in lava and rises fast', () => {
    let s = 0;
    for (let i = 0; i < 60; i++) s = stepLavaSink(s, true, 1 / 60);
    expect(s).toBeGreaterThan(0.3);
    expect(s).toBeLessThan(0.6);
    for (let i = 0; i < 300; i++) s = stepLavaSink(s, true, 1 / 60);
    expect(Math.abs(s - LAVA_SINK)).toBeLessThan(0.05);
    for (let i = 0; i < 60; i++) s = stepLavaSink(s, false, 1 / 60);
    expect(s).toBeLessThan(0.1);
  });

  it('stands on the bed or floats', () => {
    expect(standY(-0.4, null)).toBe(-0.4);
    expect(standY(-1.7, 1.05)).toBeCloseTo(LAVA_LEVEL - 1.05);
    expect(standY(-0.1, 1.05)).toBe(-0.1);
  });
});

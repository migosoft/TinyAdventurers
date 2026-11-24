import { describe, expect, it } from 'vitest';
import { Shake, blastFalloff, groundShift } from './shake';
import { project } from '../camera';

describe('groundShift', () => {
  it('moves the camera so the picture shifts by the offset in canvas px', () => {
    for (const yaw of [0, 0.7, 2.5]) {
      const cam = { x: 5, z: 6, pitch: 0.85, yaw }, o = { x: 0, z: 0 }, k = 16 * 3;
      groundShift(cam.pitch, yaw, 9, -6, k, o);
      const before = project(cam, 7, 0, 8), after = project({ ...cam, x: cam.x + o.x, z: cam.z + o.z }, 7, 0, 8);
      // sx grows to the right, sy up: a shift of (+9, -6) canvas px is +9 in sx and +6 in sy, in canvas px
      expect((after.sx - before.sx) * k).toBeCloseTo(9, 4);
      expect((after.sy - before.sy) * k).toBeCloseTo(6, 4);
    }
  });
});

describe('Shake', () => {
  it('shake ends: 0 from 90 ms on, within the intensity before', () => {
    const s = new Shake(), o = { x: 0, y: 0 };
    s.kick(90, 0.003);
    let moved = false;
    for (let t = 0; t < 90; t += 10) {
      s.offset(1000 + t, 800, 600, o);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(0.003 * 800);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(0.003 * 600);
      if (o.x !== 0 || o.y !== 0) moved = true;
    }
    expect(moved).toBe(true);
    s.offset(1090, 800, 600, o);
    expect(o).toEqual({ x: 0, y: 0 });
    s.offset(1100, 800, 600, o);
    expect(o).toEqual({ x: 0, y: 0 });
  });

  it('is still without a kick, and a weaker kick does not cut a stronger one', () => {
    const s = new Shake(), o = { x: 0, y: 0 };
    s.offset(0, 800, 600, o);
    expect(o).toEqual({ x: 0, y: 0 });
    s.kick(100, 0.01);
    s.kick(100, 0.001);
    let big = 0;
    for (let t = 0; t < 50; t += 5) { s.offset(t, 800, 600, o); big = Math.max(big, Math.abs(o.x)); }
    expect(big).toBeGreaterThan(0.001 * 800);
  });
});

describe('blastFalloff', () => {
  it('is 1 on the hero, falls linearly and is 0 at the range and beyond', () => {
    expect(blastFalloff(0, 200)).toBe(1);
    expect(blastFalloff(50, 200)).toBeCloseTo(0.75);
    expect(blastFalloff(200, 200)).toBe(0);
    expect(blastFalloff(900, 200)).toBe(0);
    expect(blastFalloff(0, 0)).toBe(0);
  });
});

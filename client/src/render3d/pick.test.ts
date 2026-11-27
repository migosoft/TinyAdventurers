import { describe, expect, it } from 'vitest';
import { CONST, FLAG, KIND, SIDE } from '../generated/defs';
import { type Cam } from './camera';
import { cylinderOf, pickCylinder, pickable, type PickCyl } from './pick';
import { renderPlan } from './quality';
import { toCanvas } from './screen';

const rad = (d: number): number => (d * Math.PI) / 180;
const zoom = 4;
const plan = renderPlan('high', zoom, 1920, 1080);
const cyl = (id: number, x: number, z: number, r = 6, h = 10, y = 0): PickCyl => ({ id, x, z, y, r, h });
const goblin = { kind: KIND.GoblinArcher, side: SIDE.Hostile, flags: 0 };
const here = { x: 0, z: 0, y: 0, alpha: 1 };

for (const p of [30, 48.6, 80]) for (const yaw of [0, 90, 135]) {
  const cam: Cam = { x: 20.37, z: 11.81, pitch: rad(p), yaw: rad(yaw) };
  const sp = Math.sin(rad(p));
  const at = (c: PickCyl, dx: number, up: number): [number, number] => {
    const f = toCanvas(cam, plan, zoom, c.x, c.y, c.z);
    return [f.px + dx * zoom, f.py - up * zoom];
  };
  const tag = `pitch ${p} yaw ${yaw}`;
  const g = cyl(1, 20.4, 11.8);
  describe(tag, () => {
    it('picks a goblin archer at its legs', () => {
      expect(pickCylinder(cam, plan, zoom, ...at(g, 0, 2), [g])).toBe(g);
      expect(pickCylinder(cam, plan, zoom, ...at(g, 0, 9), [g])).toBe(g);
      expect(pickCylinder(cam, plan, zoom, ...at(g, 0, g.h + g.r * sp + 1), [g])).toBeNull();
    });
    it('misses beside it', () => {
      expect(pickCylinder(cam, plan, zoom, ...at(g, g.r + 1, 4), [g])).toBeNull();
    });
    it('the nearer of two overlapping cylinders wins', () => {
      // one tile nearer the camera: screen-down by (yaw-rotated) view direction
      const nx = -Math.sin(rad(yaw)), nz = Math.cos(rad(yaw));
      const near = cyl(2, g.x + nx, g.z + nz, 6, 40);
      const far = cyl(3, g.x, g.z, 6, 40);
      const pt = at(near, 0, 20);
      expect(pickCylinder(cam, plan, zoom, ...pt, [far, near])).toBe(near);
      expect(pickCylinder(cam, plan, zoom, ...pt, [near, far])).toBe(near);
    });
    it('the lifted dragon', () => {
      const d = cyl(4, g.x, g.z, 12, 24 + CONST.DRAGON_LIFT);
      expect(pickCylinder(cam, plan, zoom, ...at(d, 0, d.h - 2), [d])).toBe(d);
      expect(pickCylinder(cam, plan, zoom, ...at(d, 0, d.h + d.r * sp + 1), [d])).toBeNull();
    });
  });
}

describe('cylinderOf', () => {
  it('skips what must not be picked', () => {
    const skip = [
      { kind: KIND.Mimic, side: SIDE.Hostile, flags: FLAG.HIDING },
      { ...goblin, flags: FLAG.DEAD },
      { kind: KIND.Chest, side: SIDE.Neutral, flags: 0 },
      { kind: KIND.Barrel, side: SIDE.Neutral, flags: 0 },
      { kind: KIND.Knight, side: SIDE.Friendly, flags: 0 },
      { kind: KIND.RaisedSkeleton, side: SIDE.Friendly, flags: 0 },
    ];
    for (const e of skip) { expect(pickable(e)).toBe(false); expect(cylinderOf({ id: 1, ...e }, here)).toBeNull(); }
    expect(cylinderOf({ id: 1, kind: KIND.Ghost, side: SIDE.Hostile, flags: 0 }, { ...here, alpha: 0 })).toBeNull();
  });
  it('a hostile goblin archer is a 6 x 10 cylinder; airborne adds the lift', () => {
    expect(cylinderOf({ id: 7, ...goblin }, { x: 3, z: 4, y: 0.5, alpha: 1 })).toEqual({ id: 7, x: 3, z: 4, y: 0.5, r: 6, h: 10 });
    expect(cylinderOf({ id: 7, ...goblin, flags: FLAG.AIRBORNE }, here)?.h).toBe(10 + CONST.DRAGON_LIFT);
  });
});

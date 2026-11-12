import { describe, expect, it } from 'vitest';
import { aimAt, settleOwnAim, SHOT_LIFT_PX } from './aim';
import type { OwnHero } from './view';

const hero = (over: Partial<OwnHero> = {}): OwnHero => ({ x: 0, y: 0, alive: true, charmed: false, anim: 0, animT: 0, aim: 1.25, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false, aimsAtPointer: true, aimFromX: 10, aimFromY: 20, ...over });

describe('aim', () => {
  it('the shot lift is 8 art px', () => expect(SHOT_LIFT_PX).toBe(8));
  it('aimAt measures angle and distance', () => {
    expect(aimAt({ x: 10, y: 20 }, { x: 40, y: 20 })).toEqual({ aim: 0, dist: 30 });
    expect(aimAt({ x: 10, y: 20 }, { x: 10, y: 50 }).aim).toBeCloseTo(Math.PI / 2);
  });
  it('settleOwnAim writes the angle from the aim origin', () => {
    const o = hero();
    settleOwnAim(o, { x: 10, y: 50 });
    expect(o.aim).toBeCloseTo(Math.PI / 2);
  });
  it('settleOwnAim leaves the aim without a pointer or when not aiming at it', () => {
    const a = hero();
    settleOwnAim(a, null);
    expect(a.aim).toBe(1.25);
    const b = hero({ aimsAtPointer: false });
    settleOwnAim(b, { x: 99, y: 20 });
    expect(b.aim).toBe(1.25);
  });
});

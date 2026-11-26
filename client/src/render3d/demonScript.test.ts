import { describe, expect, it } from 'vitest';
import { ANIM, FLAG } from '../generated/defs';
import { WING } from './demon/wings';
import { DEMON_ACTS, WINGS_ACT, actPeriod, demonAct, demonDev } from './demonScript';

describe('the demon\'s acts (?r3d=demon)', () => {
  it('lists every act once', () => {
    expect(new Set(DEMON_ACTS).size).toBe(DEMON_ACTS.length);
    expect(DEMON_ACTS[0]).toBe('stand');
  });

  it('stand: idle, animMs the seconds into the loop, which repeats', () => {
    expect(demonAct('stand', 0)).toEqual({ anim: ANIM.Idle, animMs: 0, flags: 0 });
    expect(demonAct('stand', 1.5).animMs).toBeCloseTo(1500, 6);
    expect(demonAct('stand', actPeriod('stand') + 1.5).animMs).toBeCloseTo(1500, 6);
    expect(demonDev('stand', 2)).toEqual({ fold: null, turn: 0 });
  });

  it('wings: the fold to 0, to 1 and back, three beats in the air, a turn right and left; the loop ends as it began', () => {
    const W = WINGS_ACT, fold = (s: number): number | null => demonDev('wings', s).fold, turn = (s: number): number => demonDev('wings', s).turn;
    expect(fold(0)).toBeNull();
    expect(fold(W.fold[0][0])).toBeCloseTo(WING.rest.fold, 9);
    expect(fold(1.45)).toBe(0);
    expect(fold(3.1)).toBe(1);
    expect(fold(2.3)).toBeGreaterThan(0.3);
    expect(fold(2.3)).toBeLessThan(0.7);
    expect(fold(4.3)).toBeCloseTo(WING.rest.fold, 9);
    expect(fold(W.air)).toBeNull();
    const air = (s: number): boolean => (demonAct('wings', s).flags & FLAG.AIRBORNE) !== 0;
    expect([air(W.air - 0.01), air(W.air), air(W.air + 3 * WING.beat - 0.01), air(W.air + 3 * WING.beat + 0.01)]).toEqual([false, true, true, false]);
    expect(turn(8)).toBe(0);
    expect(turn(9.8)).toBeCloseTo(1.2, 9);
    expect(turn(11.3)).toBeCloseTo(-1.2, 9);
    expect(turn(W.period - 0.01)).toBe(0);
    expect(actPeriod('wings')).toBe(W.period);
    expect(demonDev('wings', W.period + 3.1).fold).toBe(1);
    // no step from frame to frame
    for (let s = 0; s < W.period; s += 1 / 60) expect(Math.abs(turn(s + 1 / 60) - turn(s))).toBeLessThan(0.08);
  });
});

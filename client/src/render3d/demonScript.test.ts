import { describe, expect, it } from 'vitest';
import { ANIM, CONST, FLAG } from '../generated/defs';
import { WING } from './demon/wings';
import { DEMON_ACTS, FLY_ACT, WAYS, WINGS_ACT, actPeriod, demonAct, demonDev } from './demonScript';

describe('the demon\'s acts (?r3d=demon)', () => {
  it('lists every act once', () => {
    expect(new Set(DEMON_ACTS).size).toBe(DEMON_ACTS.length);
    expect(DEMON_ACTS[0]).toBe('stand');
  });

  it('stand: idle, animMs the seconds into the loop, which repeats', () => {
    expect(demonAct('stand', 0)).toEqual({ anim: ANIM.Idle, animMs: 0, flags: 0 });
    expect(demonAct('stand', 1.5).animMs).toBeCloseTo(1500, 6);
    expect(demonAct('stand', actPeriod('stand') + 1.5).animMs).toBeCloseTo(1500, 6);
    expect(demonDev('stand', 2)).toEqual({ fold: null, turn: 0, along: 0 });
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

  it('the attacks: the server\'s anim from the wind-up through the recovery, for the server\'s times, then standing', () => {
    const rows: Array<[Parameters<typeof demonAct>[0], number, number]> = [
      ['claws', ANIM.Melee, CONST.DEMON_CLEAVE_WINDUP + CONST.DEMON_CLEAVE_RECOVER], ['tail', ANIM.Tail, CONST.DEMON_TAIL_WINDUP + CONST.DEMON_TAIL_RECOVER],
      ['cast', ANIM.Cast, CONST.DEMON_CAST_WINDUP + CONST.DEMON_CAST_RECOVER], ['breath', ANIM.Breath, CONST.DEMON_BREATH_WINDUP + CONST.DEMON_BREATH_TIME], ['broken', ANIM.Dash, 0.25],
    ];
    for (const [act, anim, secs] of rows) {
      expect(demonAct(act, 0)).toEqual({ anim, animMs: 0, flags: 0 });
      expect(demonAct(act, secs - 0.01).anim).toBe(anim);
      expect(demonAct(act, secs - 0.01).animMs).toBeCloseTo((secs - 0.01) * 1000, 6);
      expect(demonAct(act, secs + 0.01)).toMatchObject({ anim: ANIM.Idle, flags: 0 });
      expect(actPeriod(act)).toBeGreaterThan(secs + 0.5);
      expect(demonDev(act, 1)).toEqual({ fold: null, turn: 0, along: 0 });
    }
    // hurt: the flag comes up once a second, on a standing demon
    expect(demonAct('hurt', 1.05)).toMatchObject({ anim: ANIM.Idle, flags: FLAG.HURT });
    expect(demonAct('hurt', 1.5).flags).toBe(0);
  });

  it('walk and swoop go there and back along the facing and turn round; the loop ends where it began', () => {
    const W = WAYS.walk, S = WAYS.swoop, swoop = CONST.DEMON_SWOOP_WINDUP + CONST.DEMON_SWOOP_TIME + CONST.DEMON_SWOOP_RECOVER;
    expect(demonAct('walk', W.from - 0.01).anim).toBe(ANIM.Idle);
    expect(demonAct('walk', W.from + 0.5)).toMatchObject({ anim: ANIM.Move, flags: 0 });
    expect(demonAct('walk', W.to + 0.01).anim).toBe(ANIM.Idle);
    expect(demonDev('walk', 0).along).toBeCloseTo(-W.px / 2, 9);
    expect(demonDev('walk', W.to).along).toBeCloseTo(W.px / 2, 9);
    expect(demonDev('walk', W.turn - 0.01).turn).toBe(0);
    expect(demonDev('walk', W.turn + 0.01).turn).toBeCloseTo(Math.PI, 9);
    expect(demonDev('walk', W.half + W.to).along).toBeCloseTo(-W.px / 2, 9);
    expect(demonDev('walk', 2 * W.half - 0.01).turn).toBeCloseTo(2 * Math.PI, 9);   // facing as at the start again
    expect(demonAct('swoop', S.wait + 0.01)).toMatchObject({ anim: ANIM.Dash, flags: 0 });
    expect(demonAct('swoop', S.wait + swoop - 0.01).anim).toBe(ANIM.Dash);
    expect(demonAct('swoop', S.wait + swoop + 0.01).anim).toBe(ANIM.Idle);
    // it moves only while the dash runs
    expect(demonDev('swoop', S.from).along).toBeCloseTo(-S.px / 2, 9);
    expect(demonDev('swoop', S.to).along).toBeCloseTo(S.px / 2, 9);
    for (const act of ['walk', 'swoop'] as const) for (let s = 0; s < actPeriod(act); s += 1 / 60) expect(Math.abs(demonDev(act, s + 1 / 60).along - demonDev(act, s).along)).toBeLessThan(6);
  });

  it('fly: the take-off, airborne with a cast and a breath, the landing with the flag still up, then standing', () => {
    const F = FLY_ACT, at = (s: number) => demonAct('fly', s);
    expect(at(F.takeoff - 0.01)).toMatchObject({ anim: ANIM.Idle, flags: 0 });
    expect(at(F.takeoff + 0.01)).toMatchObject({ anim: ANIM.TakeOff, flags: 0 });
    expect(F.air - F.takeoff).toBeCloseTo(CONST.DEMON_TAKEOFF, 9);
    expect(at(F.air + 0.01)).toMatchObject({ anim: ANIM.Idle, flags: FLAG.AIRBORNE });
    expect(at(F.cast[0] + 0.1)).toMatchObject({ anim: ANIM.Cast, flags: FLAG.AIRBORNE });
    expect(at(F.cast[0] + 0.1).animMs).toBeCloseTo(100, 6);
    expect(at(F.cast[1] + 0.1)).toMatchObject({ anim: ANIM.Idle, flags: FLAG.AIRBORNE });
    expect(at(F.breath[0] + 0.1)).toMatchObject({ anim: ANIM.Breath, flags: FLAG.AIRBORNE });
    expect(F.breath[1] - F.breath[0]).toBeCloseTo(CONST.DEMON_BREATH_WINDUP + CONST.DEMON_BREATH_TIME, 9);
    // the breath began before the flight's time was up; the landing waits for its end
    expect(F.breath[0] - F.air).toBeLessThan(CONST.DEMON_FLIGHT);
    expect(at(F.land + 0.01)).toMatchObject({ anim: ANIM.Land, flags: FLAG.AIRBORNE });
    expect(F.down - F.land).toBeCloseTo(CONST.DEMON_LAND, 9);
    expect(at(F.down + 0.01)).toMatchObject({ anim: ANIM.Idle, flags: 0 });
    expect(at(F.down + 0.01).animMs).toBeCloseTo(10, 6);
  });
});

import { describe, expect, it } from 'vitest';
import { ANIM, CONST, FLAG } from '../generated/defs';
import { LICH_ACTS, actPeriod, lichAct, type LichAct } from './lichScript';

/** The wind-up anim and its length per act that has one, and the idle seconds after it. */
const WINDS: Partial<Record<LichAct, { anim: number; wind: number; rest: number }>> = {
  nova: { anim: ANIM.Slam, wind: CONST.LICH_NOVA_WINDUP, rest: 1.6 },
  raise: { anim: ANIM.Summon, wind: CONST.MINION_WINDUP, rest: 1.8 },
  bolts: { anim: ANIM.Windup, wind: CONST.LICH_GLOOM_WINDUP, rest: 1.4 },
  curse: { anim: ANIM.Windup, wind: CONST.LICH_BLIND_WINDUP, rest: 1.4 },
  mist: { anim: ANIM.Windup, wind: CONST.LICH_SLEEP_WINDUP, rest: 1.4 },
  gaze: { anim: ANIM.Gaze, wind: CONST.LICH_GAZE_WINDUP, rest: 1 },
  broken: { anim: ANIM.Windup, wind: 0.25, rest: 1.5 },
};

describe('the lich\'s acts (?r3d=lich)', () => {
  it('lists every act once', () => {
    expect(new Set(LICH_ACTS).size).toBe(LICH_ACTS.length);
    expect(LICH_ACTS).toEqual(['stand', 'glide', 'nova', 'raise', 'bolts', 'curse', 'mist', 'gaze', 'hurt', 'broken']);
  });

  for (const [act, w] of Object.entries(WINDS) as [LichAct, NonNullable<(typeof WINDS)[LichAct]>][]) {
    it(`${act}: the wind-up anim, then idle, animMs the seconds into the anim`, () => {
      expect(actPeriod(act)).toBeCloseTo(w.wind + w.rest, 9);
      const start = lichAct(act, 0, 7);
      expect(start.anim).toBe(w.anim);
      expect(start.animMs).toBe(0);
      const mid = lichAct(act, w.wind / 2, 7);
      expect(mid.anim).toBe(w.anim);
      expect(mid.animMs).toBeCloseTo((w.wind / 2) * 1000, 6);
      const after = lichAct(act, w.wind + 0.3, 7);
      expect(after.anim).toBe(ANIM.Idle);
      expect(after.animMs).toBeCloseTo(300, 6);
      expect(lichAct(act, w.wind - 0.001, 7).anim).toBe(w.anim);
      expect(lichAct(act, w.wind, 7).anim).toBe(ANIM.Idle);
    });
  }

  it('the gaze carries its target, no other act does', () => {
    expect(lichAct('gaze', 0.5, 42).extra).toBe(42);
    for (const act of LICH_ACTS) if (act !== 'gaze') expect(lichAct(act, 0.5, 42).extra).toBe(0);
  });

  it('hurt idles and flags HURT only below 0.15 s', () => {
    expect(actPeriod('hurt')).toBe(1.5);
    expect(lichAct('hurt', 0.07, 0)).toMatchObject({ anim: ANIM.Idle, flags: FLAG.HURT });
    expect(lichAct('hurt', 0.1499, 0).flags).toBe(FLAG.HURT);
    expect(lichAct('hurt', 0.15, 0).flags).toBe(0);
    expect(lichAct('hurt', 1, 0)).toMatchObject({ anim: ANIM.Idle, flags: 0, animMs: 1000 });
    for (const act of LICH_ACTS) if (act !== 'hurt') expect(lichAct(act, 0.07, 0).flags).toBe(0);
  });

  it('stand idles and glide moves', () => {
    expect(lichAct('stand', 1.5, 0)).toMatchObject({ anim: ANIM.Idle, animMs: 1500 });
    expect(lichAct('glide', 1.5, 0)).toMatchObject({ anim: ANIM.Move, animMs: 1500 });
  });

  it('every act loops at its period', () => {
    for (const act of LICH_ACTS) {
      const p = actPeriod(act);
      expect(p).toBeGreaterThan(0);
      for (const t of [0.01, 0.1, 0.37, 0.83, p - 0.05]) {
        const a = lichAct(act, t, 3), b = lichAct(act, t + p, 3), c = lichAct(act, t + 3 * p, 3);
        expect(b.anim).toBe(a.anim);
        expect(b.flags).toBe(a.flags);
        expect(b.extra).toBe(a.extra);
        expect(b.animMs).toBeCloseTo(a.animMs, 6);
        expect(c.animMs).toBeCloseTo(a.animMs, 6);
      }
      // before the start: the end of the previous loop
      expect(lichAct(act, -0.1, 3).animMs).toBeCloseTo(lichAct(act, p - 0.1, 3).animMs, 6);
    }
  });
});

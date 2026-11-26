import { describe, expect, it } from 'vitest';
import { ANIM } from '../generated/defs';
import { DEMON_ACTS, actPeriod, demonAct } from './demonScript';

describe('the demon\'s acts (?r3d=demon)', () => {
  it('lists every act once', () => {
    expect(new Set(DEMON_ACTS).size).toBe(DEMON_ACTS.length);
    expect(DEMON_ACTS[0]).toBe('stand');
  });

  it('stand: idle, animMs the seconds into the loop, which repeats', () => {
    expect(demonAct('stand', 0)).toEqual({ anim: ANIM.Idle, animMs: 0, flags: 0 });
    expect(demonAct('stand', 1.5).animMs).toBeCloseTo(1500, 6);
    expect(demonAct('stand', actPeriod('stand') + 1.5).animMs).toBeCloseTo(1500, 6);
  });
});

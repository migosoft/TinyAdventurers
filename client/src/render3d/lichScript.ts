// The acts of the lich's dev page (#358, `?r3d=lich`): each is a loop of what a run would send for the lich, as a pure function of the
// seconds into the loop. A wind-up anim lasts the server's wind-up (`CONST.*_WINDUP`), then the lich idles; the pose reads the anim and
// its seconds (`animMs`) as it does in a run, so the page shows the release, the second half and the ease back as a run does.

import { ANIM, CONST, FLAG } from '../generated/defs';
import type { EntState } from '../game/world';

export type LichAct = 'stand' | 'glide' | 'nova' | 'raise' | 'bolts' | 'curse' | 'mist' | 'gaze' | 'hurt' | 'broken';
export const LICH_ACTS: readonly LichAct[] = ['stand', 'glide', 'nova', 'raise', 'bolts', 'curse', 'mist', 'gaze', 'hurt', 'broken'];

/** The anim of the first part of a loop and its length in seconds (the wind-up), then the seconds of idling after it. */
interface Loop { anim: number; wind: number; rest: number }

const LOOPS: Record<LichAct, Loop> = {
  stand: { anim: ANIM.Idle, wind: 0, rest: 4 },
  glide: { anim: ANIM.Move, wind: 4, rest: 0 },
  nova: { anim: ANIM.Slam, wind: CONST.LICH_NOVA_WINDUP, rest: 1.6 },
  raise: { anim: ANIM.Summon, wind: CONST.MINION_WINDUP, rest: 1.8 },
  bolts: { anim: ANIM.Windup, wind: CONST.LICH_GLOOM_WINDUP, rest: 1.4 },
  curse: { anim: ANIM.Windup, wind: CONST.LICH_BLIND_WINDUP, rest: 1.4 },
  mist: { anim: ANIM.Windup, wind: CONST.LICH_SLEEP_WINDUP, rest: 1.4 },
  gaze: { anim: ANIM.Gaze, wind: CONST.LICH_GAZE_WINDUP, rest: 1 },
  hurt: { anim: ANIM.Idle, wind: 0, rest: 1.5 },
  broken: { anim: ANIM.Windup, wind: 0.25, rest: 1.5 },
};

/** The seconds the hurt flag stays up in the `hurt` loop. */
const HURT_SECS = 0.15;

/** The loop's length in seconds. */
export function actPeriod(act: LichAct): number {
  const l = LOOPS[act];
  return l.wind + l.rest;
}

/** What a run would send for the lich `at` seconds into the act's loop (any `at`: the loop repeats): anim, animMs, flags, extra. */
export function lichAct(act: LichAct, at: number, targetId: number): Pick<EntState, 'anim' | 'animMs' | 'flags' | 'extra'> {
  const l = LOOPS[act], period = l.wind + l.rest;
  const a = at - Math.floor(at / period) * period; // exact for `at` inside the first loop (a second `%` would add rounding)
  const winding = a < l.wind;
  const anim = winding ? l.anim : ANIM.Idle;
  return {
    anim,
    animMs: (winding ? a : a - l.wind) * 1000,
    flags: act === 'hurt' && a < HURT_SECS ? FLAG.HURT : 0,
    extra: act === 'gaze' ? targetId : 0,
  };
}

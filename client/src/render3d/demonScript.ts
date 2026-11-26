// The acts of the demon's dev page (#379, `?r3d=demon`): each is a loop of what a run would send for the demon, as a pure function of
// the seconds into the loop. In this state every act is the standing demon; the attacks, the flight and the rest come with their poses.

import { ANIM } from '../generated/defs';
import type { EntState } from '../game/world';

export type DemonAct = 'stand' | 'walk' | 'claws' | 'tail' | 'swoop' | 'cast' | 'breath' | 'fly' | 'hurt' | 'broken' | 'wings';
export const DEMON_ACTS: readonly DemonAct[] = ['stand', 'walk', 'claws', 'tail', 'swoop', 'cast', 'breath', 'fly', 'hurt', 'broken', 'wings'];

/** The standing loop's length (s): one pulse of the glow. */
const STAND = 4;

/** The loop's length in seconds. */
export function actPeriod(_act: DemonAct): number {
  return STAND;
}

/** What a run would send for the demon `at` seconds into the act's loop (any `at`: the loop repeats): anim, animMs, flags. */
export function demonAct(act: DemonAct, at: number): Pick<EntState, 'anim' | 'animMs' | 'flags'> {
  const period = actPeriod(act);
  return { anim: ANIM.Idle, animMs: (at - Math.floor(at / period) * period) * 1000, flags: 0 };
}

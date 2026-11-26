// The acts of the demon's dev page (#379, `?r3d=demon`): each is a loop of what a run would send for the demon, as a pure function of
// the seconds into the loop. In this state `stand` is the standing demon and `wings` shows the wings alone; the attacks, the flight and
// the rest come with their poses.

import { ANIM, FLAG } from '../generated/defs';
import type { EntState } from '../game/world';
import { WING } from './demon/wings';

export type DemonAct = 'stand' | 'walk' | 'claws' | 'tail' | 'swoop' | 'cast' | 'breath' | 'fly' | 'hurt' | 'broken' | 'wings';
export const DEMON_ACTS: readonly DemonAct[] = ['stand', 'walk', 'claws', 'tail', 'swoop', 'cast', 'breath', 'fly', 'hurt', 'broken', 'wings'];

/** The standing loop's length (s): one pulse of the glow. */
const STAND = 4;
/**
 * The act `wings`, no run sends it: the fold from the rest to 0, to 1 and back ([s, fold] keys), three beats in the air from `air`
 * on, then a turn to the right and to the left ([s, rad] keys); `period` s in all.
 */
export const WINGS_ACT = {
  fold: [[0.5, WING.rest.fold], [1.3, 0], [1.6, 0], [3, 1], [3.3, 1], [4.3, WING.rest.fold]],
  air: 4.5, beats: 3,
  turn: [[8.8, 0], [9.5, 1.2], [10.1, 1.2], [11.1, -1.2], [11.6, -1.2], [12.4, 0]],
  period: 13,
} as const;

/** The loop's length in seconds. */
export function actPeriod(act: DemonAct): number {
  return act === 'wings' ? WINGS_ACT.period : STAND;
}

const loop = (act: DemonAct, at: number): number => { const period = actPeriod(act); return at - Math.floor(at / period) * period; };

/** What a run would send for the demon `at` seconds into the act's loop (any `at`: the loop repeats): anim, animMs, flags. */
export function demonAct(act: DemonAct, at: number): Pick<EntState, 'anim' | 'animMs' | 'flags'> {
  const s = loop(act, at), air = act === 'wings' && s >= WINGS_ACT.air && s < WINGS_ACT.air + WINGS_ACT.beats * WING.beat;
  return { anim: ANIM.Idle, animMs: s * 1000, flags: air ? FLAG.AIRBORNE : 0 };
}

/** The value of the [s, value] keys at `s`, eased from key to key; null outside them. */
function keyed(keys: ReadonlyArray<readonly [number, number]>, s: number): number | null {
  if (s < keys[0][0] || s > keys[keys.length - 1][0]) return null;
  let i = 1;
  while (i < keys.length - 1 && s > keys[i][0]) i++;
  const u = (s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
  return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * u * u * (3 - 2 * u);
}

/** What the page itself does to the demon in an act: `fold` the wings' fold (null: the figure's own), `turn` rad added to its aim. */
export function demonDev(act: DemonAct, at: number): { fold: number | null; turn: number } {
  if (act !== 'wings') return { fold: null, turn: 0 };
  const s = loop(act, at);
  return { fold: keyed(WINGS_ACT.fold, s), turn: keyed(WINGS_ACT.turn, s) ?? 0 };
}

// The acts of the demon's dev page (#379, `?r3d=demon`): each is a loop of what a run would send for the demon, as a pure function of
// the seconds into the loop: the anims and flags the server's script sends (`server/src/run/bosses/demon.rs`, `flight.rs`), for the
// server's times (`CONST.DEMON_*`). `demonDev` is what the page itself does to the demon meanwhile (its way over the floor, a turn).

import { ANIM, CONST, FLAG } from '../generated/defs';
import type { EntState } from '../game/world';
import { WING } from './demon/wings';

export type DemonAct = 'stand' | 'walk' | 'claws' | 'scimitar' | 'tail' | 'swoop' | 'cast' | 'breath' | 'fly' | 'hurt' | 'broken' | 'wings';
export const DEMON_ACTS: readonly DemonAct[] = ['stand', 'walk', 'claws', 'scimitar', 'tail', 'swoop', 'cast', 'breath', 'fly', 'hurt', 'broken', 'wings'];

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

/** An attack's anim runs through its wind-up, its strike and its recovery; the loop then stands until `period`. */
const ATTACKS = {
  claws: { anim: ANIM.Melee, secs: CONST.DEMON_CLAW_WINDUP + CONST.DEMON_CLAW_RECOVER, period: 2 },
  scimitar: { anim: ANIM.Cleave, secs: CONST.DEMON_SCIMITAR_WINDUP + CONST.DEMON_SCIMITAR_RECOVER, period: 2.6 },
  tail: { anim: ANIM.Tail, secs: CONST.DEMON_TAIL_WINDUP + CONST.DEMON_TAIL_RECOVER, period: 2.4 },
  cast: { anim: ANIM.Cast, secs: CONST.DEMON_CAST_WINDUP + CONST.DEMON_CAST_RECOVER, period: 2 },
  breath: { anim: ANIM.Breath, secs: CONST.DEMON_BREATH_WINDUP + CONST.DEMON_BREATH_TIME, period: 3.6 },
  /** A Swoop's wind-up broken off (a stun): the anim ends early. */
  broken: { anim: ANIM.Dash, secs: 0.25, period: 2 },
} as const;
/** The demon's walking speed, game px a second (`server/src/defs/bosses.rs`; the client's data does not carry it). */
export const DEMON_SPEED = 50;
const SWOOP = CONST.DEMON_SWOOP_WINDUP + CONST.DEMON_SWOOP_TIME + CONST.DEMON_SWOOP_RECOVER;
/**
 * `walk` and `swoop` go there and back: each half of the loop the demon stands for `wait`, goes `px` game px along its facing from
 * `from` to `to` (walking at the server's speed, or in the Swoop's dash), stands, and turns round at `turn` (the page turns the aim at
 * once, as the server does; the figure's facing follows as it does in a run).
 */
export const WAYS = {
  walk: { half: 4.2, wait: 0.4, from: 0.4, to: 0.4 + 100 / DEMON_SPEED, px: 100, turn: 2.8 },
  swoop: { half: 3.6, wait: 0.4, from: 0.4 + CONST.DEMON_SWOOP_WINDUP, to: 0.4 + CONST.DEMON_SWOOP_WINDUP + CONST.DEMON_SWOOP_TIME, px: 90, turn: 2.2 },
} as const;
/**
 * The flight ([from, to] s of the loop): the take-off, then airborne: a Cast, a Breath (the server lands only once an action under way
 * has ended, so this flight is longer than `CONST.DEMON_FLIGHT`), the landing, and standing while it settles.
 */
export const FLY_ACT = (() => {
  const takeoff = 0.4, air = takeoff + CONST.DEMON_TAKEOFF, cast = air + 1.5, castEnd = cast + ATTACKS.cast.secs, breath = castEnd + 0.4, land = breath + ATTACKS.breath.secs;
  return { takeoff, air, cast: [cast, castEnd], breath: [breath, land], land, down: land + CONST.DEMON_LAND, period: land + CONST.DEMON_LAND + 2.2 } as const;
})();
/** The act `hurt`: the flag is up for `secs` every `every` s. */
const HURT = { every: 1, secs: 0.1 } as const;

/** The loop's length in seconds. */
export function actPeriod(act: DemonAct): number {
  if (act === 'wings') return WINGS_ACT.period;
  if (act === 'walk' || act === 'swoop') return 2 * WAYS[act].half;
  if (act === 'fly') return FLY_ACT.period;
  return act === 'stand' || act === 'hurt' ? STAND : ATTACKS[act].period;
}

const loop = (act: DemonAct, at: number): number => { const period = actPeriod(act); return at - Math.floor(at / period) * period; };
const send = (anim: number, secs: number, flags = 0): Pick<EntState, 'anim' | 'animMs' | 'flags'> => ({ anim, animMs: secs * 1000, flags });

/** What a run would send for the demon `at` seconds into the act's loop (any `at`: the loop repeats): anim, animMs, flags. */
export function demonAct(act: DemonAct, at: number): Pick<EntState, 'anim' | 'animMs' | 'flags'> {
  const s = loop(act, at);
  switch (act) {
    case 'stand': return send(ANIM.Idle, s);
    case 'hurt': return send(ANIM.Idle, s, s % HURT.every < HURT.secs ? FLAG.HURT : 0);
    case 'wings': return send(ANIM.Idle, s, s >= WINGS_ACT.air && s < WINGS_ACT.air + WINGS_ACT.beats * WING.beat ? FLAG.AIRBORNE : 0);
    case 'walk': { const W = WAYS.walk, h = s % W.half; return h >= W.from && h < W.to ? send(ANIM.Move, h - W.from) : send(ANIM.Idle, h < W.from ? h : h - W.to); }
    case 'swoop': { const W = WAYS.swoop, h = s % W.half - W.wait; return h >= 0 && h < SWOOP ? send(ANIM.Dash, h) : send(ANIM.Idle, h < 0 ? h + W.wait : h - SWOOP); }
    case 'fly': {
      const F = FLY_ACT;
      if (s < F.takeoff) return send(ANIM.Idle, s);
      if (s < F.air) return send(ANIM.TakeOff, s - F.takeoff);
      if (s >= F.down) return send(ANIM.Idle, s - F.down);
      if (s >= F.land) return send(ANIM.Land, s - F.land, FLAG.AIRBORNE);
      if (s >= F.breath[0]) return send(ANIM.Breath, s - F.breath[0], FLAG.AIRBORNE);
      if (s >= F.cast[0] && s < F.cast[1]) return send(ANIM.Cast, s - F.cast[0], FLAG.AIRBORNE);
      return send(ANIM.Idle, s < F.cast[0] ? s - F.air : s - F.cast[1], FLAG.AIRBORNE);
    }
    default: { const A = ATTACKS[act]; return s < A.secs ? send(A.anim, s) : send(ANIM.Idle, s - A.secs); }
  }
}

/** The value of the [s, value] keys at `s`, eased from key to key; null outside them. */
function keyed(keys: ReadonlyArray<readonly [number, number]>, s: number): number | null {
  if (s < keys[0][0] || s > keys[keys.length - 1][0]) return null;
  let i = 1;
  while (i < keys.length - 1 && s > keys[i][0]) i++;
  const u = (s - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
  return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * u * u * (3 - 2 * u);
}

/** What the page itself does to the demon in an act: `fold` the wings' fold (null: the figure's own), `turn` rad added to its aim, `along` game px it stands ahead of its place along the act's first facing. */
export function demonDev(act: DemonAct, at: number): { fold: number | null; turn: number; along: number } {
  const s = loop(act, at);
  if (act === 'wings') return { fold: keyed(WINGS_ACT.fold, s), turn: keyed(WINGS_ACT.turn, s) ?? 0, along: 0 };
  if (act !== 'walk' && act !== 'swoop') return { fold: null, turn: 0, along: 0 };
  const W = WAYS[act], back = s >= W.half, h = s % W.half, u = Math.min(1, Math.max(0, (h - W.from) / (W.to - W.from)));
  // the Swoop's dash slows into its end; a walk has the server's even speed
  const way = (act === 'swoop' ? u * (2 - u) : u) * W.px - W.px / 2;
  return { fold: null, turn: (back ? Math.PI : 0) + (h >= W.turn ? Math.PI : 0), along: back ? -way : way };
}

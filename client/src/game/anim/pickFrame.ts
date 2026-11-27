// Frame choice for figures with their own action frames (the dragon, the
// demon): lift-off and landing, hovering while airborne, wind-up then strike
// for attacks, walking, idling. Pack figures keep the idle/run/hit logic in
// the view.
import { ANIM, CONST, FLAG } from '../../generated/defs';
import type { FigureAnim, FigureDef } from './defs';

export interface Picked {
  frame: string;
  /** Height above the ground, 0..1 of `FigureDef.lift`. */
  lift: number;
  /** In an attack's wind-up: the telegraph flash plays. */
  windup: boolean;
}

/** Strike frames after the wind-up last this long each (s). */
const STRIKE_FRAME_T = 0.12;
/** The volley's open-mouth frame after the wind-up (s). */
const CAST_T = 0.35;

/** The demon's strike frame (arm coming through) shows this long before the hit (s). */
const SWING_T = 0.08;
/** The demon's charging frames loop at this rate (frames per second). */
const CHARGE_FPS = 10;

/** Wind-up of an attack anim (s) as the client sees it. */
export function windupOf(d: FigureDef, anim: number): number {
  return d.windups?.[anim] ?? 0;
}

const smooth = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};

/** `clock` drives idling and hovering, `runClock` the walk cycle (it speeds up with the figure). */
export function pickFrame(d: FigureDef, s: { anim: number; animT: number; flags: number }, clock: number, runClock: number, moving: boolean): Picked {
  const F = d.frames!;
  const at = (a: FigureAnim, i: number) => `${F[a]!.prefix}${Math.max(0, Math.min(F[a]!.n - 1, Math.floor(i)))}`;
  const loop = (a: FigureAnim, t: number) => at(a, Math.floor(t * F[a]!.fps) % F[a]!.n);
  const t = s.animT;
  const windup = t < (d.windups?.[s.anim] ?? 0);
  const ground = (frame: string, w = false): Picked => ({ frame, lift: 0, windup: w });

  const flight = d.flight;
  // The lift curves are the dragon's; a figure without flight frames (the demon) shows its idle loop while it rises and falls.
  if (s.anim === ANIM.TakeOff && flight) {
    // Crouch and beat the wings first; the feet leave the ground halfway.
    const k = t / flight.takeoff;
    const rise = smooth((k - 0.45) / 0.55);
    if (F.takeoff) return { frame: at('takeoff', k * F.takeoff.n), lift: rise, windup: false };
    return { frame: loop('idle', clock), lift: rise, windup: false };
  }
  if (s.anim === ANIM.Land && flight) {
    // Glide down with the wings up, touch down in a crouch, settle as the smash hits.
    const k = t / flight.land;
    const fall = 1 - smooth(k / 0.7);
    if (F.land) return { frame: at('land', k < 0.7 ? 0 : k < 0.88 ? 1 : 2), lift: fall, windup: false };
    return { frame: loop('idle', clock), lift: fall, windup: false };
  }
  if (s.flags & FLAG.AIRBORNE && F.hover && F.hoverbreath) {
    const fire = s.anim === ANIM.Breath && !windup;
    return { frame: loop(fire ? 'hoverbreath' : 'hover', clock), lift: 1, windup: s.anim === ANIM.Breath && windup };
  }
  if (F.cleave) {
    const w = d.windups![s.anim] ?? 0;
    // In the air (no hover frames) the ground frames are drawn lifted, in every anim.
    const air = s.flags & FLAG.AIRBORNE ? 1 : 0;
    const ground = (frame: string, wu = false): Picked => ({ frame, lift: air, windup: wu });
    switch (s.anim) {
      case ANIM.Melee:
      case ANIM.Cleave: {
        // Wind-up, the arm coming through just before the hit, then impact, follow-through, recovery.
        if (t < w) return ground(at('cleave', t < w - SWING_T ? 0 : 1), t < w - SWING_T);
        const k = (t - w) / (s.anim === ANIM.Cleave ? CONST.DEMON_SCIMITAR_RECOVER : CONST.DEMON_CLAW_RECOVER);
        return ground(at('cleave', k < 0.4 ? 2 : k < 0.75 ? 3 : 4));
      }
      case ANIM.Tail: {
        // The tail swipe: the cleave's frames and timing.
        if (t < w) return ground(at('cleave', t < w - SWING_T ? 0 : 1), t < w - SWING_T);
        const k = (t - w) / CONST.DEMON_TAIL_RECOVER;
        return ground(at('cleave', k < 0.4 ? 2 : k < 0.75 ? 3 : 4));
      }
      case ANIM.Dash:
        // Bull crouch, then the charge (two frames looping), then the stop.
        if (windup) return ground(at('charge', 0), true);
        if (t < w + CONST.DEMON_SWOOP_TIME) return ground(at('charge', 1 + (Math.floor((t - w) * CHARGE_FPS) % 2)));
        return ground(at('charge', 3));
      case ANIM.Cast:
        // Gathering power, rising as the wind-up ends, the burst with the ring of fire, recovery.
        if (windup) return ground(at('cast', t < w * 0.6 ? 0 : 1), true);
        return ground(at('cast', t < w + CONST.DEMON_CAST_RECOVER * 0.7 ? 2 : 3));
      case ANIM.Breath:
        // Gathering power as for the cast, then the arms flung wide while the breath lasts, then the recovery.
        if (windup) return ground(at('cast', t < w * 0.6 ? 0 : 1), true);
        return ground(at('cast', t < w + CONST.DEMON_BREATH_TIME ? 2 : 3));
    }
    return ground(moving ? loop('walk', runClock) : loop('idle', clock));
  }
  switch (s.anim) {
    case ANIM.Melee:
      return ground(windup ? at('claw', 0) : at('claw', 1 + (t - d.windups![ANIM.Melee]!) / STRIKE_FRAME_T), windup);
    case ANIM.Bite:
      return ground(windup ? at('bite', 0) : at('bite', 1 + (t - d.windups![ANIM.Bite]!) / STRIKE_FRAME_T), windup);
    case ANIM.Tail:
      return ground(windup ? at('tail', 0) : at('tail', 1 + (t - d.windups![ANIM.Tail]!) / STRIKE_FRAME_T), windup);
    case ANIM.Breath:
      return ground(at('breath', windup ? 0 : 1), windup);
    case ANIM.Windup:
    case ANIM.Summon:
      // The fireball volley: head back, mouth opening.
      return ground(at('breath', 0));
    case ANIM.Cast:
      if (t < CAST_T) return ground(at('breath', 1));
  }
  return ground(moving ? loop('walk', runClock) : loop('idle', clock));
}

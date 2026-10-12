// Frame choice for figures with their own action frames (the dragon):
// lift-off and landing, hovering while airborne, wind-up then strike for
// attacks, walking, idling. Pack figures keep the idle/run/hit logic in
// EntityView.
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

  if (s.anim === ANIM.TakeOff) {
    // Crouch and beat the wings first; the feet leave the ground halfway.
    const k = t / CONST.DRAGON_TAKEOFF;
    return { frame: at('takeoff', k * F.takeoff!.n), lift: smooth((k - 0.45) / 0.55), windup: false };
  }
  if (s.anim === ANIM.Land) {
    // Glide down with the wings up, touch down in a crouch, settle as the smash hits.
    const k = t / CONST.DRAGON_LAND;
    return { frame: at('land', k < 0.7 ? 0 : k < 0.88 ? 1 : 2), lift: 1 - smooth(k / 0.7), windup: false };
  }
  if (s.flags & FLAG.AIRBORNE) {
    const fire = s.anim === ANIM.Breath && !windup;
    return { frame: loop(fire ? 'hoverbreath' : 'hover', clock), lift: 1, windup: s.anim === ANIM.Breath && windup };
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
      // The fireball volley: head back, mouth opening.
      return ground(at('breath', 0));
    case ANIM.Cast:
      if (t < CAST_T) return ground(at('breath', 1));
  }
  return ground(moving ? loop('walk', runClock) : loop('idle', clock));
}

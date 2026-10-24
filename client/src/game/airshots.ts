// How a projectile stirs the dungeon air, derived from the data every projectile already has (anim/defs.ts).
import { PROJECTILES } from './anim/defs';

/** How a projectile stirs the air: wake half-width in px and heat (0..1). */
export interface ShotAir {
  readonly r: number;
  readonly heat: number;
}

const MIN_R = 6;
const MAX_R = 28;
const R_PER_SCALE = 12;

/** True for a warm glow: red channel >= 0xc0, red > green, and red > 1.4 x blue. */
function warm(glow: number): boolean {
  const r = (glow >> 16) & 0xff;
  const g = (glow >> 8) & 0xff;
  const b = glow & 0xff;
  return r >= 0xc0 && r > g && r > 1.4 * b;
}

/** From a PROJECTILES entry: width from its drawn size, heat from a warm glow; `air` overrides either. */
export function shotAir(def: { scale: number; glow?: number; air?: { r?: number; heat?: number } }): ShotAir {
  return {
    r: def.air?.r ?? Math.min(MAX_R, Math.max(MIN_R, R_PER_SCALE * def.scale)),
    heat: def.air?.heat ?? (def.glow !== undefined && warm(def.glow) ? 1 : 0),
  };
}

const cache = new Map<number, ShotAir>();

/** For a projectile kind; kinds without a PROJECTILES entry get the arrow-like default { r: 6, heat: 0 }. Memoized: the same object every time, never mutate it. */
export function projectileAir(kind: number): ShotAir {
  let a = cache.get(kind);
  if (!a) {
    const def = PROJECTILES[kind];
    a = def ? shotAir(def) : { r: MIN_R, heat: 0 };
    cache.set(kind, a);
  }
  return a;
}

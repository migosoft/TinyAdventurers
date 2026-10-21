// Effect looks in a snapshot: pure, so the sim-side world code can read them without Phaser.
import { EFFECT_LOOK } from '../generated/defs';

/**
 * The look an effect has on an entity: the look sent in the snapshot's `looks`
 * (entity id, effect id, look id; only non-default ones), else `Plain`.
 */
export function lookOf(looks: readonly (readonly [number, number, number])[], id: number, effect: number): number {
  for (const [i, e, l] of looks) if (i === id && e === effect) return l;
  return EFFECT_LOOK.Plain;
}

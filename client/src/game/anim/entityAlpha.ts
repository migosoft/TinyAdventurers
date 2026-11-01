// How see-through a figure is drawn: pure, so it can be tested without Phaser.
import { EFFECT, FLAG } from '../../generated/defs';
import { has } from '../status';

/** Incorporeal figures (phasing monsters) are always drawn at this alpha, visible or not. */
export const INCORPOREAL_ALPHA = 0.6;
/** A party hero under the Invisible effect (the party still sees it). */
export const INVISIBLE_PARTY_ALPHA = 0.35;
/** Default look of an entity going invisible (ghost fades out) or reappearing (fades in), in seconds. */
export const VANISH_SECS = 0.3;

export function entityAlpha(flags: number, effects: number, isParty: boolean): number {
  if (isParty && has(effects, EFFECT.Invisible)) return INVISIBLE_PARTY_ALPHA;
  if ((flags & FLAG.INCORPOREAL) !== 0) return INCORPOREAL_ALPHA;
  return 1;
}

/** Fade-in factor 0..1 given the seconds left of the fade. */
export function appearFactor(left: number, total: number): number {
  if (total <= 0 || left <= 0) return 1;
  return Math.max(0, 1 - left / total);
}

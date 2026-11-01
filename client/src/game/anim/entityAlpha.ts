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

/** Does this figure skim over terrain (no wading, sinking, splash or ripple)? A dash does; so does an incorporeal figure. */
export function skimsTerrain(flags: number, dashing: boolean): boolean {
  return dashing || (flags & FLAG.INCORPOREAL) !== 0;
}

/** Fade-in factor 0..1 given the seconds left of the fade. */
export function appearFactor(left: number, total: number): number {
  if (total <= 0 || left <= 0) return 1;
  return Math.max(0, 1 - left / total);
}

/** Ids waiting for a visual hand-off (events arrive ~the interpolation delay before the view changes). Entries expire. */
export class Marks {
  private at = new Map<number, number>();
  constructor(private ttl: number) {}
  add(id: number, now: number): void {
    this.at.set(id, now);
  }
  delete(id: number): void {
    this.at.delete(id);
  }
  /** True once if the id was marked and the mark has not expired; always clears it. */
  take(id: number, now: number): boolean {
    const t = this.at.get(id);
    this.at.delete(id);
    return t !== undefined && now - t <= this.ttl;
  }
  /** Drop expired marks. */
  prune(now: number): void {
    for (const [id, t] of this.at) if (now - t > this.ttl) this.at.delete(id);
  }
  clear(): void {
    this.at.clear();
  }
  get size(): number {
    return this.at.size;
  }
}

/** Longest a mark is honoured: the fade plus the interpolation delay cap (0.3 s) and some jitter. */
export const MARK_TTL = VANISH_SECS + 0.6;

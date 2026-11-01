// How see-through a figure is drawn: pure, so it can be tested without Phaser.
import { EFFECT, FLAG } from '../../generated/defs';
import { has } from '../status';

/** Incorporeal figures (phasing monsters) are always drawn at this alpha, visible or not. */
export const INCORPOREAL_ALPHA = 0.6;
/** A party hero under the Invisible effect (the party still sees it). */
export const INVISIBLE_PARTY_ALPHA = 0.35;
/** Default look of an entity going invisible (ghost fades out) or reappearing (fades in), in seconds. */
export const VANISH_SECS = 0.3;

/** A Ghost's alpha swells and fades between these, once per `GHOST_PULSE_SECS`. */
export const GHOST_ALPHA_MIN = 0.55;
export const GHOST_ALPHA_MAX = 0.85;
export const GHOST_PULSE_SECS = 1.5;
/** During the ambush wind-up the Ghost blinks on and off at this interval. */
export const GHOST_FLICKER_SECS = 0.06;

/** The Ghost's pulse: a sine between `GHOST_ALPHA_MIN` and `GHOST_ALPHA_MAX`. `phase` (rad) keeps a group out of step. */
export function ghostPulse(t: number, phase: number): number {
  const mid = (GHOST_ALPHA_MIN + GHOST_ALPHA_MAX) / 2;
  const amp = (GHOST_ALPHA_MAX - GHOST_ALPHA_MIN) / 2;
  return mid + amp * Math.sin((t * 2 * Math.PI) / GHOST_PULSE_SECS + phase);
}

/** A pulse phase (0..2 pi) from an entity id: a cheap integer hash, so neighbours differ. */
export function ghostPhase(id: number): number {
  let h = Math.imul(id | 0, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 0x100000000 * 2 * Math.PI;
}

/** A Ghost's alpha at clock `t`. `ambushT` is the seconds into the ambush wind-up, null outside it: then it blinks between 0 and the pulse. */
export function ghostAlpha(t: number, phase: number, ambushT: number | null): number {
  if (ambushT !== null && Math.floor(Math.max(0, ambushT) / GHOST_FLICKER_SECS) % 2 === 0) return 0;
  return ghostPulse(t, phase);
}

/** The pulse state of a Ghost-like figure; its alpha replaces the incorporeal one. */
export interface GhostLook {
  t: number;
  phase: number;
  ambushT: number | null;
}

export function entityAlpha(flags: number, effects: number, isParty: boolean, ghost?: GhostLook, incorporealAlpha = INCORPOREAL_ALPHA): number {
  if (ghost) return ghostAlpha(ghost.t, ghost.phase, ghost.ambushT);
  if (isParty && has(effects, EFFECT.Invisible)) return INVISIBLE_PARTY_ALPHA;
  if ((flags & FLAG.INCORPOREAL) !== 0) return incorporealAlpha;
  return 1;
}

/** Does this figure skim over terrain (no wading, sinking, splash or ripple)? A dash does; so does an incorporeal figure. */
export function skimsTerrain(flags: number, dashing: boolean): boolean {
  return dashing || (flags & FLAG.INCORPOREAL) !== 0;
}

/** Does this figure wade, splash and spray over water and lava? Incorporeal figures do not. */
export function splashes(flags: number): boolean {
  return (flags & FLAG.INCORPOREAL) === 0;
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

// What a charmed player sees (mockup B): a pink haze with a pulsing edge, "CHARMED", the caster and a bar that shrinks
// with the time left. DOM only, no art. The look is in style.css (`.charm-view`).
import { EFFECT } from '../generated/defs';
import type { Snapshot } from '../generated/Snapshot';

/** The share of the charm left (0..1, clamped); `firstLeft` is the time left when it was first seen. */
export function charmFrac(left: number, firstLeft: number): number {
  if (!(firstLeft > 0)) return 0;
  return Math.min(Math.max(left / firstLeft, 0), 1);
}

/** Seconds left of the own Charmed effect: the longest entry that is not paused (0 when none). */
export function charmLeft(effects: Snapshot['me']['effects']): number {
  let left = 0;
  for (const [k, secs, , paused] of effects) if (k === EFFECT.Charmed && !paused && secs > left) left = secs;
  return left;
}

const el = (cls: string, text?: string): HTMLElement => {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class CharmView {
  readonly root = el('charm-view');
  private by = el('charm-by');
  private fill = document.createElement('i');
  /** The time left when this charm was first seen: the full bar. */
  private first = 0;

  constructor(private host: HTMLElement) {
    this.root.hidden = true;
    const bar = el('charm-bar');
    bar.append(this.fill);
    this.root.append(el('charm-haze'), el('charm-edge'), el('charm-title', 'CHARMED'), this.by, bar);
    host.append(this.root);
  }

  /** `by` is `me.charmed_by` (null: not charmed, or the charm is paused); `left` the seconds left. */
  update(by: string | null, left: number): void {
    // The host's `charmed` class moves the messages below the title block (style.css).
    this.host.classList.toggle('charmed', by !== null);
    if (by === null) {
      this.root.hidden = true;
      this.first = 0;
      return;
    }
    this.root.hidden = false;
    if (left > this.first) this.first = left;
    this.by.textContent = `by ${by}`;
    this.fill.style.width = `${charmFrac(left, this.first) * 100}%`;
  }
}

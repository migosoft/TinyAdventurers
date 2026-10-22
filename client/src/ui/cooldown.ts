/** What one ability slot shows: the ring fill (0..1, clockwise from the top), ready state and seconds left. */
export interface SlotView {
  fill: number;
  ready: boolean;
  label: string;
}

export function slotView(cd: number, max: number): SlotView {
  if (cd <= 0) return { fill: 1, ready: true, label: '' };
  const fill = Math.min(1, Math.max(0, 1 - cd / max));
  return { fill, ready: false, label: cd.toFixed(1) };
}

/** Learns the slot's maximum cooldown from the values it sees (a new use, the Berserker speed-up). */
export class CooldownTracker {
  private max: number;
  private last = 0;

  constructor(initialMax = 1) {
    this.max = initialMax;
  }

  update(cd: number): { view: SlotView; flash: boolean } {
    if (cd > this.last + 0.01) this.max = cd;
    const wasCooling = this.last > 0;
    this.last = cd;
    const view = slotView(cd, this.max);
    return { view, flash: wasCooling && view.ready };
  }
}

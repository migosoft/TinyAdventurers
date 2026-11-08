// When the woodland's scenery has settled (#203): pure helpers, no Phaser. The soft shade of the trunks waits
// for this, so it never shows as dark wedges from trunks that are not drawn yet.

/** Tile rows nearest to `centre` first (ties: the upper row), so the ground settles around the camera. */
export function bandOrder(rows: number, centre: number): number[] {
  const c = Math.min(rows - 1, Math.max(0, Math.floor(centre)));
  return Array.from({ length: rows }, (_, i) => i).sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b);
}

export interface Win { x0: number; y0: number; x1: number; y1: number }

/** The plants that have not been drawn yet, counted per square bucket, so a window is checked by its buckets, not by every plant. */
export class PendingGrid {
  private n = new Map<number, number>();
  constructor(private size = 64) {}
  private key(bx: number, by: number): number { return (by + 1) * 8192 + bx + 1; }
  private at(x: number, y: number): number { return this.key(Math.floor(x / this.size), Math.floor(y / this.size)); }
  add(x: number, y: number): void { const k = this.at(x, y); this.n.set(k, (this.n.get(k) ?? 0) + 1); }
  remove(x: number, y: number): void {
    const k = this.at(x, y), v = (this.n.get(k) ?? 0) - 1;
    if (v > 0) this.n.set(k, v); else this.n.delete(k);
  }
  /** Is a pending plant in a bucket the window touches? (Bucket-exact on the outside: it may say yes for a plant just beyond the window.) */
  any(w: Win): boolean {
    if (this.n.size === 0) return false;
    const s = this.size;
    for (let by = Math.floor(w.y0 / s); by <= Math.floor(w.y1 / s); by++) {
      for (let bx = Math.floor(w.x0 / s); bx <= Math.floor(w.x1 / s); bx++) if (this.n.has(this.key(bx, by))) return true;
    }
    return false;
  }
}

/** The rule the shade follows: once everything is drawn (`done`) always settled; before that only while the ground is painted and the current window is complete (so a walk into undrawn trees hides the shade again). */
export function sceneSettled(done: boolean, groundDone: boolean, w: Win, stripPx: number, stripUp: (n: number) => boolean, mapH: number, pending: PendingGrid): boolean {
  return done || (groundDone && windowSettled(w, stripPx, stripUp, mapH, pending));
}

/** Is every ground strip (`stripPx` high) the window touches uploaded, and no plant pending inside the window? */
export function windowSettled(w: Win, stripPx: number, stripUp: (n: number) => boolean, mapH: number, pending: PendingGrid): boolean {
  const a = Math.max(0, Math.floor(w.y0 / stripPx)), b = Math.min(Math.ceil(mapH / stripPx) - 1, Math.floor(w.y1 / stripPx));
  for (let n = a; n <= b; n++) if (!stripUp(n)) return false;
  return !pending.any(w);
}

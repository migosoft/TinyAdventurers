// Packing and scheduling for the woodland's plants (#203). Every distinct tree is drawn once (vegetation.ts) and
// packed into a page: a canvas texture that holds many of them as frames. The packer and the scheduler are pure
// (no Phaser) so they can be tested.
import type { PlantInfo } from '../../generated/PlantInfo';

export interface Slot { page: number; x: number; y: number }

/** A shelf packer: rects go left to right on a shelf, a shelf is as tall as its tallest rect, 1 px padding all round. */
export class PlantPages {
  private slots = new Map<string, Slot>();
  private page = 0;
  private cx = 0;
  private cy = 0;
  private shelf = 0;
  constructor(private maxPage = 1024) {}

  /** The slot of `key` (packed on the first call, then the same slot). The image occupies [x, x+w) × [y, y+h) of its page. */
  add(key: string, img: { w: number; h: number }): Slot {
    const have = this.slots.get(key);
    if (have) return have;
    const bw = img.w + 2, bh = img.h + 2;
    if (bw > this.maxPage || bh > this.maxPage) throw new Error(`plant ${key} (${img.w}x${img.h}) does not fit a ${this.maxPage} px page`);
    if (this.cx + bw > this.maxPage) { this.cx = 0; this.cy += this.shelf; this.shelf = 0; }
    if (this.cy + bh > this.maxPage) { this.page++; this.cx = 0; this.cy = 0; this.shelf = 0; }
    const slot = { page: this.page, x: this.cx + 1, y: this.cy + 1 };
    this.cx += bw;
    this.shelf = Math.max(this.shelf, bh);
    this.slots.set(key, slot);
    return slot;
  }

  get pages(): number { return this.page + 1; }
}

/** The plant indices sorted by foot distance from the camera, nearest first (ties keep their order). */
export function drawOrder(plants: PlantInfo[], cam: { x: number; y: number }): number[] {
  const d = plants.map((p) => Math.hypot(p[1] - cam.x, p[2] - cam.y));
  return plants.map((_, i) => i).sort((a, b) => d[a] - d[b] || a - b);
}

/** Jobs that run in order, within `budgetMs` of them per frame (a job starts only if the slowest job so far still fits). */
export class DrawQueue {
  private jobs: (() => void)[] = [];
  private head = 0;
  private maxJob = 0;
  constructor(private budgetMs = 8, private now: () => number = () => performance.now()) {}

  push(job: () => void): void { this.jobs.push(job); }

  /** Jobs not yet run. */
  get size(): number { return this.jobs.length - this.head; }

  clear(): void { this.jobs = []; this.head = 0; }

  /** Runs jobs in order; returns how many ran. The first job always runs; each next one only when the time spent plus the slowest job seen so far fits `budget` (default: the constructor's, in ms). */
  run(budget = this.budgetMs): number {
    const t0 = this.now();
    let n = 0;
    let last = t0;
    while (this.head < this.jobs.length && (n === 0 || last - t0 + this.maxJob <= budget)) {
      this.jobs[this.head++]();
      const t = this.now();
      this.maxJob = Math.max(this.maxJob, t - last);
      last = t;
      n++;
    }
    if (this.head === this.jobs.length) this.clear();
    return n;
  }
}

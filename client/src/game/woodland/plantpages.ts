// The scheduler of the woodland's plant drawing (#203): jobs that run in order within a time budget per frame.

/** How much of the slowest job seen is remembered into the next frame. */
const JOB_DECAY = 0.5;

/** Jobs that run in order, within `budgetMs` of them per frame (a job starts only if the slowest job so far still fits). */
export class DrawQueue {
  private jobs: (() => void)[] = [];
  private head = 0;
  private maxJob = 0;
  constructor(private budgetMs = 8, private now: () => number = () => performance.now()) {}

  push(job: () => void): void { this.jobs.push(job); }

  /** Jobs not yet run. */
  get size(): number { return this.jobs.length - this.head; }

  clear(): void { this.jobs = []; this.head = 0; this.maxJob = 0; }

  /** Runs jobs in order; returns how many ran. The first job always runs; each next one only when the time spent plus the slowest job seen so far fits `budget` (default: the constructor's, in ms). */
  run(budget = this.budgetMs): number {
    this.maxJob *= JOB_DECAY; // one slow outlier (GC, JIT, a new canvas) must not pin the queue to one job per frame
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

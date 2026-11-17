/**
 * The F3 panel's frame timings (#291): the whole frame (`stepStart` to `renderEnd`), its render part (`renderStart`
 * to `renderEnd`), the client's own systems inside a display frame (booked with `lap`) and the draw calls of the last
 * frame (given to `renderEnd`). All of it runs only while the panel is open (`on`); off, `lap` returns at once, so
 * normal play pays nothing.
 *
 * Times are CPU times on the main thread: the GPU works asynchronously, so its own cost shows only where the CPU
 * waits for it (a readback, a texture upload).
 */

/** An exponential average with the weight `frameMs` uses. */
const ease = (avg: number, v: number): number => avg * 0.9 + v * 0.1;

export class FrameTimer<S extends string> {
  /** Whole frame, ms (averaged). */
  frameMs = 0;
  /** The render part of the frame, ms (averaged). */
  renderMs = 0;
  /** WebGL draw calls of the last frame. */
  drawCalls = 0;
  /** Per system, ms (averaged). */
  readonly systems: Record<S, number>;

  private active = false;
  /** Whether the averages hold a frame yet: the first frame after switching on seeds them instead of easing from 0. */
  private seeded = false;
  private stepT0 = -1;
  private renderT0 = -1;
  private lapT = 0;
  private cur: Record<S, number>;

  /** `names` are the systems `lap` may book to, in the order the panel lists them. */
  constructor(
    private readonly names: readonly S[],
    private readonly now: () => number = () => performance.now(),
  ) {
    this.systems = Object.fromEntries(names.map((s) => [s, 0])) as Record<S, number>;
    this.cur = Object.fromEntries(names.map((s) => [s, 0])) as Record<S, number>;
  }

  get on(): boolean {
    return this.active;
  }

  /** Switches the timings with the panel. */
  set on(v: boolean) {
    if (v === this.active) return;
    this.active = v;
    this.seeded = false;
    this.stepT0 = -1;
    this.renderT0 = -1;
    if (!v) this.drawCalls = 0;
  }

  stepStart(): void {
    if (!this.active) return;
    this.stepT0 = this.now();
    for (const s of this.names) this.cur[s] = 0;
  }

  renderStart(): void {
    if (this.active) this.renderT0 = this.now();
  }

  /** The frame's end: folds the frame, the render and the systems into the averages. */
  renderEnd(drawCalls?: number): void {
    if (!this.active) return;
    const t = this.now();
    // only a frame that ran from its start: the one in which the panel opened has no systems yet
    if (this.stepT0 >= 0 && this.renderT0 >= 0) {
      const fold = this.seeded ? ease : (_: number, v: number) => v;
      this.frameMs = fold(this.frameMs, t - this.stepT0);
      this.renderMs = fold(this.renderMs, t - this.renderT0);
      for (const s of this.names) this.systems[s] = fold(this.systems[s], this.cur[s]);
      this.seeded = true;
    }
    this.drawCalls = drawCalls ?? 0;
    this.stepT0 = -1;
    this.renderT0 = -1;
  }

  /** Starts the laps of a display frame (`RunSession.frame`). */
  begin(): void {
    if (this.active) this.lapT = this.now();
  }

  /** Books the time since the last lap (or `begin`) to `system`. */
  lap(system: S): void {
    if (!this.active) return;
    const t = this.now();
    this.cur[system] += t - this.lapT;
    this.lapT = t;
  }
}

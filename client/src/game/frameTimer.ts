/**
 * The F3 panel's frame timings (#291): the whole frame (Phaser's step from `PRE_STEP` to `POST_RENDER`), its render
 * part (`PRE_RENDER` to `POST_RENDER`), the client's own systems inside a display frame (`RunSession.frame` and `PhaserRunView.frame`), and the WebGL draw calls
 * of the last frame. All of it runs only while the panel is open (`on`); off, `lap` returns at once and the draw
 * calls are not counted, so normal play pays nothing.
 *
 * Times are CPU times on the main thread: the GPU works asynchronously, so its own cost shows only where the CPU
 * waits for it (a readback, a texture upload).
 */

/** The systems of a display frame (`RunSession.frame`, then `PhaserRunView.frame`), in the order they run and the panel lists them. */
export const SYSTEMS = ['sim', 'light', 'mood', 'mask', 'figures', 'woodland', 'effects', 'hud'] as const;
export type System = (typeof SYSTEMS)[number];

/** The part of a WebGL context the draw-call counter wraps. */
export interface DrawGl {
  drawArrays(...a: never[]): void;
  drawElements(...a: never[]): void;
}

/** What `attach` listens to: Phaser's `game.events`. */
export interface StepEvents {
  on(event: string, fn: () => void): unknown;
  off(event: string, fn: () => void): unknown;
}

/** An exponential average with the weight `frameMs` uses. */
const ease = (avg: number, v: number): number => avg * 0.9 + v * 0.1;

export class FrameTimer<S extends string = System> {
  /** Whole frame, ms (averaged). */
  frameMs = 0;
  /** The render part of the frame, ms (averaged). */
  renderMs = 0;
  /** WebGL draw calls of the last frame. */
  drawCalls = 0;
  /** Per system, ms (averaged). */
  readonly systems: Record<S, number>;

  private active = false;
  private gl: DrawGl | null = null;
  private restore: (() => void) | null = null;
  private calls = 0;
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

  /** Switches the timings with the panel; the draw-call counter is wrapped around the context only while on. */
  set on(v: boolean) {
    if (v === this.active) return;
    this.active = v;
    this.seeded = false;
    this.stepT0 = -1;
    this.renderT0 = -1;
    if (v) this.wrap();
    else this.unwrap();
  }

  /** Listens to the game's step events (and counts draw calls on `gl`, if given); returns the detach. */
  attach(events: StepEvents, gl: DrawGl | null): () => void {
    this.gl = gl;
    if (this.active) this.wrap();
    const step = (): void => this.stepStart();
    const pre = (): void => this.renderStart();
    const post = (): void => this.renderEnd();
    events.on('prestep', step);
    events.on('prerender', pre);
    events.on('postrender', post);
    return () => {
      events.off('prestep', step);
      events.off('prerender', pre);
      events.off('postrender', post);
      this.unwrap();
      this.gl = null;
    };
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
    this.drawCalls = drawCalls ?? this.calls;
    this.calls = 0;
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

  private wrap(): void {
    const gl = this.gl;
    if (!gl || this.restore) return;
    const arrays = gl.drawArrays;
    const elements = gl.drawElements;
    gl.drawArrays = (...a: never[]) => {
      this.calls++;
      arrays.apply(gl, a);
    };
    gl.drawElements = (...a: never[]) => {
      this.calls++;
      elements.apply(gl, a);
    };
    this.restore = () => {
      gl.drawArrays = arrays;
      gl.drawElements = elements;
    };
  }

  private unwrap(): void {
    this.restore?.();
    this.restore = null;
    this.calls = 0;
    this.drawCalls = 0;
  }
}

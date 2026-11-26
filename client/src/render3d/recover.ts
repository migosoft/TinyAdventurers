// Recovery after a lost graphics device: one rebuild at a time, retried every second until it succeeds. The tries are
// bounded (#313): MAX_FAILURES losses or failed rebuilds within WINDOW_MS switch to WebGL2, and the same on WebGL2 gives up.

export const MAX_FAILURES = 3;
export const WINDOW_MS = 60_000;

export interface Recovery {
  /** A loss happened: starts a rebuild, or, while one runs, remembers to run one more after it. */
  lost(): void;
  readonly busy: boolean;
  /** The bound was hit on WebGL2: no more rebuilds. */
  readonly gaveUp: boolean;
}

export interface RecoveryOpts {
  /** Start on WebGL2 (the URL forced it). */
  webgl?: boolean;
  now?: () => number;
  /** The bound was hit on WebGPU: from now on the rebuilds ask for WebGL2. */
  onFallback?: (reason: string) => void;
  /** The bound was hit on WebGL2: nothing is rebuilt any more. */
  onGiveUp?: (reason: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** `onError` hears every failed attempt (default: a console warning), so a page stuck on "restoring" shows why. */
export function createRecovery(
  rebuild: (forceWebGL: boolean) => Promise<void>,
  wait: (ms: number) => Promise<void> = sleep,
  onError: (e: unknown) => void = (e) => console.warn('Rebuilding the graphics view failed, retrying:', e),
  opts: RecoveryOpts = {},
): Recovery {
  const now = opts.now ?? Date.now;
  let webgl = opts.webgl ?? false;
  let gaveUp = false;
  let failures: number[] = [];
  let busy = false;
  // A loss that arrived while a rebuild ran may belong to the view it just built: one more rebuild follows.
  let again = false;

  /** Counts a loss or a failed rebuild; true when the bound is hit on WebGL2 and the recovery ends. */
  function note(reason: string): boolean {
    const t = now();
    failures = failures.filter((f) => t - f < WINDOW_MS);
    failures.push(t);
    if (failures.length < MAX_FAILURES) return false;
    failures = [];
    if (!webgl) {
      webgl = true;
      console.warn(`The graphics device keeps failing (${reason}); switching to the WebGL2 fallback.`);
      opts.onFallback?.(reason);
      return false;
    }
    gaveUp = true;
    opts.onGiveUp?.(reason);
    return true;
  }

  async function run(): Promise<void> {
    busy = true;
    try {
      for (;;) {
        again = false;
        try {
          await rebuild(webgl);
        } catch (e) {
          onError(e);
          if (note(`rebuild failed: ${String(e)}`)) break;
          await wait(1000);
          continue;
        }
        if (!again || gaveUp) break;
      }
    } finally {
      busy = false;
    }
  }

  return {
    lost() {
      if (gaveUp || note('device lost')) return;
      if (busy) again = true;
      else void run();
    },
    get busy() {
      return busy;
    },
    get gaveUp() {
      return gaveUp;
    },
  };
}

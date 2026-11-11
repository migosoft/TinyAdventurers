// Recovery after a lost graphics device: one rebuild at a time, retried every second until it succeeds.

export interface Recovery {
  /** A loss happened: starts a rebuild, or, while one runs, remembers to run one more after it. */
  lost(): void;
  readonly busy: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createRecovery(rebuild: () => Promise<void>, wait: (ms: number) => Promise<void> = sleep): Recovery {
  let busy = false;
  // A loss that arrived while a rebuild ran may belong to the view it just built: one more rebuild follows.
  let again = false;

  async function run(): Promise<void> {
    busy = true;
    try {
      for (;;) {
        again = false;
        try {
          await rebuild();
        } catch {
          await wait(1000);
          continue;
        }
        if (!again) break;
      }
    } finally {
      busy = false;
    }
  }

  return {
    lost() {
      if (busy) again = true;
      else void run();
    },
    get busy() {
      return busy;
    },
  };
}

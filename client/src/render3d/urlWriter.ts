// Writes the address bar on a trailing timer: browsers throttle history.replaceState (Chrome drops calls past 200 in
// 10 s, Safari throws past 100 in 30 s), and a slider fires many input events a second. The last value always lands.

/** Returns a function that stores the latest value and calls `write` with it once, `delayMs` after the last call. */
export function trailingWriter(
  write: (value: string) => void,
  delayMs = 200,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): ((value: string) => void) & { cancel(): void } {
  let pending: unknown = null;
  let latest = '';
  const put = (value: string): void => {
    latest = value;
    if (pending !== null) timers.clear(pending);
    pending = timers.set(() => {
      pending = null;
      write(latest);
    }, delayMs);
  };
  /** Drops a write that has not happened yet. */
  const cancel = (): void => {
    if (pending !== null) timers.clear(pending);
    pending = null;
  };
  return Object.assign(put, { cancel });
}

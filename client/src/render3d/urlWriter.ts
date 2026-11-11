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
): (value: string) => void {
  let pending: unknown = null;
  let latest = '';
  return (value) => {
    latest = value;
    if (pending !== null) timers.clear(pending);
    pending = timers.set(() => {
      pending = null;
      write(latest);
    }, delayMs);
  };
}

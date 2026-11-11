import { describe, expect, it } from 'vitest';
import { createRecovery } from './recover';

/** A rebuild the test settles by hand; each call gets its own promise. */
function controllable() {
  const pending: { resolve: () => void; reject: (e: Error) => void }[] = [];
  const rebuild = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  return { rebuild, pending };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('recovery', () => {
  it('runs the rebuild once and starts nothing else while it is pending', async () => {
    const c = controllable();
    const r = createRecovery(c.rebuild, async () => {});
    expect(r.busy).toBe(false);
    r.lost();
    expect(c.pending.length).toBe(1);
    expect(r.busy).toBe(true);
    r.lost();
    r.lost();
    await flush();
    expect(c.pending.length).toBe(1); // nothing starts while one is pending
    c.pending[0].resolve();
    await flush();
    // The two losses during the rebuild are remembered: exactly one more rebuild follows.
    expect(c.pending.length).toBe(2);
    expect(r.busy).toBe(true);
    c.pending[1].resolve();
    await flush();
    expect(c.pending.length).toBe(2);
    expect(r.busy).toBe(false);
    r.lost(); // a new loss after it is done runs it again
    expect(c.pending.length).toBe(3);
  });

  it('a loss while idle then a settled rebuild leaves it idle', async () => {
    const c = controllable();
    const r = createRecovery(c.rebuild, async () => {});
    r.lost();
    c.pending[0].resolve();
    await flush();
    expect(r.busy).toBe(false);
    expect(c.pending.length).toBe(1);
  });

  it('a rebuild that rejects twice is called three times with wait(1000) between, busy until the third resolves', async () => {
    const c = controllable();
    const waits: number[] = [];
    const r = createRecovery(c.rebuild, async (ms) => {
      waits.push(ms);
    });
    r.lost();
    c.pending[0].reject(new Error('one'));
    await flush();
    expect(waits).toEqual([1000]);
    expect(c.pending.length).toBe(2);
    expect(r.busy).toBe(true);
    c.pending[1].reject(new Error('two'));
    await flush();
    expect(waits).toEqual([1000, 1000]);
    expect(c.pending.length).toBe(3);
    expect(r.busy).toBe(true);
    c.pending[2].resolve();
    await flush();
    expect(r.busy).toBe(false);
    expect(c.pending.length).toBe(3);
  });

  it('a loss during a retry wait is covered by the retry itself (it builds a view after the loss)', async () => {
    const c = controllable();
    let release!: () => void;
    const r = createRecovery(c.rebuild, () => new Promise<void>((res) => { release = res; }));
    r.lost();
    c.pending[0].reject(new Error('x'));
    await flush();
    r.lost(); // while waiting to retry
    release();
    await flush();
    expect(c.pending.length).toBe(2);
    c.pending[1].resolve();
    await flush();
    expect(c.pending.length).toBe(2);
    expect(r.busy).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { createRecovery, MAX_FAILURES, WINDOW_MS } from './recover';

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

  it('onError hears each failed attempt once, with its error', async () => {
    const c = controllable();
    const heard: unknown[] = [];
    const r = createRecovery(c.rebuild, async () => {}, (e) => heard.push(e));
    r.lost();
    const e1 = new Error('one');
    const e2 = new Error('two');
    c.pending[0].reject(e1);
    await flush();
    c.pending[1].reject(e2);
    await flush();
    c.pending[2].resolve();
    await flush();
    expect(heard).toEqual([e1, e2]);
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

describe('bounded recovery (#313)', () => {
  /** A rebuild that always works and records which backend it was asked for. */
  function recorder() {
    const asked: boolean[] = [];
    return { asked, rebuild: async (webgl: boolean): Promise<void> => { asked.push(webgl); } };
  }
  const setup = (webgl = false) => {
    const rec = recorder();
    const events: string[] = [];
    let t = 0;
    const r = createRecovery(rec.rebuild, async () => {}, () => {}, {
      webgl, now: () => t,
      onFallback: () => events.push('fallback'),
      onGiveUp: () => events.push('giveup'),
    });
    return { rec, events, r, at: (ms: number) => { t = ms; } };
  };

  it('single losses, far apart, rebuild on the same backend', async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) {
      s.at(i * (WINDOW_MS + 1));
      s.r.lost();
      await flush();
    }
    expect(s.rec.asked).toEqual([false, false, false, false, false]);
    expect(s.events).toEqual([]);
  });

  it('repeated losses switch to WebGL2, and the next rebuild asks for it', async () => {
    const s = setup();
    for (let i = 0; i < MAX_FAILURES; i++) {
      s.at(i * 1000);
      s.r.lost();
      await flush();
    }
    expect(s.events).toEqual(['fallback']);
    expect(s.rec.asked).toEqual([false, false, true]);
    expect(s.r.gaveUp).toBe(false);
  });

  it('losses on WebGL2 that exhaust the bound stop the recovery with an error', async () => {
    const s = setup(true);
    for (let i = 0; i < MAX_FAILURES + 2; i++) {
      s.at(i * 1000);
      s.r.lost();
      await flush();
    }
    expect(s.events).toEqual(['giveup']);
    expect(s.rec.asked).toEqual([true, true]); // the third loss gave up before rebuilding; later ones do nothing
    expect(s.r.gaveUp).toBe(true);
    expect(s.r.busy).toBe(false);
  });

  it('failed rebuilds count too: WebGPU, then WebGL2, then the end', async () => {
    const asked: boolean[] = [];
    const events: string[] = [];
    const r = createRecovery(async (webgl) => { asked.push(webgl); throw new Error('no'); }, async () => {}, () => {}, {
      now: () => 0,
      onFallback: () => events.push('fallback'),
      onGiveUp: () => events.push('giveup'),
    });
    r.lost(); // the loss itself is the first failure
    await flush();
    expect(asked).toEqual([false, false, true, true, true]);
    expect(events).toEqual(['fallback', 'giveup']);
    expect(r.busy).toBe(false);
  });
});

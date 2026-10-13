import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelayLine } from './net';

describe('DelayLine (?lag simulator)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('delivers in order even when the browser rounds timer delays down', () => {
    // A timer like the browser's: fractional delays are cut to whole milliseconds.
    let clock = 0;
    const timers: { at: number; seq: number; fn: () => void }[] = [];
    let seq = 0;
    vi.stubGlobal('setTimeout', (fn: () => void, ms: number) => {
      timers.push({ at: clock + Math.floor(ms), seq: seq++, fn });
      return seq;
    });
    const got: number[] = [];
    const line = new DelayLine<number>({ lag: 150, jitter: 40, loss: 2 }, (v) => got.push(v), () => clock);
    for (let i = 0; i < 2000; i++) {
      line.push(i);
      clock += 0.37 + (i % 7) * 0.31; // messages a fraction of a millisecond apart
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
        if (!timers.length || timers[0].at > clock) break;
        timers.shift()!.fn();
      }
    }
    clock += 1000;
    while (timers.length) timers.shift()!.fn();
    expect(got).toEqual([...Array(2000).keys()]);
  });
});

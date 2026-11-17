import { describe, expect, it } from 'vitest';
import { DrawQueue } from './plantpages';

describe('DrawQueue', () => {
  it('stops at its budget', () => {
    let clock = 0;
    const q = new DrawQueue(8, () => clock);
    let done = 0;
    for (let i = 0; i < 10; i++) q.push(() => { clock += 3; done++; });
    // 3 ms jobs, budget 8: a third job would end at 9 ms, so two run
    expect(q.run()).toBe(2);
    expect(done).toBe(2);
    expect(q.size).toBe(8);
    while (q.size > 0) expect(q.run()).toBeLessThanOrEqual(2);
    expect(done).toBe(10);
    expect(q.run()).toBe(0);
  });

  it('jobs of varying cost never push a frame past the budget (beyond its first job)', () => {
    let clock = 0;
    const q = new DrawQueue(8, () => clock);
    const costs = [1, 4, 2, 3, 1, 5, 2, 2, 4, 1, 3, 3, 2, 1, 4, 2];
    for (let r = 0; r < 4; r++) for (const c of costs) q.push(() => { clock += c; });
    while (q.size > 0) {
      const t0 = clock;
      q.run();
      // the slowest job is 5 ms; after the warm-up (it is seen once) a frame is at most budget, plus its first job
      expect(clock - t0).toBeLessThanOrEqual(8 + 5);
    }
    // once every cost has been seen, frames stay within the budget outright
    for (const c of costs) q.push(() => { clock += c; });
    for (const c of costs) q.push(() => { clock += c; });
    while (q.size > 0) { const t0 = clock; q.run(); expect(clock - t0).toBeLessThanOrEqual(8); }
  });

  it('one slow outlier does not pin the queue to one job per frame', () => {
    let clock = 0;
    const q = new DrawQueue(8, () => clock);
    q.push(() => { clock += 20; });
    for (let i = 0; i < 60; i++) q.push(() => { clock += 1; });
    q.run();
    const per: number[] = [];
    for (let f = 0; f < 4; f++) per.push(q.run());
    expect(per[3]).toBeGreaterThanOrEqual(4);
    expect(per[0]).toBeLessThan(per[3]);
  });

  it('clear forgets the slowest job', () => {
    let clock = 0;
    const q = new DrawQueue(8, () => clock);
    q.push(() => { clock += 20; });
    q.run();
    q.clear();
    for (let i = 0; i < 20; i++) q.push(() => { clock += 1; });
    expect(q.run()).toBeGreaterThan(4);
  });

  it('run(budget) overrides the budget but always runs one job', () => {
    let clock = 0;
    const q = new DrawQueue(8, () => clock);
    for (let i = 0; i < 5; i++) q.push(() => { clock += 3; });
    expect(q.run(0)).toBe(1);
    expect(q.run(7)).toBe(2); // 3 + 3 fits 7
  });
});

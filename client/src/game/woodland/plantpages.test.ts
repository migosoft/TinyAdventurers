import { describe, expect, it } from 'vitest';
import type { PlantInfo } from '../../generated/PlantInfo';
import { drawPlant } from '../vegetation';
import { DrawQueue, drawOrder, PlantPages } from './plantpages';

describe('PlantPages', () => {
  it('the default page holds the largest plants, one per slot, inside the page', () => {
    const pages = new PlantPages();
    const big = [drawPlant('wide', 1, 120), drawPlant('round', 2, 120), drawPlant('tall', 3, 120), drawPlant('conifer', 4, 120), drawPlant('bush', 5, 150)];
    for (const [i, d] of big.entries()) {
      expect(d.img.w).toBeLessThanOrEqual(200);
      expect(d.img.h).toBeLessThanOrEqual(200);
      const s = pages.add(`b${i}`, d.img);
      expect(s.x + d.img.w).toBeLessThanOrEqual(1024);
      expect(s.y + d.img.h).toBeLessThanOrEqual(1024);
    }
  });

  it('packs without overlap', () => {
    let s = 12345;
    const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
    const pages = new PlantPages(512);
    const placed: { page: number; x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < 200; i++) {
      const w = 8 + Math.floor(rnd() * 90), h = 8 + Math.floor(rnd() * 110);
      const slot = pages.add(`k${i}`, { w, h });
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.y).toBeGreaterThanOrEqual(0);
      expect(slot.x + w).toBeLessThanOrEqual(512);
      expect(slot.y + h).toBeLessThanOrEqual(512);
      placed.push({ ...slot, w, h });
    }
    expect(pages.pages).toBeGreaterThan(1);
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) {
      const p = placed[a], q = placed[b];
      if (p.page !== q.page) continue;
      const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
      expect(apart, `rects ${a} and ${b}`).toBe(true);
    }
  });

  it('same key packs once', () => {
    const pages = new PlantPages(256);
    const a = pages.add('t', { w: 40, h: 50 });
    const b = pages.add('u', { w: 40, h: 50 });
    expect(pages.add('t', { w: 40, h: 50 })).toBe(a);
    expect(pages.add('u', { w: 99, h: 99 })).toBe(b);
    expect(b).not.toEqual(a);
  });
});

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

  it('run(budget) overrides the budget but always runs one job', () => {
    let clock = 0;
    const q = new DrawQueue(8, () => clock);
    for (let i = 0; i < 5; i++) q.push(() => { clock += 3; });
    expect(q.run(0)).toBe(1);
    expect(q.run(7)).toBe(2); // 3 + 3 fits 7
  });
});

describe('drawOrder', () => {
  it('nearest first', () => {
    const p = (x: number, y: number): PlantInfo => [0, x, y, 1, 100, false];
    const plants = [p(500, 0), p(10, 10), p(100, 0), p(0, 0)];
    expect(drawOrder(plants, { x: 0, y: 0 })).toEqual([3, 1, 2, 0]);
    expect(drawOrder(plants, { x: 500, y: 0 })).toEqual([0, 2, 1, 3]);
  });
});

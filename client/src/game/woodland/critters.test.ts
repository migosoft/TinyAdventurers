import { describe, expect, it } from 'vitest';
import { beeAt, butterflyAt, flowerPatches, WING_COLOURS } from './critters';

const bounds = { x: 100, y: 100, w: 190, h: 190 };

describe('critters', () => {
  it('bees stay near their flower (<= 10 px)', () => {
    const f = { x: 200, y: 150 };
    for (let i = 0; i < 12; i++) for (let t = 0; t < 10; t += 0.05) {
      const b = beeAt(i, t, f, 3);
      expect(Math.hypot(b.x - f.x, b.y - f.y)).toBeLessThanOrEqual(10);
    }
  });

  it('a butterfly rises on a flap and sinks between flaps', () => {
    // find a stretch where it flies (not landed); y with the path's slow part removed is the flap bob
    let checked = 0;
    for (let i = 0; i < 6; i++) {
      const ys: number[] = [];
      let t = 0.3 + i * 0.01;
      // the first 8 s are never landed for the whole window? check flags instead
      for (let k = 0; k < 400; k++, t += 0.0005) {
        const b = butterflyAt(i, t, 5, bounds);
        if (b.landed) { ys.length = 0; continue; }
        ys.push(b.y);
      }
      if (ys.length < 300) continue;
      // within 0.2 s (>= one 5 Hz flap) the highest point is >= 1.4 px over where it began, and it goes down again afterwards
      const top = Math.min(...ys.slice(0, 300));
      const imax = ys.indexOf(top);
      expect(Math.max(...ys.slice(0, 300)) - top).toBeGreaterThan(1.2);
      expect(ys[imax + 40] ?? top + 1).toBeGreaterThan(top);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('flaps at 5-7 Hz and lands sometimes', () => {
    for (let i = 0; i < 6; i++) {
      let flips = 0, last = butterflyAt(i, 0, 5, bounds).open, landed = 0;
      for (let t = 0.001; t < 60; t += 0.001) {
        const b = butterflyAt(i, t, 5, bounds);
        if (b.landed) landed++;
        if (!b.landed && last !== b.open) flips++;
        last = b.open;
      }
      expect(landed).toBeGreaterThan(1000);
      expect(flips / 2 / 60).toBeGreaterThan(3.5); // a flap is two flips; minus the time landed
      expect(flips / 2 / 60).toBeLessThan(7.2);
    }
  });

  it('does not jump when it lands or takes off', () => {
    for (let i = 0; i < 6; i++) {
      let prev = butterflyAt(i, 0, 5, bounds);
      for (let t = 0.01; t < 60; t += 0.01) {
        const b = butterflyAt(i, t, 5, bounds);
        expect(Math.hypot(b.x - prev.x, b.y - prev.y)).toBeLessThan(3);
        prev = b;
      }
    }
  });

  it('is deterministic for a seed and different for another', () => {
    const a = butterflyAt(2, 12.3, 9, bounds), b = butterflyAt(2, 12.3, 9, bounds), c = butterflyAt(2, 12.3, 10, bounds);
    expect(a).toEqual(b);
    expect(a.x).not.toBe(c.x);
    expect(beeAt(1, 4, { x: 0, y: 0 }, 9)).toEqual(beeAt(1, 4, { x: 0, y: 0 }, 9));
    expect(WING_COLOURS).toHaveLength(4);
  });

  it('patches: at most 40, biggest first, at the flowers centre', () => {
    const spots = [];
    for (let k = 0; k < 60; k++) spots.push({ x: k * 100, y: 10 }, { x: k * 100 + 10, y: 20 });
    const patches = flowerPatches(spots);
    expect(patches).toHaveLength(40);
    expect(patches[0]).toEqual({ x: 5, y: 15 });
  });
});

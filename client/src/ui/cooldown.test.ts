import { describe, expect, it } from 'vitest';
import { CooldownTracker, slotView } from './cooldown';

describe('slotView', () => {
  it('is full and ready when not cooling', () => expect(slotView(0, 5)).toEqual({ fill: 1, ready: true, label: '' }));
  it('fills clockwise as the cooldown runs out', () =>
    expect(slotView(3.2, 5)).toEqual({ fill: expect.closeTo(0.36, 5), ready: false, label: '3.2' }));
  it('never goes past empty or full', () => {
    expect(slotView(9, 5).fill).toBe(0);
    expect(slotView(0.0001, 5).fill).toBeLessThanOrEqual(1);
  });
});

describe('CooldownTracker', () => {
  it('re-learns the maximum when the cooldown jumps up (new use, Berserker)', () => {
    const t = new CooldownTracker();
    t.update(4);
    expect(t.update(3).view.fill).toBeCloseTo(0.25);
    expect(t.update(2).view.fill).toBeCloseTo(0.5);
  });
  it('flashes once when the ring closes, not at the start', () => {
    const t = new CooldownTracker();
    expect(t.update(0).flash).toBe(false);
    t.update(1);
    expect(t.update(0).flash).toBe(true);
    expect(t.update(0).flash).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { MoverTracker } from './airmovers';

vi.mock('phaser', () => ({ default: {} }));

const DT = 1 / 60;

describe('MoverTracker', () => {
  it('first sight pushes nothing', () => {
    const t = new MoverTracker();
    t.begin(DT);
    expect(t.track(1, 10, 10, 6, false, 0)).toBeNull();
  });

  it('a walk gives its velocity', () => {
    const t = new MoverTracker();
    t.begin(DT);
    t.track(1, 10, 10, 6, false, 0);
    t.begin(DT);
    const m = t.track(1, 11, 10, 6, false, 0);
    expect(m).not.toBeNull();
    expect(m!.vx).toBeCloseTo(60);
    expect(m!.vy).toBeCloseTo(0);
    expect(m!.r).toBe(6);
    expect(m!.shot).toBe(false);
  });

  it('a jump of 60 px pushes nothing', () => {
    const t = new MoverTracker();
    t.begin(DT);
    t.track(1, 10, 10, 6, false, 0);
    t.begin(DT);
    expect(t.track(1, 70, 10, 6, false, 0)).toBeNull();
  });

  it('standing still pushes nothing', () => {
    const t = new MoverTracker();
    t.begin(DT);
    t.track(1, 10, 10, 6, false, 0);
    t.begin(DT);
    expect(t.track(1, 10, 10, 6, false, 0)).toBeNull();
  });

  it('a forgotten id starts again', () => {
    const t = new MoverTracker();
    t.begin(DT);
    t.track(1, 10, 10, 6, false, 0);
    t.begin(DT);
    t.begin(DT);
    expect(t.track(1, 11, 10, 6, false, 0)).toBeNull();
  });

  it('clamps speed to 400 px/s and passes shot and heat on', () => {
    const t = new MoverTracker();
    t.begin(0.05);
    t.track(-5, 0, 0, 3, true, 1);
    t.begin(0.05);
    const m = t.track(-5, 24, 32, 3, true, 1)!; // 40 px in 0.05 s = 800 px/s
    expect(Math.hypot(m.vx, m.vy)).toBeCloseTo(400);
    expect(m.vx / m.vy).toBeCloseTo(0.75);
    expect(m.shot).toBe(true);
    expect(m.heat).toBe(1);
  });
});

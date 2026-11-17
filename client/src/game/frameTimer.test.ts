import { describe, expect, it } from 'vitest';
import { FrameTimer } from './frameTimer';

const SYSTEMS = ['sim', 'light', 'mask'] as const;

function setup() {
  let t = 0;
  const timer = new FrameTimer(SYSTEMS, () => t);
  return { timer, at: (v: number) => (t = v) };
}

/** One frame: step 0..`upd` with laps, render `upd`..`end`, `draws` draw calls. */
function frame(s: ReturnType<typeof setup>, base: number, draws: number) {
  s.at(base);
  s.timer.stepStart();
  s.timer.begin();
  s.at(base + 1);
  s.timer.lap('sim');
  s.at(base + 3);
  s.timer.lap('light');
  s.at(base + 4);
  s.timer.renderStart();
  s.at(base + 10);
  s.timer.renderEnd(draws);
}

describe('FrameTimer', () => {
  it('does nothing while off: no laps, no counted draws', () => {
    const s = setup();
    frame(s, 0, 5);
    expect(s.timer.frameMs).toBe(0);
    expect(s.timer.systems.light).toBe(0);
    expect(s.timer.drawCalls).toBe(0);
  });

  it('averages the whole frame, the render and each system, and takes the draws of the last frame', () => {
    const s = setup();
    s.timer.on = true;
    frame(s, 0, 7);
    // the first frame seeds the averages
    expect(s.timer.frameMs).toBe(10);
    expect(s.timer.renderMs).toBe(6);
    expect(s.timer.systems.sim).toBe(1);
    expect(s.timer.systems.light).toBe(2);
    expect(s.timer.systems.mask).toBe(0);
    expect(s.timer.drawCalls).toBe(7);
    s.at(150); // a longer frame eases in
    s.timer.stepStart();
    s.at(170);
    s.timer.renderStart();
    s.at(180);
    s.timer.renderEnd(3);
    expect(s.timer.frameMs).toBeCloseTo(12); // 0.9 * 10 + 0.1 * 30
    expect(s.timer.renderMs).toBeCloseTo(6.4); // 0.9 * 6 + 0.1 * 10
    expect(s.timer.systems.light).toBeCloseTo(1.8); // no laps this frame
    expect(s.timer.drawCalls).toBe(3);
  });

  it('a frame that opened the panel mid-step books no systems', () => {
    const s = setup();
    s.at(0);
    s.timer.stepStart();
    s.timer.on = true;
    s.timer.begin();
    s.at(5);
    s.timer.lap('light');
    s.timer.renderStart();
    s.timer.renderEnd();
    expect(s.timer.frameMs).toBe(0);
    expect(s.timer.systems.light).toBe(0);
  });

  it('takes its system names from the caller', () => {
    let t = 0;
    const timer = new FrameTimer(['a', 'b'], () => t);
    timer.on = true;
    timer.stepStart();
    timer.begin();
    t = 2;
    timer.lap('a');
    t = 5;
    timer.lap('b');
    timer.renderStart();
    timer.renderEnd();
    expect(Object.keys(timer.systems)).toEqual(['a', 'b']);
    expect(timer.systems).toEqual({ a: 2, b: 3 });
  });

  it('renderEnd(n) sets the draw calls without any context', () => {
    const timer = new FrameTimer(['a'], () => 0);
    timer.on = true;
    timer.stepStart();
    timer.renderStart();
    timer.renderEnd(42);
    expect(timer.drawCalls).toBe(42);
  });

  it('switching off clears the draw calls', () => {
    const timer = new FrameTimer(['a'], () => 0);
    timer.on = true;
    timer.stepStart();
    timer.renderStart();
    timer.renderEnd(42);
    timer.on = false;
    expect(timer.drawCalls).toBe(0);
  });
});

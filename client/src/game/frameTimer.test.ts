import { describe, expect, it } from 'vitest';
import { FrameTimer, type StepEvents } from './frameTimer';

function setup() {
  let t = 0;
  const timer = new FrameTimer(() => t);
  const handlers = new Map<string, () => void>();
  const events: StepEvents = {
    on: (e, fn) => handlers.set(e, fn),
    off: (e) => handlers.delete(e),
  };
  let drawn = 0;
  const gl = { drawArrays: () => void drawn++, drawElements: () => void drawn++ };
  const detach = timer.attach(events, gl);
  const emit = (e: string) => handlers.get(e)!();
  return { timer, gl, handlers, detach, emit, at: (v: number) => (t = v), drawn: () => drawn };
}

/** One frame: step 0..`upd` with laps, render `upd`..`end`, `draws` draw calls. */
function frame(s: ReturnType<typeof setup>, base: number, draws: number) {
  s.at(base);
  s.emit('prestep');
  s.timer.begin();
  s.at(base + 1);
  s.timer.lap('sim');
  s.at(base + 3);
  s.timer.lap('light');
  s.at(base + 4);
  s.emit('prerender');
  for (let i = 0; i < draws; i++) s.gl.drawElements();
  s.at(base + 10);
  s.emit('postrender');
}

describe('FrameTimer', () => {
  it('does nothing while off: no laps, no counted draws', () => {
    const s = setup();
    frame(s, 0, 5);
    expect(s.timer.frameMs).toBe(0);
    expect(s.timer.systems.light).toBe(0);
    expect(s.timer.drawCalls).toBe(0);
    expect(s.drawn()).toBe(5);
  });

  it('averages the whole frame, the render, each system and counts the draws of the last frame', () => {
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
    expect(s.drawn()).toBe(7);
    s.at(150); // a longer frame eases in
    s.emit('prestep');
    s.at(170);
    s.emit('prerender');
    for (let i = 0; i < 3; i++) s.gl.drawArrays();
    s.at(180);
    s.emit('postrender');
    expect(s.timer.frameMs).toBeCloseTo(12); // 0.9 * 10 + 0.1 * 30
    expect(s.timer.renderMs).toBeCloseTo(6.4); // 0.9 * 6 + 0.1 * 10
    expect(s.timer.systems.light).toBeCloseTo(1.8); // no laps this frame
    expect(s.timer.drawCalls).toBe(3);
  });

  it('a frame that opened the panel mid-step books no systems', () => {
    const s = setup();
    s.at(0);
    s.emit('prestep');
    s.timer.on = true;
    s.timer.begin();
    s.at(5);
    s.timer.lap('light');
    s.emit('prerender');
    s.emit('postrender');
    expect(s.timer.frameMs).toBe(0);
    expect(s.timer.systems.light).toBe(0);
  });

  it('restores the context when switched off and when detached', () => {
    const s = setup();
    const { drawArrays, drawElements } = s.gl;
    s.timer.on = true;
    expect(s.gl.drawElements).not.toBe(drawElements);
    s.timer.on = false;
    expect(s.gl.drawArrays).toBe(drawArrays);
    expect(s.gl.drawElements).toBe(drawElements);
    s.timer.on = true;
    s.detach();
    expect(s.gl.drawElements).toBe(drawElements);
    expect(s.handlers.size).toBe(0);
  });
});

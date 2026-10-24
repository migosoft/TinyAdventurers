import { describe, expect, it } from 'vitest';
import { Wind } from './wind';

const view = { x: 0, y: 0, width: 320, height: 240 };

function make(solid: (px: number, py: number) => boolean = () => false, draft = false): Wind {
  const w = new Wind(solid);
  w.draftOn = draft;
  return w;
}

/** A fresh sample, so results can be compared later. */
function at(w: Wind, x: number, y: number): [number, number] {
  return w.sample(x, y, [0, 0]);
}

const len = (v: [number, number]) => Math.hypot(v[0], v[1]);

describe('Wind', () => {
  it('still air stays still', () => {
    const w = make();
    for (let i = 0; i < 60; i++) w.step(1 / 60, view);
    expect(at(w, 160, 120)).toEqual([0, 0]);
  });

  it('the pocket moves air ahead before a touch', () => {
    const w = make();
    w.push(100, 120, 60, 0, 6);
    w.step(1 / 60, view);
    expect(at(w, 112, 120)[0]).toBeGreaterThan(0);
  });

  it('the pocket pushes sideways outward', () => {
    const w = make();
    w.push(100, 120, 60, 0, 6);
    w.step(1 / 60, view);
    expect(at(w, 100, 129)[1]).toBeGreaterThan(0);
    expect(at(w, 100, 111)[1]).toBeLessThan(0);
  });

  it('a still figure pushes nothing', () => {
    const w = make();
    w.push(100, 120, 0, 0, 6);
    w.step(1 / 60, view);
    expect(at(w, 100, 120)).toEqual([0, 0]);
  });

  it('gusts calm down', () => {
    const w = make();
    let peak = 0;
    for (let i = 0; i < 10; i++) {
      w.push(100 + i * 2, 120, 120, 0, 6);
      w.step(1 / 60, view);
      for (let x = 60; x <= 140; x += 4) for (let y = 80; y <= 160; y += 4) peak = Math.max(peak, len(at(w, x, y)));
    }
    expect(peak).toBeGreaterThan(1);
    for (let i = 0; i < 120; i++) w.step(1 / 60, view);
    for (let x = 60; x <= 140; x += 4) for (let y = 80; y <= 160; y += 4) expect(len(at(w, x, y))).toBeLessThan(0.05 * peak);
  });

  it('walls hold no air and block it', () => {
    const w = make((px) => px >= 160 && px < 176);
    for (let i = 0; i < 30; i++) {
      w.push(140, 120, 200, 0, 6);
      w.step(1 / 60, view);
    }
    expect(at(w, 168, 120)).toEqual([0, 0]);
    expect(len(at(w, 190, 120))).toBeLessThan(1);
  });

  it('the pocket reaches a tile and a half', () => {
    const w = make();
    for (let i = 0; i < 10; i++) {
      w.push(100, 120, 60, 0, 6);
      w.step(1 / 60, view);
    }
    expect(at(w, 100 + 22, 120)[0]).toBeGreaterThan(4);
    expect(at(w, 100, 120 + 20)[1]).toBeGreaterThan(0);
  });

  it('a passing walker stirs the air ahead noticeably', () => {
    const w = make();
    let x = 40;
    for (let i = 0; i < 60; i++) {
      w.push(x, 120, 60, 0, 6);
      w.step(1 / 60, view);
      x += 1;
    }
    expect(at(w, x + 16, 120)[0]).toBeGreaterThan(10);
  });

  it('walls stop the pocket', () => {
    const w = make((px) => px >= 160 && px < 176);
    for (let i = 0; i < 30; i++) {
      w.push(150, 120, 200, 0, 6);
      w.step(1 / 60, view);
    }
    for (let x = 180; x <= 200; x += 2) for (let y = 100; y <= 140; y += 2) expect(len(at(w, x, y))).toBeLessThan(0.5);
  });

  it('a blast behind a wall stays behind it', () => {
    const w = make((px) => px >= 160 && px < 176);
    w.blast(140, 120);
    w.step(1 / 60, view);
    expect(at(w, 185, 120)).toEqual([0, 0]);
  });

  it('a blast pushes outward', () => {
    const w = make();
    w.blast(160, 120);
    w.step(1 / 60, view);
    expect(at(w, 190, 120)[0]).toBeGreaterThan(0);
    expect(at(w, 130, 120)[0]).toBeLessThan(0);
    expect(at(w, 160, 150)[1]).toBeGreaterThan(0);
  });

  it('a wake is narrow', () => {
    const w = make();
    w.wake(160, 120, 200, 0);
    w.step(1 / 60, view);
    expect(len(at(w, 160, 124))).toBeGreaterThan(0);
    expect(len(at(w, 160, 160))).toBeLessThan(0.01);
  });

  it('the air stays put in the world when the view moves', () => {
    const w = make();
    w.push(200, 120, 60, 0, 6);
    w.step(1 / 60, view);
    const before = at(w, 212, 120);
    expect(len(before)).toBeGreaterThan(0);
    w.step(0, { ...view, x: 37, y: 11 });
    const after = at(w, 212, 120);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('long or empty frames stay finite', () => {
    const w = make();
    w.push(100, 120, 300, 0, 6);
    w.blast(100, 120);
    w.step(0, view);
    w.step(0.5, view);
    for (let x = 60; x <= 140; x += 4) {
      const v = at(w, x, 120);
      expect(Number.isFinite(v[0]) && Number.isFinite(v[1])).toBe(true);
      expect(len(v)).toBeLessThanOrEqual(160);
    }
  });

  it('the draft is gentle, slow and uneven', () => {
    const w = make(() => false, true);
    w.step(0.1, view);
    let max = 0;
    const first: [number, number][] = [];
    for (let x = 0; x <= 320; x += 10) for (let y = 0; y <= 240; y += 10) {
      const v = at(w, x, y);
      first.push(v);
      max = Math.max(max, len(v));
    }
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBeGreaterThan(0.5);
    w.step(0.1, view);
    let k = 0;
    for (let x = 0; x <= 320; x += 10) for (let y = 0; y <= 240; y += 10) {
      const v = at(w, x, y);
      expect(Math.hypot(v[0] - first[k][0], v[1] - first[k][1])).toBeLessThan(0.2);
      k++;
    }
    expect(Math.hypot(...(at(w, 40, 100).map((c, i) => c - at(w, 240, 100)[i]) as [number, number]))).toBeGreaterThan(0.05);
  });

  it('settles to exactly still once the air has died down', () => {
    const wind = make();
    wind.step(1 / 60, view);
    wind.push(160, 120, 100, 0, 6);
    for (let i = 0; i < 600; i++) wind.step(1 / 60, view);
    for (let x = 100; x <= 220; x += 8) for (let y = 80; y <= 160; y += 8) expect(at(wind, x, y)).toEqual([0, 0]);
  });

  it('asks which cells are solid only when the grid moves or the walls change', () => {
    let calls = 0;
    const wind = make(() => (calls++, false));
    wind.step(1 / 60, view);
    const first = calls;
    expect(first).toBeGreaterThan(0);
    wind.step(1 / 60, view);
    expect(calls).toBe(first);
    wind.wallsChanged();
    wind.step(1 / 60, view);
    expect(calls).toBe(2 * first);
  });
});

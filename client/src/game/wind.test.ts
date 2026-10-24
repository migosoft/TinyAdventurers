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

/** A shot flying +x along y = 120 from x = 40 to x = `end`, one wake per frame, then one more step. */
function fly(speed: number, r: number, heat: number, dt = 1 / 60, end = 280): Wind {
  const w = make();
  for (let x = 40; x < end; x += speed * dt) {
    w.wake(x, 120, speed, 0, r, heat);
    w.step(dt, view);
  }
  w.step(dt, view);
  return w;
}

describe('Wind projectile wakes', () => {
  it('a passing arrow kicks the air hard', () => {
    // Measured just behind the shot (it is at x = 190): the kick fades with the air's decay, so by the end of a 240 px flight only about 16 px/s is left at x = 160.
    const w = fly(260, 7.2, 0, 1 / 60, 190);
    expect(at(w, 160, 120)[0]).toBeGreaterThan(40);
  });

  it('the kick does not depend on frame rate', () => {
    const a = at(fly(260, 7.2, 0, 1 / 60), 160, 120)[0];
    const b = at(fly(260, 7.2, 0, 1 / 30), 160, 120)[0];
    expect(Math.abs(a - b)).toBeLessThan(0.25 * Math.max(a, b));
  });

  it('a wider shot stirs a wider band', () => {
    // One frame at x = 150, where no eddy starts, so only the kick band is measured.
    const once = (r: number) => {
      const w = make();
      w.wake(150, 120, 260, 0, r, 0);
      w.step(1 / 60, view);
      return len(at(w, 150, 132));
    };
    expect(once(16.8)).toBeGreaterThan(2 * once(7.2));
  });

  it('eddies are strong and alternate behind the shot', () => {
    const speed = 200;
    const r = 12;
    const dt = 1 / 60;
    const er = Math.max(1.2 * r, 16);
    const w = make();
    const eddies: { cx: number; cy: number; sign: number }[] = [];
    // Signed circulation proxy at an eddy: vy half a radius ahead minus behind its centre (the flight is +x, so a positive spin gives positive vy ahead).
    const spin = (e: { cx: number; cy: number }) => (at(w, e.cx + 0.5 * er, e.cy)[1] - at(w, e.cx - 0.5 * er, e.cy)[1]) / 2;
    let fresh = 0;
    for (let x = 40; x < 200; x += speed * dt) {
      w.wake(x, 120, speed, 0, r, 0);
      w.step(dt, view);
      const k = Math.floor(x / (2 * er));
      if (k !== Math.floor((x - speed * dt) / (2 * er))) {
        const sign = k & 1 ? 1 : -1;
        eddies.push({ cx: x - er, cy: 120 + sign * 0.8 * er, sign });
        // Just created: the swirl is at full strength (the pocket-free band adds only a smooth background).
        fresh = Math.max(fresh, spin(eddies[eddies.length - 1]) * sign);
      }
    }
    expect(eddies.length).toBeGreaterThanOrEqual(3);
    expect(fresh).toBeGreaterThanOrEqual(15);
    const last = eddies.slice(-3).map((e) => Math.sign(spin(e) * e.sign));
    // Neighbouring eddies spin in opposite directions: the measured raw circulation alternates, and each follows its own expected sign.
    const raw = eddies.slice(-3).map((e) => Math.sign(spin(e)));
    expect(raw[0]).toBe(-raw[1]);
    expect(raw[1]).toBe(-raw[2]);
    expect(last).toEqual([1, 1, 1]);
  });

  it('a hot shot lifts the dust', () => {
    // Just behind the shot (at x = 190) the cold shot's own eddies still add some vertical air, so compare with it.
    const hot = at(fly(260, 16.8, 1, 1 / 60, 190), 160, 120)[1];
    const cold = at(fly(260, 16.8, 0, 1 / 60, 190), 160, 120)[1];
    expect(hot).toBeLessThan(-5);
    expect(hot).toBeLessThan(cold - 3);
    // After the whole flight the cold air is level and only the rise is left.
    const hotEnd = at(fly(260, 16.8, 1), 160, 120)[1];
    const coldEnd = at(fly(260, 16.8, 0), 160, 120)[1];
    expect(coldEnd).toBeGreaterThan(-2);
    expect(hotEnd).toBeLessThan(coldEnd - 2);
  });

  it('a wake stops at walls', () => {
    const w = make((px) => px >= 160 && px < 176);
    for (let y = 40; y < 200; y += 260 / 60) {
      w.wake(150, y, 0, 260, 16.8, 1);
      w.step(1 / 60, view);
    }
    w.step(1 / 60, view);
    expect(at(w, 185, 120)).toEqual([0, 0]);
  });
});

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

  it('the pocket reaches a tile', () => {
    const w = make();
    for (let i = 0; i < 10; i++) {
      w.push(100, 120, 60, 0, 6);
      w.step(1 / 60, view);
    }
    expect(at(w, 100 + 14, 120)[0]).toBeGreaterThan(4);
    expect(at(w, 100, 120 + 14)[1]).toBeGreaterThan(0);
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
    w.wake(150, 120, 200, 0, 6, 0);
    w.step(1 / 60, view);
    expect(len(at(w, 150, 124))).toBeGreaterThan(0);
    expect(len(at(w, 150, 160))).toBeLessThan(0.01);
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

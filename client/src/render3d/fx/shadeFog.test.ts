import { describe, expect, it } from 'vitest';
import { FOG, FOG_MOVE, ShadeFog, fogTris, smooth } from './shadeFog';
import { rng } from './rand';
import { PX } from './shapes';
import { FxTris } from './tris';

const AX = { right: [Math.cos(0.3), 0, Math.sin(0.3)] as [number, number, number], up: [0, Math.cos(0.9), 0] as [number, number, number] };
const ST = 1 / Math.cos(0.9);
const made = (seed = 5, detail = 1): ShadeFog => new ShadeFog(rng(seed), detail);
/** Horizontal distance of a patch from a spot, in px. */
const away = (p: { x: number; z: number }, x: number, z: number): number => Math.hypot(p.x - x, p.z - z) / PX;

/** Runs `secs` seconds of 1/60 s steps from t0; returns the clock after. */
function run(f: ShadeFog, t0: number, secs: number, at: (t: number) => [number, number], form = 1): number {
  let t = t0;
  for (let i = 0; i < Math.round(secs * 60); i++) { t += 1 / 60; const [x, z] = at(t); f.step(1 / 60, t, x, z, form, ST); }
  return t;
}

describe('ShadeFog', () => {
  it('the same seed gives the same patches; detail scales the count and the flat ones', () => {
    expect(made(7).patches).toEqual(made(7).patches);
    expect(made(7).patches).not.toEqual(made(8).patches);
    const full = made(1, 1), half = made(1, 0.5);
    expect(full.patches.length).toBe(FOG.patches);
    expect(full.patches.filter((p) => p.flat).length).toBe(FOG.floor);
    expect(half.patches.length).toBe(20);
    expect(half.patches.filter((p) => p.flat).length).toBe(6);
    expect(half.patches.slice(0, 6).every((p) => p.flat)).toBe(true);
  });

  it('standing still, every patch stays in its ring, clear of the floor, flat ones on it', () => {
    const f = made(), cx = 5, cz = 5;
    f.settle(0, cx, cz, 1, ST);
    run(f, 0, 3, () => [cx, cz]);
    for (const p of f.patches) expect(away(p, cx, cz)).toBeLessThanOrEqual(p.r + FOG.churn + 1e-6);
    for (const p of f.patches.filter((q) => q.flat)) { expect(p.y).toBeGreaterThanOrEqual(0.03); expect(p.y).toBeLessThanOrEqual(0.033 + 1e-9); }
    // the lowest point of every upright patch, as drawn, is above the floor
    const T = new FxTris(5000);
    fogTris(T, AX, f, 3, 1, 1);
    const pos = (T as unknown as { pos: Float32Array }).pos;
    const per = FOG.segs * 3;
    f.patches.forEach((p, i) => {
      if (p.flat) return;
      let low = Infinity;
      for (let k = 0; k < per * 9; k += 3) low = Math.min(low, pos[i * per * 9 + k + 1]);
      expect(low).toBeGreaterThanOrEqual(0.03 - 1e-4);
    });
  });

  it('the ring is smaller while the shade forms', () => {
    const f = made();
    f.settle(0, 5, 5, 0.5, ST);
    const grow = 0.55 + 0.45 * smooth(0.1, 1, 0.5);
    for (const p of f.patches) expect(away(p, 5, 5)).toBeLessThanOrEqual((p.r + FOG.churn) * grow + 1e-6);
  });

  it('follows a mover no more than lag behind its place', () => {
    const f = made(), v = 44 * PX;
    f.settle(0, 5, 5, 1, ST);
    const at = (t: number): [number, number] => [5 + v * t, 5];
    const t = run(f, 0, 2, at);
    const [x] = at(t);
    for (const p of f.patches) {
      const q = f.place(p, t, x, 5, 1, ST);
      expect(Math.hypot(p.x - q[0], p.y - q[1], p.z - q[2]) / PX).toBeLessThanOrEqual(FOG.lag + 1e-6);
      expect(away(p, x, 5)).toBeLessThanOrEqual(p.r + FOG.churn + FOG.lag + 1e-6);
    }
  });

  it('a step of 0 s moves nothing, whatever the spot', () => {
    const f = made();
    f.settle(0, 5, 5, 1, ST);
    const before = JSON.stringify(f.patches);
    f.step(0, 9, 12, 12, 1, ST);
    expect(JSON.stringify(f.patches)).toBe(before);
  });

  it('nothing streams up: over 2 s a patch rises no more than the height wobble allows', () => {
    const f = made();
    f.settle(0, 5, 5, 1, ST);
    run(f, 0, 1, () => [5, 5]);
    const y0 = f.patches.map((p) => p.y);
    run(f, 1, 2, () => [5, 5]);
    // the wobble is FOG_MOVE.bob px either way: 2 s of it is at most 2 * bob * sin(rate * 2 / 2) px
    const most = 2 * FOG_MOVE.bob * Math.sin(FOG_MOVE.bobRate * 2 / 2);
    f.patches.forEach((p, i) => expect((p.y - y0[i]) / PX).toBeLessThanOrEqual(most + 0.1));
  });

  it('form 0 pools the upright patches at the floor', () => {
    const f = made();
    f.settle(0, 5, 5, 0, ST);
    for (const p of f.patches) expect(Math.abs(p.y) / PX).toBeLessThanOrEqual(1);
    const T = new FxTris(5000);
    fogTris(T, AX, f, 0, 1, 1);
    const pos = (T as unknown as { pos: Float32Array }).pos;
    const per = FOG.segs * 3 * 9;
    f.patches.forEach((p, i) => {
      if (p.flat) return;
      let low = Infinity;
      for (let k = 0; k < per; k += 3) low = Math.min(low, pos[i * per + k + 1]);
      // held at the floor's limit: the lowest corner is just above 0.03 (the ring has no corner exactly at the bottom)
      expect(low).toBeGreaterThanOrEqual(0.03 - 1e-4);
      expect(low).toBeLessThan(0.06);
    });
  });

  it('spread moves every patch 6 px further out in a second', () => {
    const f = made();
    f.settle(0, 5, 5, 1, ST);
    const d0 = f.patches.map((p) => away(p, 5, 5));
    for (let i = 0; i < 60; i++) f.spread(1 / 60, 5, 5);
    f.patches.forEach((p, i) => expect(away(p, 5, 5) - d0[i]).toBeCloseTo(FOG.spread, 4));
    const frozen = JSON.stringify(f.patches);
    f.spread(0, 5, 5);
    expect(JSON.stringify(f.patches)).toBe(frozen);
  });
});

describe('fogTris', () => {
  it('writes patches * segs * 3 triangles, rim alpha 0, colour FOG.rgb; none at alpha 0', () => {
    const f = made();
    f.settle(0, 5, 5, 1, ST);
    const T = new FxTris(5000);
    fogTris(T, AX, f, 1, 1, 1);
    expect(T.n).toBe(FOG.patches * FOG.segs * 3);
    const col = (T as unknown as { col: Float32Array }).col;
    let rims = 0;
    for (let i = 0; i < T.n * 3; i++) {
      expect(col[i * 4]).toBeCloseTo(FOG.rgb[0], 6);
      expect(col[i * 4 + 1]).toBeCloseTo(FOG.rgb[1], 6);
      expect(col[i * 4 + 2]).toBeCloseTo(FOG.rgb[2], 6);
      if (col[i * 4 + 3] === 0) rims++;
    }
    expect(rims).toBe(FOG.patches * FOG.segs * 3);
    const none = new FxTris(5000);
    fogTris(none, AX, f, 1, 0, 1);
    expect(none.n).toBe(0);
  });

  it('grow scales the patches', () => {
    const f = made();
    f.settle(0, 5, 5, 1, ST);
    const ext = (grow: number): number => {
      const T = new FxTris(5000);
      fogTris(T, AX, f, 1, 1, grow);
      const pos = (T as unknown as { pos: Float32Array }).pos;
      let m = 0;
      for (let k = 0; k < T.n * 9; k += 3) m = Math.max(m, Math.hypot(pos[k] - 5, pos[k + 2] - 5));
      return m;
    };
    expect(ext(1.6)).toBeGreaterThan(ext(1));
  });
});

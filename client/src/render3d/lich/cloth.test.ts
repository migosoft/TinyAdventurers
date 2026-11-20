import { describe, expect, it } from 'vitest';
import { CLOTH, clothFollow, clothMove, newCloth, type Cloth } from './cloth';
import { ROBE_RINGS } from './rings';

const NR = ROBE_RINGS.length;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const lean = (): Float32Array => { const l = new Float32Array(NR * 2); for (let i = 0; i < NR; i++) { l[i * 2] = 0.04 * i; l[i * 2 + 1] = -0.02 * i; } return l; };

/** A small deterministic random source. */
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** Where ring `i` belongs, as an offset in world directions. */
function place(l: Float32Array, i: number, face: number): [number, number] {
  const cf = Math.cos(face), sf = Math.sin(face);
  return [l[i * 2] * cf - l[i * 2 + 1] * sf, l[i * 2] * sf + l[i * 2 + 1] * cf];
}
const tomePlace = (face: number): [number, number] => { const cf = Math.cos(face), sf = Math.sin(face); return [CLOTH.tome.at[0] * cf - CLOTH.tome.at[1] * sf, CLOTH.tome.at[0] * sf + CLOTH.tome.at[1] * cf]; };

function step(c: Cloth, x: number, z: number, face: number, dt: number, l: Float32Array): void { clothMove(c, x, z, dt); clothFollow(c, face, dt, l); }
function snapshot(c: Cloth): number[] { return [...c.rx, ...c.rz, ...c.rt, c.tomeX, c.tomeZ, c.vx, c.vz, c.glide, c.mx, c.mz, c.lastX, c.lastZ, c.started ? 1 : 0]; }
function atRest(c: Cloth, face: number, l: Float32Array, tol: number): void {
  for (let i = 0; i < NR; i++) {
    const [px, pz] = place(l, i, face);
    expect(Math.hypot(c.rx[i] - px, c.rz[i] - pz)).toBeLessThan(tol);
    expect(Math.abs(wrap(face - c.rt[i]))).toBeLessThan(tol);
  }
}

describe('the lich cloth', () => {
  it('keeps every ring and the tome within their limits through random moves', () => {
    const r = rng(7), c = newCloth(), l = lean();
    let x = 0, z = 0, face = 0;
    for (let n = 0; n < 200; n++) {
      const a = r() * Math.PI * 2, d = r() * 3;
      x += Math.cos(a) * d; z += Math.sin(a) * d; face += (r() - 0.5) * 1.5;
      step(c, x, z, face, 1 / 60, l);
      for (let i = 0; i < NR; i++) {
        const lag = Math.min(1, Math.max(0, ROBE_RINGS[i][4])), [px, pz] = place(l, i, face);
        expect(Math.hypot(c.rx[i] - px, c.rz[i] - pz)).toBeLessThanOrEqual(CLOTH.maxLag * lag ** CLOTH.lagPow + 1e-5);
        expect(Math.abs(wrap(face - c.rt[i]))).toBeLessThanOrEqual(CLOTH.maxTurn * lag + 1e-5);
      }
      const [tx, tz] = tomePlace(face);
      expect(Math.hypot(c.tomeX - tx, c.tomeZ - tz)).toBeLessThanOrEqual(CLOTH.tome.max + 1e-5);
    }
  });

  it('resets on a jump, on a long frame and on the first call', () => {
    const l = lean();
    for (const [mx, dt] of [[17, 1 / 60], [0, 0.2]] as const) {
      const c = newCloth();
      step(c, 0, 0, 0, 1 / 60, l);
      for (let n = 0; n < 30; n++) step(c, n * 1.5, 0, 0.3, 1 / 60, l);
      step(c, 100 + mx, 0, 1, dt, l);
      atRest(c, 1, l, 1e-5);
      expect(c.glide).toBe(0);
      const [tx, tz] = tomePlace(1);
      expect(c.tomeX).toBeCloseTo(tx, 5); expect(c.tomeZ).toBeCloseTo(tz, 5);
    }
    const f = newCloth();
    step(f, 50, 50, 0.5, 1 / 60, l);
    atRest(f, 0.5, l, 1e-5);
    expect(f.glide).toBe(0);
  });

  it('settles when standing still', () => {
    const c = newCloth(), l = lean();
    for (let n = 0; n < 30; n++) step(c, n * 1.5, n, 0.4, 1 / 60, l);
    for (let n = 0; n < 180; n++) step(c, 44.5, 29, 0.4, 1 / 60, l);
    atRest(c, 0.4, l, 0.01);
    expect(c.glide).toBeLessThan(0.01);
  });

  it('trails the hem behind the neck along the direction of travel at a steady glide speed', () => {
    const c = newCloth(), l = new Float32Array(NR * 2), dt = 1 / 60, per = CLOTH.glideSpeed * dt;
    for (let n = 0; n <= 120; n++) step(c, n * per, 0, 0, dt, l);
    expect(c.glide).toBeGreaterThan(0.95);
    expect(c.rx[NR - 1] - c.rx[0]).toBeLessThan(-1);
    expect(Math.abs(c.rz[NR - 1] - c.rz[0])).toBeLessThan(1e-4);
  });

  it('is deterministic', () => {
    const a = newCloth(), b = newCloth(), l = lean(), ra = rng(3), rb = rng(3);
    for (let n = 0; n < 100; n++) { step(a, ra() * 40, ra() * 40, ra(), 1 / 60, l); step(b, rb() * 40, rb() * 40, rb(), 1 / 60, l); }
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('changes nothing for a dt of 0', () => {
    const c = newCloth(), l = lean();
    for (let n = 0; n < 20; n++) step(c, n * 0.7, n * 0.2, 0.1 * n, 1 / 60, l);
    const before = snapshot(c);
    step(c, 14, 4, 2, 0, l);
    expect(snapshot(c)).toEqual(before);
  });

  it('never makes a NaN', () => {
    for (const dt of [0, 1e-9, 10]) {
      const c = newCloth(), l = lean();
      for (let n = 0; n < 10; n++) step(c, n * 2, n, n * 0.3, 1 / 60, l);
      step(c, 30, 12, 1, dt, l);
      step(c, 31, 12, 1, dt, l);
      for (const v of snapshot(c)) expect(Number.isNaN(v)).toBe(false);
    }
  });
});

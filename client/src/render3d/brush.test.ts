import { describe, expect, it } from 'vitest';
import { FLAG } from '../generated/defs';
import type { AirMover } from '../game/airTypes';
import { BRUSH, BrushTracker, brushOffset, walkersOf, type Brusher, type Walker } from './brush';

const mover = (over: Partial<AirMover> = {}): AirMover => ({ id: 1, flags: 0, x: 32, y: 48, vx: 16, vy: 0, r: 8, shot: false, heat: 0, ...over });
const walker = (id: number, x = 5, z = 5, over: Partial<Walker> = {}): Walker => ({ id, x, z, r: 0.5, vx: 2, vz: 0, ...over });
const all = () => true;
const look = { x: 0, z: 0 };

describe('walkersOf', () => {
  it('keeps seen walking figures in tiles; drops airborne, incorporeal, shots and unseen ones', () => {
    const out: Walker[] = [];
    const ms = [
      mover({ id: 1 }),
      mover({ id: 2, flags: FLAG.AIRBORNE }),
      mover({ id: 3, flags: FLAG.INCORPOREAL }),
      mover({ id: 4, shot: true }),
      mover({ id: 5 }),
    ];
    walkersOf(ms, (m) => m.id !== 5, out);
    expect(out).toEqual([{ id: 1, x: 2, z: 3, r: 0.5, vx: 1, vz: 0 }]);
    walkersOf([], all, out);
    expect(out).toHaveLength(0);
  });
});

describe('BrushTracker', () => {
  const walk = (tr: BrushTracker, secs: number, ws: Walker[]) => {
    let r: readonly Brusher[] = [];
    const n = 100;
    for (let i = 0; i < n; i++) r = tr.step(secs / n, ws, all, look);
    return r;
  };

  it('strength reaches 1 after BRUSH.rise of walking and 0 after BRUSH.ease of standing, at the last place', () => {
    const tr = new BrushTracker();
    const r = walk(tr, BRUSH.rise, [walker(1, 5, 6)]);
    expect(r).toHaveLength(1);
    expect(r[0].strength).toBeCloseTo(1);
    expect(r[0].x).toBe(5);
    expect(r[0].z).toBe(6);
    expect(r[0].reach).toBeCloseTo(0.5 + BRUSH.margin);
    expect(r[0].tail).toBeCloseTo(BRUSH.tail * 2);
    const half = walk(tr, BRUSH.ease / 2, []);
    expect(half).toHaveLength(1);
    expect(half[0].strength).toBeCloseTo(0.5);
    expect(half[0].x).toBe(5);
    expect(half[0].dx).toBeCloseTo(1);
    expect(walk(tr, BRUSH.ease, [])).toHaveLength(0);
  });

  it('a figure that stood in a bush and never walked gives no brusher', () => {
    const tr = new BrushTracker();
    expect(walk(tr, 1, [])).toHaveLength(0);
  });

  it('a figure that is no longer present loses its brusher in the same step', () => {
    const tr = new BrushTracker();
    walk(tr, 0.2, [walker(1)]);
    expect(tr.step(0.016, [], (id) => id !== 1, look)).toHaveLength(0);
  });

  it('more than BRUSH.cap walkers: the nearest to look win', () => {
    const tr = new BrushTracker();
    const ws = Array.from({ length: 20 }, (_, i) => walker(i + 1, 10 + i, 0));
    const r = walk(tr, 0.2, ws);
    expect(r).toHaveLength(BRUSH.cap);
    expect(Math.max(...r.map((b) => b.x))).toBe(10 + BRUSH.cap - 1);
  });

  it('dt 0 changes nothing; dt 10 keeps strengths in 0..1 and removes a stopped figure', () => {
    const tr = new BrushTracker();
    walk(tr, 0.1, [walker(1)]);
    const s = tr.step(0, [walker(1)], all, look)[0].strength;
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(tr.step(0, [], all, look)[0].strength).toBe(s);
    const big = tr.step(10, [walker(1)], all, look)[0].strength;
    expect(big).toBeLessThanOrEqual(1);
    expect(tr.step(10, [], all, look)).toHaveLength(0);
  });
});

describe('brushOffset', () => {
  const b = (over: Partial<Brusher> = {}): Brusher => ({ x: 0, z: 0, reach: 1, strength: 1, dx: 1, dz: 0, tail: 0.3, ...over });
  const len = (o: [number, number]) => Math.hypot(o[0], o[1]);

  it('is zero for k 0, no brushers and beyond reach + soft', () => {
    expect(brushOffset(0.5, 0, 0, 0, 0.1, [b()])).toEqual([0, 0]);
    expect(brushOffset(0.5, 0, 1, 0, 0.1, [])).toEqual([0, 0]);
    expect(brushOffset(1 + BRUSH.soft + 0.1, 0, 1, 0, 0.1, [b()])).toEqual([0, 0]);
  });

  it('is larger near the brusher than at the reach edge', () => {
    // sin(2 pi rate t + phase) = 1 at phase pi/2, t = 0
    const near = len(brushOffset(0.5, 0, 1, Math.PI / 2, 0, [b()]));
    const edge = len(brushOffset(1 + BRUSH.soft * 0.9, 0, 1, Math.PI / 2, 0, [b()]));
    expect(near).toBeGreaterThan(edge);
    expect(near).toBeGreaterThan(0);
  });

  it('stays finite at the brusher itself and with two identical brushers', () => {
    const o = brushOffset(0, 0, 1, 1, 0.3, [b(), b()]);
    expect(Number.isFinite(o[0]) && Number.isFinite(o[1])).toBe(true);
  });

  it('16 brushers on one spot give at most BRUSH.max * k', () => {
    const o = brushOffset(0.2, 0.1, 2, Math.PI / 2, 0, Array.from({ length: 16 }, () => b()));
    expect(len(o)).toBeLessThanOrEqual(BRUSH.max * 2 + 1e-9);
    expect(len(o)).toBeCloseTo(BRUSH.max * 2);
  });

  it('a point behind the figure within the tail is still moved', () => {
    const behind = brushOffset(-1 - 0.1, 0, 1, Math.PI / 2, 0, [b({ tail: 0.5 })]);
    expect(len(behind)).toBeGreaterThan(0);
    expect(len(brushOffset(-1 - 0.1, 0, 1, Math.PI / 2, 0, [b({ tail: 0 })]))).toBeGreaterThan(0); // inside reach anyway
    expect(len(brushOffset(-1 - BRUSH.soft - 0.1, 0, 1, Math.PI / 2, 0, [b({ tail: 0.5 })]))).toBeGreaterThan(0);
    expect(len(brushOffset(-1 - BRUSH.soft - 0.1, 0, 1, Math.PI / 2, 0, [b({ tail: 0 })]))).toBe(0);
  });
});

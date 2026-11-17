import { describe, expect, it } from 'vitest';
import { MoverTracker, collectAirMovers } from './airmovers';
import type { AirMover } from './airTypes';
import { FIGURES } from './anim/defs';
import { projectileAir } from './airshots';
import { FLAG, KIND } from '../generated/defs';
import type { EntState } from './world';
import type { RunFrame } from '../run/view';

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

describe('collectAirMovers', () => {
  const ent = (id: number, kind: number, x: number, flags = 0, extra = 0): EntState =>
    ({ id, kind, x, y: 50, hp: 1, anim: 0, aim: 0, animMs: 0, flags, extra, effects: 0, side: 0, entangled: 0 });
  const frame = (ents: EntState[], shots: RunFrame['shots'] = [], alive = false): RunFrame =>
    ({ dt: DT, now: 0, ents: new Map(ents.map((e) => [e.id, e])), you: 1, own: { x: 0, y: 0, alive }, shots }) as unknown as RunFrame;
  const run = (tr: MoverTracker, f: RunFrame): AirMover[] => collectAirMovers(f, tr, KIND.Paladin, []);

  it('a moving figure gives one mover with its base radius; a dead one, a torch and a chest give none', () => {
    const tr = new MoverTracker();
    const mk = (x: number) => frame([ent(5, KIND.Paladin, x), ent(6, KIND.Paladin, x, FLAG.DEAD), ent(7, KIND.Torch, x), ent(8, KIND.Chest, x)]);
    run(tr, mk(10));
    const out = run(tr, mk(11));
    expect(out).toHaveLength(1);
    expect(out[0].r).toBe(FIGURES[KIND.Paladin].baseR);
    expect(out[0].shot).toBe(false);
  });

  it('an own predicted shot is taken from f.shots only', () => {
    const tr = new MoverTracker();
    const own = (x: number) => frame([ent(9, KIND.Arrow, x, 0, (1 << 16) | 3)], [{ shot: 3, kind: KIND.Arrow, x, y: 50, vx: 0, vy: 0 }]);
    run(tr, own(10));
    const out = run(tr, own(12));
    expect(out).toHaveLength(1);
  });

  it('a shot gets airY = y - 8 and its heat', () => {
    const tr = new MoverTracker();
    const f = (x: number) => frame([ent(9, KIND.Fireball, x, 0, 2 << 16)]);
    run(tr, f(10));
    const out = run(tr, f(14));
    expect(out).toHaveLength(1);
    expect(out[0].airY).toBe(42);
    expect(out[0].shot).toBe(true);
    expect(out[0].heat).toBe(projectileAir(KIND.Fireball).heat);
  });
});

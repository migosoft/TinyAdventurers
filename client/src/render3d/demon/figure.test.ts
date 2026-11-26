import { describe, expect, it } from 'vitest';
import { ANIM, EFFECT, FLAG, KIND } from '../../generated/defs';
import { builtOf, type BuiltIn } from '../built';
import { DEMON_DEV, DEMON_FIGURE } from './figure';
import { WING } from './wings';
import { DEMON, demonRest } from './shape';

const idle = (o: Partial<BuiltIn> = {}): BuiltIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, x: 3, z: 4, ...o });

describe('DEMON_FIGURE', () => {
  it('is the figure of the demon kind: 54 px tall, its own picture', () => {
    expect(builtOf(KIND.Demon)).toBe(DEMON_FIGURE);
    expect(DEMON_FIGURE).toMatchObject({ key: 'demon', picture: 'demon', unit: DEMON.unit, hem: DEMON.hem });
    expect(DEMON_FIGURE.top).toBe(54);
  });

  it('keeps two memories apart: no shared buffer', () => {
    const a = DEMON_FIGURE.draw(idle(), 0.016, DEMON_FIGURE.newMem()), b = DEMON_FIGURE.draw(idle({ aim: 2 }), 0.016, DEMON_FIGURE.newMem());
    // `===`, not `not.toBe`: that one compares the big buffers deeply for its message
    const same = [a === b, a.body === b.body, a.hull === b.hull, a.levels === b.levels, a.anchors.hand === b.anchors.hand, a.magic === b.magic];
    for (const k of ['position', 'normal', 'uv', 'colour', 'look', 'index'] as const) same.push(a.body[k] === b.body[k], a.hull![k] === b.hull![k], a.body[k] === a.hull![k]);
    expect(same).toEqual(same.map(() => false));
  });

  it('draw hands back the memory\'s own buffers, a hull, no claws, no halos, the anchors and the lights', () => {
    const m = DEMON_FIGURE.newMem();
    const d = DEMON_FIGURE.draw(idle({ aim: 1 }), 0.016, m);
    expect(DEMON_FIGURE.draw(idle({ aim: 1 }), 0.016, m)).toBe(d);
    expect(d.body.verts).toBeGreaterThan(0);
    expect(d.hull!.verts).toBeGreaterThan(0);
    expect(d.glow).toBeNull();
    expect(d.halos).toEqual([]);
    expect(d.yaw).toBe(1);
    expect(d.lift).toBe(0);
    for (const k of ['hand', 'mouth', 'chest', 'eyes'] as const) expect(d.anchors[k]!.every(Number.isFinite)).toBe(true);
    expect(d.anchors.mouth![1]).toBeGreaterThan(20);
    expect(d.magic.chest).toBeGreaterThan(0);
    expect(d.magic.mouth).toBe(0);
    expect(d.levels[1]).toBe(1);
    expect(d.levels[2]).toBe(1);
  });

  it('the glow\'s phase runs on the figure\'s clock, a quarter turn a second, and stands still while frozen or stone', () => {
    const m = DEMON_FIGURE.newMem();
    expect(DEMON_FIGURE.draw(idle(), 0, m).levels[0]).toBe(0);
    expect(DEMON_FIGURE.draw(idle(), 1, m).levels[0]).toBeCloseTo(0.25, 9);
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) expect(DEMON_FIGURE.draw(idle({ effects: 1 << fx }), 1, m).levels[0]).toBeCloseTo(0.25, 9);
    expect(DEMON_FIGURE.draw(idle(), 3.5, m).levels[0]).toBeCloseTo(0.125, 9);
  });

  it('beats its wings and hangs in the air while airborne, trails a turn, holds all of it frozen or stone, and takes the dev page\'s fold', () => {
    const m = DEMON_FIGURE.newMem() as { pose: { wingR: { arm: { raise: number; sweep: number; fold: number } }; wingL: { arm: { sweep: number } }; tail: Float32Array; lift: number } };
    const run = (o: Partial<BuiltIn>, frames: number, aimStep = 0): void => { for (let i = 0; i < frames; i++) DEMON_FIGURE.draw(idle({ ...o, aim: (aim += aimStep) }), 1 / 60, m); };
    let aim = 0;
    run({}, 30);
    expect(m.pose.wingR.arm.raise).toBeCloseTo(WING.rest.raise, 6);
    expect(m.pose.lift).toBe(0);
    let lo = 9, hi = -9;
    for (let i = 0; i < 140; i++) { run({ flags: FLAG.AIRBORNE }, 1); lo = Math.min(lo, m.pose.wingR.arm.raise); hi = Math.max(hi, m.pose.wingR.arm.raise); }
    expect(hi - lo).toBeGreaterThan(1);
    expect(m.pose.lift).toBeGreaterThan(9);
    expect(DEMON_FIGURE.draw(idle({ flags: FLAG.AIRBORNE }), 1 / 60, m).lift).toBe(m.pose.lift);
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) {
      const before = JSON.stringify(m.pose);
      run({ flags: FLAG.AIRBORNE, effects: 1 << fx }, 20);
      expect(JSON.stringify(m.pose)).toBe(before);
    }
    // back on the floor, turning to its right: the right wing lags forward, the left back, the tail swings to the right
    run({}, 120);
    run({}, 20, 0.04);
    expect(m.pose.wingR.arm.sweep).toBeLessThan(WING.rest.sweep - 0.05);
    expect(m.pose.wingL.arm.sweep).toBeGreaterThan(WING.rest.sweep + 0.05);
    expect(m.pose.tail[0]).toBeGreaterThan(0.1);
    expect(m.pose.tail[0]).toBeGreaterThan(m.pose.tail[10]);
    try { DEMON_DEV.fold = 1; run({}, 120); expect(m.pose.wingR.arm.fold).toBeCloseTo(1, 2); } finally { DEMON_DEV.fold = null; }
  });

  it('rest is the standing figure\'s body', () => {
    const r = DEMON_FIGURE.rest();
    expect(r.verts).toBe(demonRest().body.verts);
    expect(r.indices).toBeGreaterThan(0);
  });
});

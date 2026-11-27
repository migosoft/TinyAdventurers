import { describe, expect, it, vi } from 'vitest';
import { ANIM, CONST, EFFECT, FLAG, KIND } from '../../generated/defs';
import { builtOf, type BuiltIn } from '../built';
import { DEMON_DEV, DEMON_FIGURE } from './figure';
import { WING } from './wings';
import { buildDemon, DEMON, demonRest } from './shape';

vi.mock('./shape', async (orig) => { const o = await orig<typeof import('./shape')>(); return { ...o, buildDemon: vi.fn(o.buildDemon) }; });

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
    const m = DEMON_FIGURE.newMem() as { mem: { pose: { wingR: { arm: { raise: number; sweep: number; fold: number } }; wingL: { arm: { sweep: number } }; tail: Float32Array; lift: number } } };
    const pose = m.mem.pose;
    const run = (o: Partial<BuiltIn>, frames: number, aimStep = 0): void => { for (let i = 0; i < frames; i++) DEMON_FIGURE.draw(idle({ ...o, aim: (aim += aimStep) }), 1 / 60, m); };
    let aim = 0;
    run({}, 30);
    expect(Math.abs(pose.wingR.arm.raise - WING.rest.raise)).toBeLessThan(0.12);   // at rest, but for the breath and the drift
    expect(pose.lift).toBe(0);
    let lo = 9, hi = -9;
    for (let i = 0; i < 140; i++) { run({ flags: FLAG.AIRBORNE }, 1); lo = Math.min(lo, pose.wingR.arm.raise); hi = Math.max(hi, pose.wingR.arm.raise); }
    expect(hi - lo).toBeGreaterThan(1);
    expect(pose.lift).toBeGreaterThan(9);
    expect(DEMON_FIGURE.draw(idle({ flags: FLAG.AIRBORNE }), 1 / 60, m).lift).toBe(pose.lift);
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) {
      const before = JSON.stringify(pose);
      run({ flags: FLAG.AIRBORNE, effects: 1 << fx }, 20);
      expect(JSON.stringify(pose)).toBe(before);
    }
    // back on the floor, turning to its right: the drawn facing follows behind the aim, the right wing lags forward of the left
    run({}, 120);
    run({}, 40, 0.04);
    const d = DEMON_FIGURE.draw(idle({ aim }), 1 / 60, m);
    expect(d.yaw).toBeLessThan(aim - 0.2);
    expect(d.yaw).toBeGreaterThan(0.3);
    expect(pose.wingR.arm.sweep).toBeLessThan(pose.wingL.arm.sweep - 0.1);
    expect(pose.tail[0]).toBeGreaterThan(pose.tail[10]);
    try { DEMON_DEV.fold = 1; run({}, 120); expect(pose.wingR.arm.fold).toBeCloseTo(1, 2); } finally { DEMON_DEV.fold = null; }
  });

  it('the mouth gives its light while the breath channels, not in its wind-up and not on a stone demon', () => {
    const m = DEMON_FIGURE.newMem(), breath = (animT: number, effects = 0): number => DEMON_FIGURE.draw(idle({ anim: ANIM.Breath, animT, effects }), 1 / 60, m).magic.mouth!;
    expect(breath(CONST.DEMON_BREATH_WINDUP - 0.1)).toBe(0);
    expect(breath(CONST.DEMON_BREATH_WINDUP + 0.1)).toBe(1);
    expect(DEMON_FIGURE.draw(idle({ anim: ANIM.Breath, animT: 1.2 }), 1 / 60, m).levels[2]).toBeGreaterThan(1.5);
    expect(breath(CONST.DEMON_BREATH_WINDUP + 0.2, 1 << EFFECT.Petrified)).toBe(0);
  });

  it('rest is the standing figure\'s body', () => {
    const r = DEMON_FIGURE.rest();
    expect(r.verts).toBe(demonRest().body.verts);
    expect(r.indices).toBeGreaterThan(0);
  });

  it('does not rebuild a held (frozen or stone) demon, builds its first frame, and builds again on the thaw; memories are separate', () => {
    const builds = vi.mocked(buildDemon);
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) {
      const a = DEMON_FIGURE.newMem(), b = DEMON_FIGURE.newMem();
      DEMON_FIGURE.draw(idle(), 0.016, a);
      builds.mockClear();
      DEMON_FIGURE.draw(idle({ effects: 1 << fx }), 0.016, a);
      DEMON_FIGURE.draw(idle({ effects: 1 << fx }), 0.016, a);
      expect(builds).toHaveBeenCalledTimes(0);
      DEMON_FIGURE.draw(idle({ effects: 1 << fx }), 0.016, b);
      DEMON_FIGURE.draw(idle({ effects: 1 << fx }), 0.016, b);
      expect(builds).toHaveBeenCalledTimes(1);
      DEMON_FIGURE.draw(idle(), 0.016, a);
      expect(builds).toHaveBeenCalledTimes(2);
    }
  });
});

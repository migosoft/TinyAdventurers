import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANIM, CONST, EFFECT, FLAG, KIND } from '../../generated/defs';
import { builtOf, type BuiltIn } from '../built';
import type { FigureKit } from '../models/kit';
import { BONES, buildDemonSkin } from './body';
import { DEMON, DEMON_DEV, DEMON_FIGURE, ICE_DEMON_FIGURE } from './figure';
import { SKEL } from './skeleton';
import { setDemonSkin } from './skinFile';
import { WING } from './wings';

const idle = (o: Partial<BuiltIn> = {}): BuiltIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, x: 3, z: 4, ...o });
afterEach(() => { setDemonSkin(null); });

describe('the demon figures', () => {
  it('are the figures of the two demon kinds: 54 px tall, no picture, the skin\'s keys', () => {
    expect(builtOf(KIND.FireDemon)).toBe(DEMON_FIGURE);
    expect(builtOf(KIND.IceDemon)).toBe(ICE_DEMON_FIGURE);
    expect(DEMON_FIGURE).toMatchObject({ key: 'demon', picture: null, unit: DEMON.unit, hem: DEMON.hem, top: 54 });
    expect(ICE_DEMON_FIGURE).toMatchObject({ key: 'iceDemon', picture: null, unit: DEMON.unit, top: 54 });
    expect(DEMON.unit).toBeCloseTo(54 / SKEL.crown, 12);
  });

  it('are ready when the skin is loaded, and not before', () => {
    const kit = { picture: () => { throw new Error('no picture is read'); } } as unknown as FigureKit;
    setDemonSkin(null);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    try {
      expect(DEMON_FIGURE.ready(kit)).toBe(false);
      setDemonSkin(buildDemonSkin(0.2));
      expect(DEMON_FIGURE.ready(kit)).toBe(true);
      expect(ICE_DEMON_FIGURE.ready(kit)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps two memories apart: no shared bone array, anchor or level', () => {
    const a = DEMON_FIGURE.draw(idle(), 0.016, DEMON_FIGURE.newMem()), b = DEMON_FIGURE.draw(idle({ aim: 2 }), 0.016, ICE_DEMON_FIGURE.newMem());
    const same = [a === b, a.bones === b.bones, a.body === b.body, a.levels === b.levels, a.anchors.hand === b.anchors.hand, a.anchors.blade === b.anchors.blade, a.magic === b.magic];
    expect(same).toEqual(same.map(() => false));
    expect([a.temper, b.temper]).toEqual([1, -1]);
  });

  it('draw hands back the memory\'s own bone matrices, an empty body, no hull, claws or halos, the anchors and the lights', () => {
    const m = DEMON_FIGURE.newMem();
    const d = DEMON_FIGURE.draw(idle({ aim: 1 }), 0.016, m);
    expect(DEMON_FIGURE.draw(idle({ aim: 1 }), 0.016, m)).toBe(d);
    expect(d.bones!.length).toBe(BONES * 16);
    expect(d.bones!.every(Number.isFinite)).toBe(true);
    expect(d.body.verts).toBe(0);
    expect(d.body.indices).toBe(0);
    expect(d.hull ?? null).toBeNull();
    expect(d.glow).toBeNull();
    expect(d.halos).toEqual([]);
    expect(d.yaw).toBe(1);
    expect(d.lift).toBe(0);
    const a = d.anchors;
    for (const p of [a.hand, a.mouth!, a.chest!, a.eyes!, a.eyeL!, a.eyeR!, ...a.blade!]) expect(p.every(Number.isFinite)).toBe(true);
    // the mouth and the eyes are on the head, high; the eyes lie either side of the middle (model z is the demon's right)
    expect(a.mouth![1]).toBeGreaterThan(2);
    expect(a.eyeL![2]).toBeLessThan(a.eyeR![2]);
    expect(a.mouth![0]).toBeGreaterThan(0.2);   // in front of the body
    // five points along the blade's edge, grip to tip, about its length apart, the tip on the demon's right hand's side
    expect(a.blade!.length).toBe(5);
    const span = Math.hypot(...a.blade![4].map((v, i) => v - a.blade![0][i]));
    expect(span).toBeGreaterThan(1);
    expect(span).toBeLessThan(2);
    expect(d.magic.chest).toBeGreaterThan(0);
    expect(d.magic.mouth).toBe(0);
    expect(d.levels[1]).toBe(1);
    expect(d.levels[2]).toBe(1);
  });

  it('the glow\'s phase runs on the figure\'s clock and stands still while frozen or stone', () => {
    const m = DEMON_FIGURE.newMem();
    expect(DEMON_FIGURE.draw(idle(), 0, m).levels[0]).toBe(0);
    expect(DEMON_FIGURE.draw(idle(), 1, m).levels[0]).toBeCloseTo(0.25, 9);
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) expect(DEMON_FIGURE.draw(idle({ effects: 1 << fx }), 1, m).levels[0]).toBeCloseTo(0.25, 9);
    expect(DEMON_FIGURE.draw(idle(), 3.5, m).levels[0]).toBeCloseTo(0.125, 9);
  });

  it('beats its wings and hangs in the air while airborne, trails a turn, holds all of it frozen or stone, and takes the dev page\'s fold', () => {
    const m = DEMON_FIGURE.newMem() as { mem: { pose: { wingR: { arm: { raise: number; sweep: number; fold: number } }; wingL: { arm: { sweep: number } }; tail: Float32Array; lift: number; beat: number; fly: number } } };
    const pose = m.mem.pose;
    const run = (o: Partial<BuiltIn>, frames: number, aimStep = 0): void => { for (let i = 0; i < frames; i++) DEMON_FIGURE.draw(idle({ ...o, aim: (aim += aimStep) }), 1 / 60, m); };
    let aim = 0;
    run({}, 30);
    expect(Math.abs(pose.wingR.arm.raise - WING.rest.raise)).toBeLessThan(0.12);   // at rest, but for the breath and the drift
    expect(pose.lift).toBe(0);
    let lo = 9, hi = -9;
    for (let i = 0; i < 140; i++) { run({ flags: FLAG.AIRBORNE }, 1); lo = Math.min(lo, pose.beat); hi = Math.max(hi, pose.beat); }
    expect(hi - lo).toBeGreaterThan(0.95);   // the beat's phase runs through
    expect(pose.fly).toBe(1);
    expect(pose.lift).toBeGreaterThan(9);
    expect(DEMON_FIGURE.draw(idle({ flags: FLAG.AIRBORNE }), 1 / 60, m).lift).toBeCloseTo(pose.lift * SKEL.perPose, 9);   // builder units
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) {
      const before = JSON.stringify(pose);
      run({ flags: FLAG.AIRBORNE, effects: 1 << fx }, 20);
      expect(JSON.stringify(pose)).toBe(before);
    }
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

  it('rest is the standing figure\'s coarse skin, upright, its crest at the figure\'s height, its feet on the floor', () => {
    const r = DEMON_FIGURE.rest();
    expect(DEMON_FIGURE.rest()).toBe(r);
    expect(ICE_DEMON_FIGURE.rest()).toBe(r);
    expect(r.verts).toBeGreaterThan(1000);
    expect(r.indices).toBeGreaterThan(1000);
    let hi = -9, lo = 9;
    for (let i = 0; i < r.verts; i++) { hi = Math.max(hi, r.position[i * 3 + 1]); lo = Math.min(lo, r.position[i * 3 + 1]); expect(Number.isFinite(r.position[i * 3])).toBe(true); }
    expect(hi).toBeGreaterThan(SKEL.crown * 0.95);
    expect(Math.abs(lo)).toBeLessThan(0.05);
  });

  it('does not place the bones of a held (frozen or stone) demon again, places its first frame, and places again on the thaw', () => {
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) {
      const a = DEMON_FIGURE.newMem(), b = DEMON_FIGURE.newMem();
      const first = Array.from(DEMON_FIGURE.draw(idle(), 0.016, a).bones!);
      const held = (m: unknown): number[] => Array.from(DEMON_FIGURE.draw(idle({ effects: 1 << fx }), 0.5, m).bones!);
      expect(held(a)).toEqual(first);
      expect(held(a)).toEqual(first);
      // a held first frame is still placed
      expect(held(b).some((v) => v !== 0)).toBe(true);
      expect(Array.from(DEMON_FIGURE.draw(idle(), 0.5, a).bones!)).not.toEqual(first);
    }
  });
});

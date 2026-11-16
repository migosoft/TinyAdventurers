import { beforeEach, describe, expect, it } from 'vitest';
import { ANIM, EFFECT, KIND } from '../../generated/defs';
import type { Snapshot } from '../../generated/Snapshot';
import { FIGURES } from '../../game/anim/defs';
import type { EntState } from '../../game/world';
import { TileMap } from '../../sim/map';
import { Effects3d, FX_KIND, FX_LIFE, clearFxRegistry, type FxFrame } from './effects3d';
import { registerFigureFx } from './figureFx';
import { registerBooms } from './booms';
import { FxTris } from './tris';
import { newGlowBuf } from '../cards';
import type { DrawnFig, FxOut, MimicCue } from './types';

const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [] });
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };

const fig = (id: number, kind: number, o: Partial<DrawnFig> = {}): DrawnFig => ({
  id, kind, x: 5, z: 5, top: 1, foot: 0, hand: [5.3, 0.6, 5], aim: 0, anim: ANIM.Idle, animT: 0, effects: 0, alpha: 1, model: false, side: 0, def: FIGURES[kind],
  yaw: 0, swingY: 0.6, arc: FIGURES[kind]?.swing?.arc ?? 0, bite: -1, ...o,
});

const ent = (id: number, kind: number, o: Partial<EntState> = {}): EntState => ({ id, kind, x: 80, y: 80, hp: 1, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: 1, entangled: 0, ...o });

const frameOf = (now: number, figs: DrawnFig[], o: { ents?: EntState[]; hidden?: number[]; snap?: Partial<Snapshot>; cues?: MimicCue[]; falls?: Array<{ id: number; x: number; z: number }> } = {}): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs, ents: new Map((o.ents ?? []).map((e) => [e.id, e])), shots: [], hiddenShots: new Set(), snap: o.snap as Snapshot | undefined,
  hidden: new Set(o.hidden ?? []), you: 0, ownCast: null, cues: o.cues, falls: o.falls,
});

beforeEach(() => { clearFxRegistry(); registerFigureFx(); registerBooms(); });

describe('figure effects', () => {
  it('swoosh for cards too', () => {
    const fx = new Effects3d(map), out = newOut();
    fx.frame(frameOf(1, [fig(1, KIND.Paladin, { anim: ANIM.Melee, animT: 0.1, model: false })]), out);
    expect(out.tris.n).toBeGreaterThan(0);
    const none = newOut();
    fx.frame(frameOf(1, [fig(1, KIND.Paladin, { anim: ANIM.Idle })]), none);
    expect(none.tris.n).toBe(0);
  });

  it('release spark once per action', () => {
    const fx = new Effects3d(map);
    const wiz = (animT: number): DrawnFig => fig(2, KIND.Wizard, { anim: ANIM.Cast, animT });
    fx.frame(frameOf(10, [wiz(0.02)]), newOut());
    fx.frame(frameOf(10.016, [wiz(0.036)]), newOut());
    fx.frame(frameOf(10.032, [wiz(0.052)]), newOut());
    expect(fx.records).toBe(1);
    // the spark ends; a new cast later is a new action
    fx.frame(frameOf(10.5, []), newOut());
    expect(fx.records).toBe(0);
    fx.frame(frameOf(11, [wiz(0.02)]), newOut());
    expect(fx.records).toBe(1);
  });

  it('draws the spark record', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(10, [fig(2, KIND.Wizard, { anim: ANIM.Cast, animT: 0.02 })]), newOut());
    const out = newOut();
    fx.frame(frameOf(10.05, []), out);
    expect(out.tris.n).toBeGreaterThan(0);
  });

  it('telegraph lies on the floor', () => {
    const fx = new Effects3d(map), out = newOut();
    const ogre = FIGURES[KIND.Ogre];
    expect(ogre.slam).toBeTruthy();
    fx.frame(frameOf(3, [fig(3, KIND.Ogre, { anim: ogre.slam!.anim, animT: ogre.slam!.t / 2 })]), out);
    expect(out.tris.n).toBeGreaterThan(0);
    const pos = new Float32Array(out.tris.n * 9);
    const buf = { position: [] as number[], rgba: [] as number[], n: 0 };
    out.tris.flush(buf, cam, false);
    pos.set(buf.position);
    const R = ogre.slam!.r / 16;
    for (let i = 0; i < pos.length; i += 3) {
      expect(pos[i + 1]).toBeCloseTo(0.02, 5);
      expect(Math.hypot(pos[i] - 5, pos[i + 2] - 5)).toBeLessThanOrEqual(R + 0.01);
    }
  });

  it('breath motes start at the mouth', () => {
    const fx = new Effects3d(map), out = newOut();
    const d = FIGURES[KIND.Dragon], wind = d.windups![ANIM.Breath] ?? 0;
    const mouth: [number, number, number] = [6, 1.2, 5];
    // at the start the breath has only just left: every mote is still at the mouth
    fx.frame(frameOf(3, [fig(4, KIND.Dragon, { anim: ANIM.Breath, animT: wind + 0.08, mouth, nostril: [6, 1.4, 5] })]), out);
    expect(out.tris.n).toBeGreaterThan(0);
    const buf = { position: [] as number[], rgba: [] as number[], n: 0 };
    out.tris.flush(buf, cam, false);
    for (let i = 0; i < buf.position.length; i += 3) {
      // a mote 0.08 s old has flown at most 0.08 / 0.45 of its way (7.2 tiles at most, 1.2 down)
      expect(Math.hypot(buf.position[i] - mouth[0], buf.position[i + 1] - mouth[1], buf.position[i + 2] - mouth[2])).toBeLessThan(1.6);
    }
    // later the cone is full: motes reach into it and not past it
    const late = newOut();
    fx.frame(frameOf(3.6, [fig(4, KIND.Dragon, { anim: ANIM.Breath, animT: wind + 0.6, mouth, nostril: [6, 1.4, 5] })]), late);
    expect(late.tris.n).toBeGreaterThan(40);
    const lb = { position: [] as number[], rgba: [] as number[], n: 0 };
    late.tris.flush(lb, cam, false);
    let far = 0;
    for (let i = 0; i < lb.position.length; i += 3) far = Math.max(far, Math.hypot(lb.position[i] - 5, lb.position[i + 2] - 5));
    expect(far).toBeLessThan(115 / 16 + 1);
    expect(far).toBeGreaterThan(40 / 16);
    // without a mouth point nothing flies
    const none = newOut();
    fx.frame(frameOf(3, [fig(4, KIND.Dragon, { anim: ANIM.Breath, animT: wind + 0.01 })]), none);
    expect(none.tris.n).toBe(0);
  });

  it('gaze needs a target', () => {
    const fx = new Effects3d(map);
    const lich = fig(5, KIND.Lich, { anim: ANIM.Gaze });
    const lone = newOut();
    fx.frame(frameOf(1, [lich], { ents: [ent(5, KIND.Lich, { anim: ANIM.Gaze, extra: 99 })] }), lone);
    expect(lone.tris.n).toBe(0);
    const hit = newOut();
    fx.frame(frameOf(1, [lich, fig(6, KIND.Paladin, { x: 8, z: 6 })], { ents: [ent(5, KIND.Lich, { anim: ANIM.Gaze, extra: 6 })] }), hit);
    expect(hit.tris.n).toBeGreaterThan(0);
  });

  it('hidden figure draws nothing', () => {
    const fx = new Effects3d(map), out = newOut();
    const figs = [
      fig(1, KIND.Paladin, { anim: ANIM.Melee, animT: 0.1 }),
      fig(2, KIND.Ogre, { anim: FIGURES[KIND.Ogre].slam!.anim, animT: 0.2 }),
      fig(3, KIND.Wizard, { anim: ANIM.Channel, animT: 0.3 }),
      fig(4, KIND.Lich, { anim: ANIM.Gaze }),
    ];
    fx.frame(frameOf(1, figs, { hidden: [1, 2, 3, 4], ents: [ent(4, KIND.Lich, { anim: ANIM.Gaze, extra: 1 })] }), out);
    expect(out.tris.n).toBe(0);
    expect(out.lit.n).toBe(0);
    expect(out.glows.n).toBe(0);
  });

  it('a stone or frozen figure shows none', () => {
    const fx = new Effects3d(map), out = newOut();
    fx.frame(frameOf(1, [fig(1, KIND.Paladin, { anim: ANIM.Melee, animT: 0.1, effects: 1 << EFFECT.Petrified })]), out);
    expect(out.tris.n).toBe(0);
  });

  it('the channel swirls round the figure', () => {
    const fx = new Effects3d(map), out = newOut();
    fx.frame(frameOf(1, [fig(1, KIND.Wizard, { anim: ANIM.Channel, animT: 0.3, model: true })]), out);
    expect(out.tris.n).toBeGreaterThan(0);
  });

  it('a mimic cue makes a record that draws', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, [], { cues: [{ id: 8, x: 3, z: 3, land: false }, { id: 9, x: 4, z: 3, land: true }] }), newOut());
    expect(fx.records).toBe(2);
    const out = newOut();
    fx.frame(frameOf(1.1, []), out);
    expect(out.tris.n).toBeGreaterThan(0);
    expect(out.lit.n).toBeGreaterThan(0);
    expect(FX_KIND.MimicWake).not.toBe(FX_KIND.MimicLand);
  });

  it('a hidden mimic gets no cue', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, [], { hidden: [8], cues: [{ id: 8, x: 3, z: 3, land: false }] }), newOut());
    expect(fx.records).toBe(0);
  });

  it('a fall into a chasm makes one dust record at the rim; a hidden id none', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, [], { falls: [{ id: 5, x: 2.5, z: 1.5 }] }), newOut());
    expect(fx.records).toBe(1);
    const young = newOut();
    fx.frame(frameOf(1.1, []), young);
    expect(young.lit.n + young.tris.n).toBeGreaterThan(0);
    expect(young.lit.n).toBe(0);   // unlit: a lit mote beside the black chasm is nearly invisible
    expect(FX_LIFE[FX_KIND.RimDust]).toBe(0.6);
    const mid = newOut();
    fx.frame(frameOf(1.2, []), mid);   // all 12 motes alive (the shortest life is 0.35 s): a whole number of triangles per mote
    expect(mid.tris.n).toBeGreaterThan(0);
    expect(mid.tris.n % 12).toBe(0);
    const old = newOut();
    fx.frame(frameOf(1 + FX_LIFE[FX_KIND.RimDust] + 0.01, []), old);
    expect(old.lit.n + old.tris.n).toBe(0);
    const hid = new Effects3d(map);
    hid.frame(frameOf(1, [], { hidden: [5], falls: [{ id: 5, x: 2.5, z: 1.5 }] }), newOut());
    expect(hid.records).toBe(0);
  });

  it('a figure first listed late in its action gets no release spark', () => {
    for (const anim of [ANIM.Channel, ANIM.Cast]) {
      const fx = new Effects3d(map);
      fx.frame(frameOf(10, [fig(2, KIND.Wizard, { anim, animT: 0.5 })]), newOut());
      expect(fx.records).toBe(anim === ANIM.Channel ? 1 : 0);   // the channel's runes, no spark
      const out = newOut();
      fx.frame(frameOf(10.05, []), out);
      expect(out.tris.n).toBe(0);
    }
  });

  it('forgets the actions of figures no longer listed', () => {
    const fx = new Effects3d(map);
    const figs = Array.from({ length: 100 }, (_, i) => fig(100 + i, KIND.Wizard, { anim: ANIM.Cast, animT: 0.02 }));
    fx.frame(frameOf(10, figs), newOut());
    expect(fx.actions.size).toBe(100);
    fx.frame(frameOf(12, []), newOut());
    expect(fx.actions.size).toBe(100);
    fx.frame(frameOf(14, []), newOut());
    expect(fx.actions.size).toBe(0);
  });

  it('the drain draws a line to the lich per disciple', () => {
    const fx = new Effects3d(map), out = newOut();
    const snap = { drain: [[160, 160], [100, 100], [200, 100]] } as unknown as Partial<Snapshot>;
    fx.frame(frameOf(1, [fig(7, KIND.Lich)], { snap }), out);
    expect(out.tris.n).toBeGreaterThan(2 * 3 * 12 * 2);
  });
});

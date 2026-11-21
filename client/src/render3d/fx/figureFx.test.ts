import { newSmokeBuf } from './smoke';
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
import { ghost } from '../models/descs/ghost';
import type { SpectreSpec } from '../models/tubeDesc';
import type { DrawnFig, FxOut, MimicCue } from './types';

const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [], smoke: newSmokeBuf() });
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };

const fig = (id: number, kind: number, o: Partial<DrawnFig> = {}): DrawnFig => ({
  id, kind, x: 5, z: 5, top: 1, foot: 0, hand: [5.3, 0.6, 5], aim: 0, anim: ANIM.Idle, animT: 0, effects: 0, alpha: 1, dashing: false, model: false, side: 0, def: FIGURES[kind],
  yaw: 0, swingY: 0.6, arc: FIGURES[kind]?.swing?.arc ?? 0, bite: -1, spectre: null, form: 1, rig: null, ...o,
});

const ent = (id: number, kind: number, o: Partial<EntState> = {}): EntState => ({ id, kind, x: 80, y: 80, hp: 1, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: 1, entangled: 0, ...o });

const frameOf = (now: number, figs: DrawnFig[], o: { ents?: EntState[]; hidden?: number[]; snap?: Partial<Snapshot>; cues?: MimicCue[]; falls?: Array<{ id: number; x: number; z: number }> } = {}): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2, smokeTone: null },
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
    expect(young.tris.n).toBe(0);   // lit, like all dust
    expect(FX_LIFE[FX_KIND.RimDust]).toBe(0.6);
    const mid = newOut();
    fx.frame(frameOf(1.2, []), mid);   // all 12 motes alive (the shortest life is 0.35 s): a whole number of triangles per mote
    expect(mid.lit.n).toBeGreaterThan(0);
    expect(mid.lit.n % 12).toBe(0);
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

describe('a built figure\'s anchor points and lights (#358)', () => {
  type V3 = [number, number, number];
  const GEM: V3 = [6.5, 1.4, 4.2], EYES: V3 = [4.2, 0.9, 6.1], CHEST: V3 = [10.6, 2.2, 10.6];
  const raw = (T: FxTris): { pos: Float32Array } => T as unknown as { pos: Float32Array };
  const near = (T: FxTris, p: V3): number => {
    let best = Infinity;
    for (let i = 0; i < T.n * 3; i++) best = Math.min(best, Math.hypot(raw(T).pos[i * 3] - p[0], raw(T).pos[i * 3 + 1] - p[1], raw(T).pos[i * 3 + 2] - p[2]));
    return best;
  };
  const lich = (o: Partial<DrawnFig> = {}): DrawnFig => fig(5, KIND.Lich, o);

  it('the nova wind-up glow sits at the gem when it is set, at the staff tip otherwise', () => {
    const fx = new Effects3d(map), a = newOut(), b = newOut();
    fx.frame(frameOf(1, [lich({ anim: ANIM.Slam, animT: 0.1, gem: GEM })]), a);
    fx.frame(frameOf(1, [lich({ anim: ANIM.Slam, animT: 0.1 })]), b);
    expect(a.glows.n).toBe(1);
    expect(a.glows.foot.slice(0, 2)).toEqual([GEM[0], GEM[2]]);
    expect(b.glows.n).toBe(1);
    expect(b.glows.foot.slice(0, 2)).toEqual([5.3, 5]);
  });

  it('the gaze beam starts at the eyes when they are set', () => {
    const fx = new Effects3d(map), a = newOut(), b = newOut();
    const ents = [ent(5, KIND.Lich, { anim: ANIM.Gaze, extra: 6 })], target = fig(6, KIND.Paladin, { x: 8, z: 6 });
    fx.frame(frameOf(1, [lich({ anim: ANIM.Gaze, eyes: EYES }), target], { ents }), a);
    fx.frame(frameOf(1, [lich({ anim: ANIM.Gaze }), target], { ents }), b);
    expect(near(a.tris, EYES)).toBeLessThan(0.1);
    expect(near(b.tris, EYES)).toBeGreaterThan(0.5);
  });

  it('the drain line ends at the lich\'s chest when it is set', () => {
    const fx = new Effects3d(map), a = newOut(), b = newOut();
    const snap = { drain: [[160, 160], [100, 100]] } as unknown as Partial<Snapshot>;
    fx.frame(frameOf(1, [lich({ x: 10, z: 10, chest: CHEST })], { snap }), a);
    fx.frame(frameOf(1, [lich({ x: 10, z: 10 })], { snap }), b);
    expect(near(a.tris, CHEST)).toBeLessThan(0.3);
    expect(near(b.tris, CHEST)).toBeGreaterThan(1);
  });

  describe('the gem\'s and the skull\'s light', () => {
    const magic = { gem: 1, flare: 0 };
    const lights = (f: DrawnFig, o: { hidden?: number[] } = {}): FxOut['lights'] => {
      const out = newOut();
      new Effects3d(map).frame(frameOf(1, [f], o), out);
      return out.lights;
    };

    it('one light at the gem, a second at the eyes with a flare', () => {
      const one = lights(lich({ gem: GEM, eyes: EYES, magic }));
      expect(one.map((l) => l.id)).toEqual(['lg5']);
      // the lights sit at the true height: the anchors' stretched height (foot 0.2 here) is undone
      const st = 1 / Math.cos(cam.pitch);
      expect(st).toBeGreaterThan(1.5);
      const raised = lights(lich({ gem: GEM, eyes: EYES, magic: { gem: 1, flare: 1 }, foot: 0.2 }));
      expect([raised[0].x, raised[0].y, raised[0].z]).toEqual([GEM[0], 0.2 + (GEM[1] - 0.2) / st, GEM[2]]);
      expect([raised[1].x, raised[1].y, raised[1].z]).toEqual([EYES[0], 0.2 + (EYES[1] - 0.2) / st, EYES[2]]);
      expect([one[0].x, one[0].y, one[0].z]).toEqual([GEM[0], GEM[1] / st, GEM[2]]);
      expect(one[0].radius).toBe(2.5);
      expect(one[0].b).toBeCloseTo(0.6);
      const two = lights(lich({ gem: GEM, eyes: EYES, magic: { gem: 1, flare: 0.5 }, alpha: 0.5 }));
      expect(two.map((l) => l.id)).toEqual(['lg5', 'lf5']);
      expect([two[1].x, two[1].y, two[1].z]).toEqual([EYES[0], EYES[1] / st, EYES[2]]);
      expect(two[1].radius).toBe(3);
      expect(two[1].b).toBeCloseTo(0.8 * 0.5 * 0.5);
      expect(two[0].b).toBeCloseTo(0.6 * 0.5);
    });

    it('none for a hidden, a petrified or a faint figure, or one without magic', () => {
      const base = { gem: GEM, eyes: EYES };
      expect(lights(lich({ ...base, magic }), { hidden: [5] })).toHaveLength(0);
      expect(lights(lich({ ...base, magic, effects: 1 << EFFECT.Petrified }))).toHaveLength(0);
      expect(lights(lich({ ...base, magic, alpha: 0.02 }))).toHaveLength(0);
      expect(lights(lich(base))).toHaveLength(0);
    });

    it('a frozen figure\'s gem still shines', () => {
      expect(lights(lich({ gem: GEM, eyes: EYES, magic, effects: 1 << EFFECT.Frozen })).map((l) => l.id)).toEqual(['lg5']);
    });
  });
});

describe('spectre effects (#359)', () => {
  const SWOOSH = { colour: 0x2040a0, head: 0xf0e0d0 };
  const spec = (): SpectreSpec => ({ ...ghost.spectre!, swoosh: SWOOSH });
  const rgb = (c: number): number[] => [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => v / 255);
  const tris = (T: FxTris): { pos: Float32Array; col: Float32Array } => T as unknown as { pos: Float32Array; col: Float32Array };
  const melee = (o: Partial<DrawnFig> = {}): DrawnFig => fig(1, KIND.Ghost, { anim: ANIM.Melee, animT: 0.12, arc: 1.2, yaw: 0.4, ...o });

  it('a model\'s swoosh takes the spectre colours, at the swing\'s reach and the figure\'s arc; a card Ghost keeps the touch colour', () => {
    const fx = new Effects3d(map), out = newOut();
    fx.frame(frameOf(1, [melee({ model: true, spectre: spec() })]), out);
    const { pos, col } = tris(out.tris);
    expect(out.tris.n).toBeGreaterThan(0);
    const reach = FIGURES[KIND.Ghost].swing!.reach / 16;
    let far = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.tris.n * 3; i++) {
      const dx = pos[i * 3] - 5, dz = pos[i * 3 + 2] - 5;
      far = Math.max(far, Math.hypot(dx, dz));
      const a = Math.atan2(dz, dx) - 0.4;
      lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
    expect(far).toBeCloseTo(reach, 4);
    expect(hi - lo).toBeLessThanOrEqual(1.2 + 1e-6);
    // every colour lies between the base and the head colour; the base is there, and the head mixes in somewhere
    const base = rgb(SWOOSH.colour), head = rgb(SWOOSH.head), seen = new Set<string>();
    for (let i = 0; i < out.tris.n * 3; i++) {
      for (let k = 0; k < 3; k++) {
        expect(col[i * 4 + k]).toBeGreaterThanOrEqual(Math.min(base[k], head[k]) - 1e-3);
        expect(col[i * 4 + k]).toBeLessThanOrEqual(Math.max(base[k], head[k]) + 1e-3);
      }
      seen.add(`${col[i * 4].toFixed(3)},${col[i * 4 + 1].toFixed(3)},${col[i * 4 + 2].toFixed(3)}`);
    }
    expect(seen.has(base.map((v) => v.toFixed(3)).join())).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
    const card = newOut();
    fx.frame(frameOf(2, [melee()]), card);
    const want = rgb(FIGURES[KIND.Ghost].swing!.color ?? 0xfff8e0);
    expect(card.tris.n).toBeGreaterThan(0);
    for (let k = 0; k < 3; k++) expect(tris(card.tris).col[k]).toBeCloseTo(want[k], 3);
  });

  it('a halo adds one glow and one floor light of the spectre\'s colours', () => {
    const fx = new Effects3d(map), out = newOut();
    const s = spec(), h = s.halo!, peak = s.seeThrough!.peak;
    fx.frame(frameOf(1, [fig(3, KIND.Ghost, { model: true, spectre: s, alpha: 0.6 })]), out);
    expect(out.glows.n).toBe(1);
    const ys = out.glows.position.filter((_, i) => i % 3 === 1), xs = out.glows.position.filter((_, i) => i % 3 === 0);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(h.height / 16 / Math.cos(cam.pitch), 4);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(5, 4);
    const g = rgb(h.glow);
    for (let k = 0; k < 3; k++) expect(out.glows.color[k]).toBeCloseTo(g[k] * h.k * 0.6 / peak, 5);
    expect(out.lights.length).toBe(1);
    const L = out.lights[0], l = rgb(h.light);
    expect(L.id).toBe('gh3');
    expect(L.radius).toBe(h.radius);
    expect(L.shadow).toBe(false);
    expect(L.y).toBeCloseTo(5 / 16, 6);
    expect(L.r).toBeCloseTo(l[0] * 0.6 / peak, 5);
    expect(L.g).toBeCloseTo(l[1] * 0.6 / peak, 5);
    expect(L.b).toBeCloseTo(l[2] * 0.6 / peak, 5);
  });

  it('a faint, a hidden and a plain figure get no halo', () => {
    const fx = new Effects3d(map);
    const s = spec();
    const faint = newOut(), hidden = newOut(), plain = newOut();
    fx.frame(frameOf(1, [fig(3, KIND.Ghost, { model: true, spectre: s, alpha: 0.04 })]), faint);
    fx.frame(frameOf(1, [fig(3, KIND.Ghost, { model: true, spectre: s })], { hidden: [3] }), hidden);
    fx.frame(frameOf(1, [fig(4, KIND.Ghost)]), plain);
    for (const o of [faint, hidden, plain]) expect(o.glows.n + o.lights.length).toBe(0);
  });
});

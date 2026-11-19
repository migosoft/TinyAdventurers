import { beforeEach, describe, expect, it } from 'vitest';
import { ANIM, EFFECT, KIND } from '../../generated/defs';
import { FIGURES } from '../../game/anim/defs';
import { TileMap } from '../../sim/map';
import { newGlowBuf } from '../cards';
import { Effects3d, FX_KIND, clearFxRegistry, type FxFrame } from './effects3d';
import { VEIL_DEATH_LIFE } from '../../game/shadeHaze';
import type { SpectreSpec } from '../models/tubeDesc';
import { FOG } from './shadeFog';
import { clearVeils, registerStatus } from './status';
import { FxTris } from './tris';
import type { DrawnFig, FxOut } from './types';

const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [] });
const cam = { x: 5, z: 5, pitch: 0.9, yaw: 0.3 };
const bit = (...k: number[]): number => k.reduce((a, b) => a | (1 << b), 0);
const fig = (id: number, kind: number, effects: number, o: Partial<DrawnFig> = {}): DrawnFig => ({
  id, kind, x: 5, z: 5, top: 1, foot: 0, hand: [5.3, 0.6, 5], aim: 0, anim: ANIM.Idle, animT: 0, effects, alpha: 1, dashing: false, model: false, side: 0, def: FIGURES[kind],
  yaw: 0, swingY: 0.6, arc: 0, bite: -1, spectre: null, form: 1, ...o,
});
const frameOf = (now: number, figs: DrawnFig[], hidden: number[] = []): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs, ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(hidden), you: 0, ownCast: null,
});

beforeEach(() => { clearFxRegistry(); clearVeils(); registerStatus(); });

describe('status marks', () => {
  it('each status draws something, a plain figure nothing', () => {
    const fx = new Effects3d(map);
    const none = newOut();
    fx.frame(frameOf(1, [fig(1, KIND.Paladin, 0)]), none);
    expect(none.tris.n + none.lit.n).toBe(0);
    for (const e of [EFFECT.Blind, EFFECT.Burning, EFFECT.Frozen, EFFECT.Poisoned, EFFECT.Chilled, EFFECT.Singed, EFFECT.Weakened, EFFECT.Coated, EFFECT.Entangled, EFFECT.Warded]) {
      const out = newOut();
      // a few instants: a mote of a slot may be between two lives
      for (const t of [1, 1.3, 1.6, 1.9]) fx.frame(frameOf(t, [fig(1, KIND.Paladin, bit(e))]), out);
      expect(out.tris.n, `effect ${e}`).toBeGreaterThan(0);
    }
  });

  it('marks skip hidden figures', () => {
    const fx = new Effects3d(map), out = newOut();
    fx.frame(frameOf(1, [fig(1, KIND.Paladin, bit(EFFECT.Burning, EFFECT.Frozen, EFFECT.Warded))], [1]), out);
    expect(out.tris.n + out.lit.n).toBe(0);
    expect(out.lights.length).toBe(0);
  });

  it('burning light for the nearest three only', () => {
    const fx = new Effects3d(map), out = newOut();
    const figs = [0, 1, 2, 3, 4].map((i) => fig(10 + i, KIND.Paladin, bit(EFFECT.Burning), { x: 5 + i * 2, z: 5 }));
    fx.frame(frameOf(1, figs), out);
    expect(out.lights.length).toBe(3);
    expect(out.lights.map((l) => l.x).sort((a, b) => a - b)).toEqual([5, 7, 9]);
  });

  it('a burning figure standing in a dip has its light and flames lowered by its foot height (#324)', () => {
    const at = (foot: number) => {
      const fx = new Effects3d(map), out = newOut();
      fx.frame(frameOf(1, [fig(1, KIND.Paladin, bit(EFFECT.Burning), { foot })]), out);
      return out;
    };
    const dry = at(0), wet = at(-1.2);
    expect(wet.lights[0].y).toBeCloseTo(dry.lights[0].y - 1.2, 6);
    const ys = (o: FxOut): number[] => {
      const a: number[] = [];
      for (const t of [o.tris, o.lit]) { const pos = (t as unknown as { pos: Float32Array }).pos; for (let i = 0; i < t.n; i++) a.push(...[1, 4, 7].map((k) => pos[i * 9 + k])); }
      return a;
    };
    const dy = ys(dry), wy = ys(wet);
    expect(wy.length).toBe(dy.length);
    expect(wy.length).toBeGreaterThan(0);
    for (let i = 0; i < dy.length; i++) expect(wy[i]).toBeCloseTo(dy[i] - 1.2, 5);
  });

  it('a hidden burning figure adds no light and does not take a place', () => {
    const fx = new Effects3d(map), out = newOut();
    const figs = [0, 1, 2, 3].map((i) => fig(10 + i, KIND.Paladin, bit(EFFECT.Burning), { x: 5 + i, z: 5 }));
    fx.frame(frameOf(1, figs, [10]), out);
    expect(out.lights.length).toBe(3);
    expect(out.lights.every((l) => l.x > 5)).toBe(true);
  });

  it('entangled vines draw more than the plain bands', () => {
    const fx = new Effects3d(map);
    const plain = newOut(), vines = newOut();
    const f = (look: number): FxFrame => {
      const fr = frameOf(1, [fig(1, KIND.Paladin, bit(EFFECT.Entangled))]);
      fr.ents = new Map([[1, { id: 1, kind: KIND.Paladin, x: 80, y: 80, hp: 1, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: 0, entangled: look }]]);
      return fr;
    };
    fx.frame(f(0), plain);
    fx.frame(f(1), vines);
    expect(vines.tris.n).toBeGreaterThan(plain.tris.n);
  });

  it('a shade that died out of sight dissolves at its death spot, not where it was last seen', () => {
    const fx = new Effects3d(map);
    for (let i = 0; i < 10; i++) fx.frame(frameOf(1 + i * 0.05, [fig(7, KIND.Shade, 0, { x: 5, z: 5 })]), newOut());
    // hidden for a second (its veil is not updated), then it dies elsewhere (tile 12, 12)
    for (let i = 0; i < 20; i++) fx.frame(frameOf(1.5 + i * 0.05, [fig(7, KIND.Shade, 0, { x: 5, z: 5 })], [7]), newOut());
    fx.event({ t: 'Died', id: 7, x: 12 * 16, y: 12 * 16, kind: KIND.Shade } as never, 2.6, false);
    const out = newOut();
    fx.frame(frameOf(2.7, []), out);
    expect(out.tris.n).toBeGreaterThan(0);
    const fb = { position: [] as number[], rgba: [] as number[], n: 0 };
    out.tris.flush(fb as never, cam, false);
    const xs = fb.position.filter((_, i) => i % 3 === 0), zs = fb.position.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBeGreaterThan(9);
    expect(Math.min(...zs)).toBeGreaterThan(9);
  });

  it('the shade wears a veil, and a dead one dissolves for a second', () => {
    const fx = new Effects3d(map);
    const out = newOut();
    for (let i = 0; i < 20; i++) fx.frame(frameOf(1 + i * 0.05, [fig(7, KIND.Shade, 0)]), out);
    expect(out.tris.n).toBeGreaterThan(0);
    fx.event({ t: 'Died', id: 7, x: 80, y: 80, kind: KIND.Shade } as never, 2, false);
    expect(fx.records).toBe(1);
    const dying = newOut();
    fx.frame(frameOf(2.3, []), dying);
    expect(dying.tris.n).toBeGreaterThan(0);
    const gone = newOut();
    fx.frame(frameOf(3.2, []), gone);
    expect(gone.tris.n).toBe(0);
    expect(fx.records).toBe(0);
    expect(FX_KIND.ShadeVeil).toBeDefined();
  });
});

describe('the Shade model\'s fog', () => {
  const SPEC: SpectreSpec = { eyes: { y: 15, z: 1, front: 1, half: [1, 0.5], slant: 0, core: 0xffffff, ring: 0xffffff, strength: 1 }, fog: true, swoosh: { colour: 0 } };
  const model = (id: number, o: Partial<DrawnFig> = {}): DrawnFig => fig(id, KIND.Shade, 0, { model: true, spectre: SPEC, ...o });
  const FULL = FOG.patches * FOG.segs * 3;
  const pos = (T: FxTris): Float32Array => (T as unknown as { pos: Float32Array }).pos;
  const col = (T: FxTris): Float32Array => (T as unknown as { col: Float32Array }).col;
  /** The largest alpha of a drawn list. */
  const peak = (T: FxTris): number => { let m = 0; for (let i = 0; i < T.n * 3; i++) m = Math.max(m, col(T)[i * 4 + 3]); return m; };

  it('a model Shade draws fog and no strands; a card Shade draws strands', () => {
    const fx = new Effects3d(map);
    for (let i = 0; i < 5; i++) fx.frame(frameOf(1 + i * 0.05, [model(7)]), newOut());
    const out = newOut();
    fx.frame(frameOf(1.3, [model(7)]), out);
    expect(out.tris.n).toBe(FULL);
    clearVeils();
    let card = newOut();
    for (let i = 0; i < 5; i++) { card = newOut(); fx.frame(frameOf(5 + i * 0.05, [fig(8, KIND.Shade, 0)]), card); }
    expect(card.tris.n).toBeGreaterThan(0);
    expect(card.tris.n).not.toBe(FULL);
  });

  it('not seen for over 3 s, then drawn 5 tiles away: the fog starts at the new spot', () => {
    const fx = new Effects3d(map);
    for (let i = 0; i < 5; i++) fx.frame(frameOf(1 + i * 0.05, [model(7)]), newOut());
    const out = newOut();
    fx.frame(frameOf(6, [model(7, { x: 10 })]), out);
    const p = pos(out.tris);
    for (let i = 0; i < out.tris.n * 3; i++) {
      expect(Math.abs(p[i * 3] - 10)).toBeLessThan(1.5);
      expect(Math.abs(p[i * 3 + 2] - 5)).toBeLessThan(1.5);
    }
  });

  it('a jump of over a tile also starts the fog at the new spot', () => {
    const fx = new Effects3d(map);
    for (let i = 0; i < 5; i++) fx.frame(frameOf(1 + i * 0.05, [model(7)]), newOut());
    const out = newOut();
    fx.frame(frameOf(1.25, [model(7, { x: 8 })]), out);
    const p = pos(out.tris);
    for (let i = 0; i < out.tris.n * 3; i++) expect(Math.abs(p[i * 3] - 8)).toBeLessThan(1.5);
  });

  it('a pinned clock repeats the picture', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, [model(7)]), newOut());
    const a = newOut(), b = newOut();
    fx.frame(frameOf(1.2, [model(7)]), a);
    fx.frame(frameOf(1.2, [model(7)]), b);
    expect(Array.from(pos(b.tris).slice(0, 90))).toEqual(Array.from(pos(a.tris).slice(0, 90)));
  });

  it('fog whose Shade left the frame fades over FOG.fade s at its last place, and a hidden one shows none', () => {
    const fx = new Effects3d(map);
    for (let i = 0; i < 5; i++) fx.frame(frameOf(1 + i * 0.05, [model(7)]), newOut());
    const live = newOut();
    fx.frame(frameOf(1.2, [model(7)]), live);
    const early = newOut();
    fx.frame(frameOf(1.2 + FOG.fade / 2, []), early);
    expect(early.tris.n).toBe(FULL);
    expect(peak(early.tris)).toBeLessThan(peak(live.tris));
    expect(peak(early.tris)).toBeGreaterThan(0);
    const late = newOut();
    fx.frame(frameOf(1.2 + FOG.fade + 0.05, []), late);
    expect(late.tris.n).toBe(0);
    const fx2 = new Effects3d(map);
    for (let i = 0; i < 5; i++) fx2.frame(frameOf(1 + i * 0.05, [model(7)], [7]), newOut());
    const hid = newOut();
    fx2.frame(frameOf(1.3, [model(7)], [7]), hid);
    expect(hid.tris.n).toBe(0);
  });

  it('a dying model Shade\'s fog spreads and thins; one never seen falls back to a resting fog; no fog, strands', () => {
    const fx = new Effects3d(map);
    for (let i = 0; i < 20; i++) fx.frame(frameOf(1 + i * 0.05, [model(7)]), newOut());
    const live = newOut();
    fx.frame(frameOf(1.95, [model(7)]), live);
    fx.event({ t: 'Died', id: 7, x: 80, y: 80, kind: KIND.Shade } as never, 2, false);
    const d1 = newOut(), d2 = newOut();
    fx.frame(frameOf(2.2, []), d1);
    fx.frame(frameOf(2.6, []), d2);
    expect(d1.tris.n).toBe(FULL);
    expect(peak(d1.tris)).toBeCloseTo(FOG.alpha[1] * (1 - 0.2 / VEIL_DEATH_LIFE), 3);
    expect(peak(d2.tris)).toBeCloseTo(FOG.alpha[1] * (1 - 0.6 / VEIL_DEATH_LIFE), 3);
    // a Shade of another id that died unseen: a resting fog at the record's spot
    fx.event({ t: 'Died', id: 99, x: 12 * 16, y: 12 * 16, kind: KIND.Shade } as never, 3, false);
    const rest = newOut();
    fx.frame(frameOf(3.2, []), rest);
    expect(rest.tris.n).toBe(FULL);
    const p = pos(rest.tris);
    for (let i = 0; i < rest.tris.n * 3; i++) expect(Math.abs(p[i * 3] - 12)).toBeLessThan(2.5);
  });

  it('a session without fogs keeps the strands for a dead card Shade', () => {
    const fx = new Effects3d(map);
    fx.event({ t: 'Died', id: 5, x: 80, y: 80, kind: KIND.Shade } as never, 1, false);
    const out = newOut();
    fx.frame(frameOf(1.2, []), out);
    expect(out.tris.n).toBeGreaterThan(0);
    expect(out.tris.n).not.toBe(FOG.patches * FOG.segs * 3);
  });
});

import { newSmokeBuf, SMOKE, Smoke, type SmokeBuf } from './smoke';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANIM, EFFECT, KIND } from '../../generated/defs';
import { FIGURES } from '../../game/anim/defs';
import { TILE, TileMap } from '../../sim/map';
import { newGlowBuf } from '../cards';
import { Effects3d, FX_KIND, clearFxRegistry, type FxFrame } from './effects3d';
import { VEIL_DEATH_LIFE } from '../../game/shadeHaze';
import { SMOKE_TONES } from '../models/tubeDesc';
import { shade } from '../models/descs/shade';
import { buildTubeFigure } from '../models/tubeModel';
import { copyPose, restPose } from '../models/pose3d';
import { BONES } from '../models/bones';
import { skinVertex } from '../models/rig';
import { SPECTRE_FORM } from '../figures';
import { smooth } from './shapes';
import { clearVeils, registerStatus, SMOKE_FRAME, SMOKES, smokePlace } from './status';
import { FxTris } from './tris';
import type { DrawnFig, FxOut } from './types';

const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [], smoke: newSmokeBuf() });
const cam = { x: 5, z: 5, pitch: 0.9, yaw: 0.3 };
const bit = (...k: number[]): number => k.reduce((a, b) => a | (1 << b), 0);
const fig = (id: number, kind: number, effects: number, o: Partial<DrawnFig> = {}): DrawnFig => ({
  id, kind, x: 5, z: 5, top: 1, foot: 0, hand: [5.3, 0.6, 5], aim: 0, anim: ANIM.Idle, animT: 0, effects, alpha: 1, dashing: false, model: false, side: 0, def: FIGURES[kind],
  yaw: 0, swingY: 0.6, arc: 0, bite: -1, spectre: null, form: 1, rig: null, ...o,
});
const frameOf = (now: number, figs: DrawnFig[], hidden: number[] = []): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2, smokeTone: null },
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

describe('the Shade model\'s smoke (#359)', () => {
  const SPEC = shade.spectre!;
  const M = buildTubeFigure('shade', shade);
  const RIG = { pose: restPose(M, 0), scale: M.scale, lift: 0 };
  const PXW = M.scale / TILE;
  const model = (id: number, o: Partial<DrawnFig> = {}): DrawnFig => fig(id, KIND.Shade, 0, { model: true, spectre: SPEC, rig: RIG, ...o });
  afterEach(() => { vi.restoreAllMocks(); });

  /** Quad `k` of a smoke buffer: its centre (corners 0 and 2) and its alpha. */
  const centre = (o: SmokeBuf, k: number): number[] => [0, 1, 2].map((a) => (o.position[(k * 6) * 3 + a] + o.position[(k * 6 + 2) * 3 + a]) / 2);
  const alphaOf = (o: SmokeBuf, k: number): number => o.rgba[k * 24 + 3];
  const quads = (o: SmokeBuf): number => o.n / 2;
  const peak = (o: SmokeBuf): number => { let m = 0; for (let k = 0; k < quads(o); k++) m = Math.max(m, alphaOf(o, k)); return m; };
  const run = (fx: Effects3d, t0: number, n: number, figs: (t: number) => DrawnFig[], dt = 0.05): void => {
    for (let i = 0; i < n; i++) fx.frame(frameOf(t0 + i * dt, figs(t0 + i * dt)), newOut());
  };

  it('a model Shade writes smoke and no strands; a card Shade writes strands and no smoke', () => {
    const fx = new Effects3d(map);
    run(fx, 1, 5, () => [model(7)]);
    const out = newOut();
    fx.frame(frameOf(1.3, [model(7)]), out);
    expect(out.smoke.n).toBeGreaterThan(0);
    expect(out.tris.n).toBe(0);
    clearVeils();
    const card = newOut();
    for (let i = 0; i < 5; i++) fx.frame(frameOf(5 + i * 0.05, [fig(8, KIND.Shade, 0)]), i === 4 ? card : newOut());
    expect(card.tris.n).toBeGreaterThan(0);
    expect(card.smoke.n).toBe(0);
  });

  it('every quad is finite and at the body, the spine included (bone -1 is the hips\' matrix), whatever the yaw', () => {
    const fx = new Effects3d(map), out = newOut();
    fx.frame(frameOf(1, [model(7, { yaw: 1.2 })]), newOut());
    fx.frame(frameOf(1.05, [model(7, { yaw: 1.2 })]), out);
    expect(out.smoke.n).toBeGreaterThan(0);
    expect(out.smoke.position.every(Number.isFinite)).toBe(true);
    for (let k = 0; k < quads(out.smoke); k++) {
      const c = centre(out.smoke, k);
      expect(Math.hypot(c[0] - 5, c[2] - 5), `quad ${k}`).toBeLessThan(1.5);
      expect(c[1]).toBeGreaterThan(-0.2);
      expect(c[1]).toBeLessThan(2);
    }
  });

  it('steps the smoke by the body\'s move between two frames 1/60 s apart', () => {
    const spy = vi.spyOn(Smoke.prototype, 'step');
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, [model(7, { x: 5 })]), newOut());
    fx.frame(frameOf(1 + 1 / 60, [model(7, { x: 5.04, z: 5.01 })]), newOut());
    expect(spy).toHaveBeenCalledTimes(1);
    const a = spy.mock.calls[0];
    expect(a[0]).toBeCloseTo(1 / 60, 9);
    expect(a[3]).toBeCloseTo(PXW, 9);
    expect(a[4][0]).toBeCloseTo(0.04, 9);
    expect(a[4][1]).toBeCloseTo(0.01, 9);
  });

  it('not seen for over 3 s, then drawn 5 tiles away: every quad of the first frame is at the new spot', () => {
    const fx = new Effects3d(map);
    run(fx, 1, 5, () => [model(7)]);
    const out = newOut();
    fx.frame(frameOf(1.2 + SMOKE_FRAME.gap + 0.5, [model(7, { x: 10 })]), out);
    expect(out.smoke.n).toBeGreaterThan(0);
    for (let k = 0; k < quads(out.smoke); k++) expect(Math.hypot(centre(out.smoke, k)[0] - 10, centre(out.smoke, k)[2] - 5), `quad ${k}`).toBeLessThan(1.5);
  });

  it('a move of 2 tiles in one frame also puts every quad at the new spot in that frame', () => {
    const fx = new Effects3d(map);
    run(fx, 1, 5, () => [model(7)]);
    const out = newOut();
    fx.frame(frameOf(1.25, [model(7, { x: 7 })]), out);
    for (let k = 0; k < quads(out.smoke); k++) expect(Math.hypot(centre(out.smoke, k)[0] - 7, centre(out.smoke, k)[2] - 5), `quad ${k}`).toBeLessThan(1.5);
  });

  it('a clock that ran back also restarts the smoke at the place', () => {
    const fx = new Effects3d(map);
    run(fx, 5, 5, () => [model(7)]);
    const spy = vi.spyOn(Smoke.prototype, 'settle');
    fx.frame(frameOf(1, [model(7, { x: 9 })]), newOut());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each([EFFECT.Petrified, EFFECT.Frozen])('a figure with effect %i holds its smoke: the quads of two frames one second apart are identical', (e) => {
    const fx = new Effects3d(map);
    run(fx, 1, 5, () => [model(7)]);
    const f = (): DrawnFig => model(7, { effects: bit(e) });
    fx.frame(frameOf(1.3, [f()]), newOut());
    const a = newOut(), b = newOut();
    fx.frame(frameOf(1.4, [f()]), a);
    fx.frame(frameOf(2.4, [f()]), b);
    expect(a.smoke.n).toBeGreaterThan(0);
    expect(b.smoke.position).toEqual(a.smoke.position);
    expect(b.smoke.rgba).toEqual(a.smoke.rgba);
    expect(b.smoke.c).toEqual(a.smoke.c);
  });

  it('a pinned clock repeats the picture', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, [model(7)]), newOut());
    const a = newOut(), b = newOut();
    fx.frame(frameOf(1.2, [model(7)]), a);
    fx.frame(frameOf(1.2, [model(7)]), b);
    expect(b.smoke.position).toEqual(a.smoke.position);
    expect(b.smoke.c).toEqual(a.smoke.c);
  });

  it('the clock the quads carry advances by the frame time, and by half of it asleep', () => {
    const clockAt = (effects: number): number => {
      clearVeils();
      const fx = new Effects3d(map), a = newOut(), b = newOut();
      fx.frame(frameOf(1, [model(7, { effects })]), a);
      fx.frame(frameOf(1.05, [model(7, { effects })]), b);
      return b.smoke.c[3] - a.smoke.c[3];
    };
    expect(clockAt(0)).toBeCloseTo(0.05 * SMOKE.clock, 9);
    expect(clockAt(bit(EFFECT.Sleep))).toBeCloseTo(0.025 * SMOKE.clock, 9);
  });

  it('a figure\'s alpha scales every quad, and a hidden id writes none', () => {
    const fx = new Effects3d(map);
    run(fx, 1, 5, () => [model(7)]);
    const full = newOut(), half = newOut();
    fx.frame(frameOf(1.3, [model(7)]), full);
    fx.frame(frameOf(1.3, [model(7, { alpha: 0.5 })]), half);
    expect(half.smoke.n).toBe(full.smoke.n);
    for (let k = 0; k < quads(full.smoke); k++) expect(alphaOf(half.smoke, k)).toBeCloseTo(alphaOf(full.smoke, k) * 0.5, 6);
    const fx2 = new Effects3d(map), hid = newOut();
    run(fx2, 1, 5, () => [model(7)]);
    fx2.frame(frameOf(1.3, [model(7)], [7]), hid);
    expect(hid.smoke.n).toBe(0);
  });

  it('writes the Shades far to near', () => {
    // along the screen's up axis on the ground (away from the camera): the one with the larger depth is the far one
    const up: [number, number] = [Math.sin(cam.yaw), -Math.cos(cam.yaw)];
    const far = model(1, { x: 5 + up[0] * 2, z: 5 + up[1] * 2 }), near = model(2, { x: 5 - up[0] * 2, z: 5 - up[1] * 2 });
    for (const order of [[far, near], [near, far]]) {
      clearVeils();
      const fx = new Effects3d(map), out = newOut();
      fx.frame(frameOf(1, order), newOut());
      fx.frame(frameOf(1.05, order), out);
      const per = quads(out.smoke) / 2, depth = (k: number): number => { const c = centre(out.smoke, k); return c[0] * up[0] + c[2] * up[1]; };
      expect(depth(0)).toBeGreaterThan(depth(per));
    }
  });

  it('ctx.smokeTone sets the second tone: purple wisps are purple, the black stays black', () => {
    const fx = new Effects3d(map);
    run(fx, 1, 20, () => [model(7)]);
    const fr = frameOf(2, [model(7)]);
    fr.ctx.smokeTone = SMOKE_TONES.purple;
    const out = newOut();
    fx.frame(fr, out);
    let purple = 0;
    for (let k = 0; k < quads(out.smoke); k++) {
      const r = out.smoke.rgba[k * 24], g = out.smoke.rgba[k * 24 + 1], b = out.smoke.rgba[k * 24 + 2];
      if (r + g + b > 0.03) { purple++; expect(b, `quad ${k}`).toBeGreaterThan(g); }
    }
    expect(purple).toBeGreaterThan(0);
  });

  it('smoke whose Shade left the frame (no death) fades over SMOKE_FRAME.fade s at its place, and a hidden one shows none', () => {
    const fx = new Effects3d(map);
    run(fx, 1, 5, () => [model(7)]);
    const live = newOut();
    fx.frame(frameOf(1.2, [model(7)]), live);
    const early = newOut();
    fx.frame(frameOf(1.2 + SMOKE_FRAME.fade / 2, []), early);
    expect(early.smoke.n).toBe(live.smoke.n);
    expect(peak(early.smoke)).toBeCloseTo(peak(live.smoke) * 0.5, 3);
    for (let k = 0; k < quads(early.smoke); k++) expect(Math.hypot(centre(early.smoke, k)[0] - 5, centre(early.smoke, k)[2] - 5)).toBeLessThan(1.5);
    const late = newOut();
    fx.frame(frameOf(1.2 + SMOKE_FRAME.fade + 0.05, []), late);
    expect(late.smoke.n).toBe(0);
    const fx2 = new Effects3d(map), hid = newOut();
    run(fx2, 1, 5, () => [model(7)]);
    fx2.frame(frameOf(1.3, [model(7)], [7]), hid);
    expect(hid.smoke.n).toBe(0);
  });

  it('smoke whose Shade left the frame is stepped on while it fades: its clock runs, its wisps move, its alpha falls; then it is forgotten', () => {
    const fx = new Effects3d(map);
    run(fx, 1, 5, () => [model(7)]);
    fx.frame(frameOf(1.2, [model(7)]), newOut());
    const a = newOut(), b = newOut(), c = newOut();
    fx.frame(frameOf(1.25, []), a);
    fx.frame(frameOf(1.35, []), b);
    expect(a.smoke.n).toBeGreaterThan(0);
    expect(b.smoke.c[3] - a.smoke.c[3]).toBeCloseTo(0.1 * SMOKE.clock, 9);
    const k0 = Math.round(quads(a.smoke) * 0.9);   // a wisp quad
    expect(centre(b.smoke, k0)).not.toEqual(centre(a.smoke, k0));
    expect(peak(b.smoke)).toBeLessThan(peak(a.smoke));
    expect(a.smoke.position.every(Number.isFinite) && b.smoke.position.every(Number.isFinite)).toBe(true);
    fx.frame(frameOf(1.2 + SMOKE_FRAME.fade + 0.05, []), c);
    expect(c.smoke.n).toBe(0);
    expect(SMOKES.has(7)).toBe(false);
  });

  it('the fading smoke of a Shade that left is written in the same far-to-near order as the live ones', () => {
    const up: [number, number] = [Math.sin(cam.yaw), -Math.cos(cam.yaw)];
    const at = (d: number, id: number): DrawnFig => model(id, { x: 5 + up[0] * d, z: 5 + up[1] * d });
    const depthAt = (o: SmokeBuf, k: number): number => { const c = centre(o, k); return c[0] * up[0] + c[2] * up[1]; };
    for (const [gone, live] of [[-2, 2], [2, -2]]) {
      clearVeils();
      const fx = new Effects3d(map);
      fx.frame(frameOf(1, [at(gone, 1), at(live, 2)]), newOut());
      fx.frame(frameOf(1.05, [at(gone, 1), at(live, 2)]), newOut());
      const out = newOut();
      fx.frame(frameOf(1.1, [at(live, 2)]), out);
      const per = quads(out.smoke) / 2;
      expect(depthAt(out.smoke, 0), `gone at ${gone}`).toBeGreaterThan(depthAt(out.smoke, per));
    }
  });

  it('places a point of a bone as skinVertex does, then the yaw, the camera\'s stretch and the lift (a head vertex, yaw 1.2, a moved root)', () => {
    const pose = copyPose(restPose(M, 0));
    pose.root.x = 2; pose.root.y = 5; pose.root.z = -1;
    const rig = { pose, scale: M.scale, lift: 0.3 }, yaw = 1.2, st = 1 / Math.cos(cam.pitch), head = BONES.indexOf('head');
    let v = -1;
    for (let i = 0; i < M.skin.length / 4 && v < 0; i++) if (M.skin[i * 4] === head && M.skin[i * 4 + 2] < 0) v = i;
    expect(v).toBeGreaterThanOrEqual(0);
    const sv: [number, number, number] = [0, 0, 0], out: [number, number, number] = [0, 0, 0];
    skinVertex(M, pose, v, sv);
    smokePlace(rig, 5, 6, yaw, st, head, [M.position[v * 3], M.position[v * 3 + 1], M.position[v * 3 + 2]], out);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    expect(out[0]).toBeCloseTo(5 + (sv[0] * c - sv[2] * s) / TILE, 3);
    expect(out[1]).toBeCloseTo((sv[1] / TILE) * st + 0.3, 3);
    expect(out[2]).toBeCloseTo(6 + (sv[0] * s + sv[2] * c) / TILE, 3);
  });

  it('the drawer puts the head\'s carried-smoke patch where the head bone is (hips matrix for the spine), at yaw 1.2', () => {
    const pose = copyPose(restPose(M, 0));
    pose.root.x = 2; pose.root.y = 5; pose.root.z = -1;
    const rig = { pose, scale: M.scale, lift: 0.3 }, st = 1 / Math.cos(cam.pitch);
    const fx = new Effects3d(map), out = newOut();
    fx.frame(frameOf(1, [model(7, { yaw: 1.2, rig, x: 5, z: 6 })]), out);
    const sm = SMOKES.get(7)!.smoke, head = BONES.indexOf('head');
    const idx = sm.core.findIndex((c) => c.on && c.bone === head);
    const k = sm.core.slice(0, idx).filter((c) => c.patch).length;
    const on = sm.core[idx];
    const want: [number, number, number] = [0, 0, 0];
    smokePlace(rig, 5, 6, 1.2, st, head, on.local, want);
    const got = centre(out.smoke, k);
    for (let a = 0; a < 3; a++) expect(got[a]).toBeCloseTo(want[a], 3);
    // the spine's first point is the hips' matrix: finite and near the body
    const hips: [number, number, number] = [0, 0, 0];
    smokePlace(rig, 5, 6, 1.2, st, -1, sm.core[0].local, hips);
    expect(hips.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(hips[0] - 5, hips[2] - 6)).toBeLessThan(1);
  });

  it('forms out of its pool: the first frame at form 0 is invisible and low; the parts\' alpha follows SPECTRE_FORM', () => {
    const fx = new Effects3d(map), out = newOut();
    fx.frame(frameOf(1, [model(7, { form: 0 })]), out);
    expect(peak(out.smoke)).toBe(0);
    const settled = new Effects3d(map);
    clearVeils();
    const spy = vi.spyOn(Smoke.prototype, 'settle');
    settled.frame(frameOf(1, [model(7, { form: 0.3 })]), newOut());
    expect(spy.mock.calls[0][5]).toBeCloseTo(smooth(SPECTRE_FORM.body[0], SPECTRE_FORM.body[1], 0.3), 9);
    spy.mockClear();
    settled.frame(frameOf(1.05, [model(7, { form: 0.7 })]), newOut());
    const step = vi.spyOn(Smoke.prototype, 'step');
    settled.frame(frameOf(1.1, [model(7, { form: 0.7 })]), newOut());
    expect(step.mock.calls[0][6]).toBeCloseTo(smooth(SPECTRE_FORM.body[0], SPECTRE_FORM.body[1], 0.7), 9);
  });

  describe('in death', () => {
    const live = (fx: Effects3d, n = 20): SmokeBuf => {
      let out = newOut();
      for (let i = 0; i < n; i++) { out = newOut(); fx.frame(frameOf(1 + i * 0.05, [model(7)]), out); }
      return out.smoke;
    };

    it('a dying Shade\'s smoke spreads, thins by VEIL_DEATH_LIFE and swells, with no strands', () => {
      const fx = new Effects3d(map);
      const alive = live(fx);
      fx.event({ t: 'Died', id: 7, x: 80, y: 80, kind: KIND.Shade } as never, 2, false);
      const d1 = newOut(), d2 = newOut();
      fx.frame(frameOf(2.2, []), d1);
      fx.frame(frameOf(2.6, []), d2);
      expect(d1.tris.n).toBe(0);
      expect(d1.smoke.n).toBe(alive.n);
      expect(peak(d1.smoke)).toBeCloseTo(peak(alive) * (1 - 0.2 / VEIL_DEATH_LIFE), 3);
      expect(peak(d2.smoke)).toBeCloseTo(peak(alive) * (1 - 0.6 / VEIL_DEATH_LIFE), 3);
      // the first core patch is `1 + 0.6 * age` times as wide as it was alive (its wobble moves with the clock, which runs on: under 0.5 %)
      const width = (o: SmokeBuf): number => Math.hypot(o.position[3] - o.position[0], o.position[4] - o.position[1], o.position[5] - o.position[2]);
      expect(width(d1.smoke) / width(alive)).toBeCloseTo(1 + 0.6 * 0.2, 2);
    });

    it('the smoke\'s clock runs on while it spreads, except for a petrified or frozen body', () => {
      const clockIn = (effects: number): number => {
        clearVeils();
        const fx = new Effects3d(map);
        for (let i = 0; i < 5; i++) fx.frame(frameOf(1 + i * 0.05, [model(7, { effects })]), newOut());
        fx.event({ t: 'Died', id: 7, x: 80, y: 80, kind: KIND.Shade } as never, 1.2, false);
        const a = newOut(), b = newOut();
        fx.frame(frameOf(1.25, []), a);
        fx.frame(frameOf(1.3, []), b);
        return b.smoke.c[3] - a.smoke.c[3];
      };
      expect(clockIn(0)).toBeCloseTo(0.05 * SMOKE.clock, 9);
      expect(clockIn(bit(EFFECT.Petrified))).toBe(0);
      expect(clockIn(bit(EFFECT.Frozen))).toBe(0);
    });

    it('spreads outward SMOKE.death.spread px a second', () => {
      const fx = new Effects3d(map);
      live(fx);
      fx.event({ t: 'Died', id: 7, x: 80, y: 80, kind: KIND.Shade } as never, 2, false);
      const m = SMOKES.get(7)!;
      const mean = (): number => m.smoke.core.reduce((a, c) => a + Math.hypot(c.x - m.x, c.z - m.z), 0) / m.smoke.core.length;
      fx.frame(frameOf(2, []), newOut());
      const d0 = mean();
      for (let i = 1; i <= 5; i++) fx.frame(frameOf(2 + i * 0.1, []), newOut());
      expect(mean() - d0).toBeCloseTo(SMOKE.death.spread * 0.5 * PXW, 4);
    });

    it('a Shade of another id that died unseen: a settled smoke at the record\'s spot, spreading the same way', () => {
      const fx = new Effects3d(map);
      live(fx);
      fx.event({ t: 'Died', id: 99, x: 12 * 16, y: 12 * 16, kind: KIND.Shade } as never, 3, false);
      const r1 = newOut(), r2 = newOut();
      fx.frame(frameOf(3.2, []), r1);
      fx.frame(frameOf(3.5, []), r2);
      expect(r1.smoke.n).toBeGreaterThan(0);
      for (let k = 0; k < quads(r1.smoke); k++) {
        const c = centre(r1.smoke, k);
        expect(Math.hypot(c[0] - 12, c[2] - 12), `quad ${k}`).toBeLessThan(2);
      }
      expect(peak(r1.smoke)).toBeCloseTo(SMOKE.core.alpha * (1 - 0.2 / VEIL_DEATH_LIFE), 3);
      expect(peak(r2.smoke)).toBeCloseTo(SMOKE.core.alpha * (1 - 0.5 / VEIL_DEATH_LIFE), 3);
    });

    it('a Shade killed part-formed starts its death smoke at the alpha it had alive', () => {
      const fx = new Effects3d(map);
      for (let i = 0; i < 10; i++) fx.frame(frameOf(1 + i * 0.05, [model(7, { form: 0.2 })]), newOut());
      const alive = newOut();
      fx.frame(frameOf(1.5, [model(7, { form: 0.2 })]), alive);
      fx.event({ t: 'Died', id: 7, x: 80, y: 80, kind: KIND.Shade } as never, 1.55, false);
      const dying = newOut();
      fx.frame(frameOf(1.6, []), dying);
      expect(peak(alive.smoke)).toBeLessThan(SMOKE.core.alpha * 0.9);
      expect(peak(dying.smoke)).toBeCloseTo(peak(alive.smoke) * (1 - 0.05 / VEIL_DEATH_LIFE), 3);
    });

    it('a card Shade that dies beside a model Shade keeps its strands and adds no smoke', () => {
      const alone = new Effects3d(map);
      for (let i = 0; i < 20; i++) alone.frame(frameOf(1 + i * 0.05, [fig(8, KIND.Shade, 0, { x: 7 })]), newOut());
      alone.event({ t: 'Died', id: 8, x: 7 * 16, y: 80, kind: KIND.Shade } as never, 2, false);
      const strands = newOut();
      alone.frame(frameOf(2.1, []), strands);
      expect(strands.tris.n).toBeGreaterThan(0);
      clearVeils();
      const fx = new Effects3d(map);
      for (let i = 0; i < 20; i++) fx.frame(frameOf(1 + i * 0.05, [model(7), fig(8, KIND.Shade, 0, { x: 7 })]), newOut());
      fx.event({ t: 'Died', id: 8, x: 7 * 16, y: 80, kind: KIND.Shade } as never, 2, false);
      const out = newOut();
      fx.frame(frameOf(2.1, [model(7)]), out);
      expect(out.tris.n).toBe(strands.tris.n);
      expect(out.smoke.n).toBeGreaterThan(0);
    });

    it('a session without smoke keeps the strands for a dead card Shade', () => {
      const fx = new Effects3d(map);
      fx.event({ t: 'Died', id: 5, x: 80, y: 80, kind: KIND.Shade } as never, 1, false);
      const out = newOut();
      fx.frame(frameOf(1.2, []), out);
      expect(out.tris.n).toBeGreaterThan(0);
      expect(out.smoke.n).toBe(0);
    });
  });
});

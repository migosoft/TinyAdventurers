import { beforeEach, describe, expect, it } from 'vitest';
import { TileMap } from '../../sim/map';
import { newGlowBuf } from '../cards';
import type { LavaCues } from '../lava/lava';
import { Effects3d, FX_KIND, FX_LIFE, clearFxRegistry, type FxFrame } from './effects3d';
import { FxTris } from './tris';
import type { FxOut } from './types';
import { EMBER_SLOTS, emberAt, emitLavaCues, registerLavaFx } from './lavaFx';
import { newFxBuf } from '../models/fx';
import { LAVA_Y } from '../air/puffs';
import { PX } from './shapes';

const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [] });
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const cues = (o: Partial<LavaCues> = {}): LavaCues => ({ enters: [], spray: [], burning: [], pops: [], ...o });
const frameOf = (now: number, lava?: LavaCues, hidden: number[] = []): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(hidden), you: 0, ownCast: null, lava,
});
const spot = { id: 3, x: 2, z: 2 };

beforeEach(() => { clearFxRegistry(); registerLavaFx(); });

describe('lava effects', () => {
  it('lives', () => {
    expect(FX_KIND.LavaBurst).toBe(26);
    expect(FX_KIND.LavaSpray).toBe(27);
    expect(FX_LIFE[FX_KIND.LavaBurst]).toBe(1.2);
    expect(FX_LIFE[FX_KIND.LavaSpray]).toBe(0.3);
  });

  it('makes one LavaBurst a=0 per entering and a=1 per pop, one LavaSpray per spray cue', () => {
    const made: number[][] = [];
    const spy = { emit: (kind: number, _now: number, _x: number, _z: number, _follow: number, a: number) => { made.push([kind, a]); } } as unknown as Effects3d;
    emitLavaCues(spy, cues({ enters: [spot], pops: [{ id: -1, x: 1, z: 1 }, { id: -1, x: 2, z: 1 }], spray: [spot] }), 1, new Set());
    expect(made.length).toBe(4);
    expect(made.filter(([k, a]) => k === FX_KIND.LavaBurst && a === 0).length).toBe(1);
    expect(made.filter(([k, a]) => k === FX_KIND.LavaBurst && a === 1).length).toBe(2);
    expect(made.filter(([k]) => k === FX_KIND.LavaSpray).length).toBe(1);
  });

  it('makes none for a hidden id; a pop (id -1) is never hidden by an id', () => {
    const fx = new Effects3d(map);
    emitLavaCues(fx, cues({ enters: [spot], spray: [spot] }), 1, new Set([3]));
    expect(fx.records).toBe(0);
    emitLavaCues(fx, cues({ pops: [{ id: -1, x: 1, z: 1 }] }), 1, new Set([3, -1]));
    expect(fx.records).toBe(1);
  });

  it('draws finite vertices at every age of every kind, into the glowing triangles only', () => {
    const shapes: Array<[string, Partial<LavaCues>, number]> = [
      ['enter', { enters: [spot] }, FX_LIFE[FX_KIND.LavaBurst]], ['pop', { pops: [{ id: -1, x: 2, z: 2 }] }, FX_LIFE[FX_KIND.LavaBurst]],
      ['spray', { spray: [spot] }, FX_LIFE[FX_KIND.LavaSpray]],
    ];
    for (const [name, cu, life] of shapes) {
      for (let seed = 0; seed < 6; seed++) {
        const fx = new Effects3d(map);
        for (let k = 0; k < seed; k++) fx.frame(frameOf(0.5 + k * 0.01), newOut());
        const t0 = 1 + seed;
        fx.frame(frameOf(t0, cues(cu)), newOut());
        for (const age of [0, life / 2 * 0.3, 0.1, life - 0.02]) {
          const out = newOut();
          fx.frame(frameOf(t0 + age), out);
          expect(out.lit.n, name).toBe(0);
          const o = newFxBuf();
          out.tris.flush(o, cam, false);
          const p = o.position;
          for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i]), `${name} ${seed} ${age}`).toBe(true);
          if (age === 0) expect(p.length, name).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is born at LAVA_Y and never goes below it', () => {
    const SIZE = PX * 2 * 1.5;
    for (const cu of [{ enters: [spot] }, { pops: [{ id: -1, x: 2, z: 2 }] }, { spray: [spot] }] as Partial<LavaCues>[]) {
      const fx = new Effects3d(map);
      fx.frame(frameOf(1, cues(cu)), newOut());
      for (const age of [0, 0.05, 0.15, 0.25, 0.6, 1.1]) {
        const out = newOut();
        fx.frame(frameOf(1 + age), out);
        const o = newFxBuf();
        out.tris.flush(o, cam, false);
        const p = o.position;
        for (let i = 1; i < p.length; i += 3) expect(p[i]).toBeGreaterThanOrEqual(LAVA_Y - SIZE);
      }
    }
  });

  it('emberAt loops, stays within its box and fades out', () => {
    const out: [number, number, number] = [0, 0, 0], again: [number, number, number] = [0, 0, 0];
    for (let id = 1; id < 4; id++) {
      for (let s = 0; s < EMBER_SLOTS; s++) {
        for (let k = 0; k < 40; k++) {
          const now = 10 + k * 0.0137;
          const f = emberAt(id, s, now, out);
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
          expect(Math.abs(out[0])).toBeLessThanOrEqual(4 * PX + 1e-9);
          expect(Math.abs(out[2])).toBeLessThanOrEqual(4 * PX + 1e-9);
          expect(out[1]).toBeGreaterThanOrEqual(-1e-9);
          expect(out[1]).toBeLessThanOrEqual((10 + 28 * 0.4) * PX + 1e-9);
          const f2 = emberAt(id, s, now + 0.4, again);
          expect(f2).toBeCloseTo(f, 6);
          for (let c = 0; c < 3; c++) expect(again[c]).toBeCloseTo(out[c], 6);
        }
      }
    }
    // each slot has a moment of birth (fade 1) and the fade falls to 0 just before it loops
    let max = 0, min = 1;
    for (let k = 0; k < 400; k++) { const f = emberAt(1, 0, k * 0.001, out); max = Math.max(max, f); min = Math.min(min, f); }
    expect(max).toBeGreaterThan(0.99);
    expect(min).toBeLessThan(0.01);
  });

  it('draws EMBER_SLOTS embers per burning hero and none without one', () => {
    const fx = new Effects3d(map);
    const none = newOut();
    fx.frame(frameOf(1, cues()), none);
    expect(none.tris.n).toBe(0);
    const one = newOut(), two = newOut();
    fx.frame(frameOf(1.05, cues({ burning: [spot] })), one);
    fx.frame(frameOf(1.05, cues({ burning: [spot, { id: 4, x: 1, z: 1 }] })), two);
    expect(one.tris.n).toBeGreaterThan(0);
    expect(two.tris.n).toBe(one.tris.n * 2);
    expect(one.lit.n).toBe(0);
    const hid = newOut();
    fx.frame(frameOf(1.05, cues({ burning: [spot] }), [3]), hid);
    expect(hid.tris.n).toBe(0);
    expect(fx.records).toBe(0);
  });
});

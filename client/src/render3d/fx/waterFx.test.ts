import { beforeEach, describe, expect, it } from 'vitest';
import { TileMap } from '../../sim/map';
import { newGlowBuf } from '../cards';
import type { WaterCues } from '../water/water';
import { Effects3d, FX_KIND, FX_LIFE, clearFxRegistry, type FxFrame } from './effects3d';
import { FxTris } from './tris';
import type { FxOut } from './types';
import { registerWaterFx } from './waterFx';

const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [] });
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const cues = (o: Partial<WaterCues> = {}): WaterCues => ({ enters: [], plunges: [], spray: [], bubbles: [], ...o });
const frameOf = (now: number, water?: WaterCues, hidden: number[] = []): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(hidden), you: 0, ownCast: null, water,
});

beforeEach(() => { clearFxRegistry(); registerWaterFx(); });

describe('water effects', () => {
  it('lives', () => {
    expect(FX_KIND.WaterSplash).toBe(24);
    expect(FX_KIND.WaterDrop).toBe(25);
    expect(FX_LIFE[FX_KIND.WaterSplash]).toBe(0.45);
    expect(FX_LIFE[FX_KIND.WaterDrop]).toBe(0.35);
  });

  it('one enters cue makes one splash, lit, gone after its life', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, cues({ enters: [{ id: 3, x: 2, z: 2 }] })), newOut());
    expect(fx.records).toBe(1);
    const young = newOut();
    fx.frame(frameOf(1.1), young);
    expect(young.lit.n).toBeGreaterThan(0);
    expect(young.tris.n).toBe(0);
    const old = newOut();
    fx.frame(frameOf(1 + FX_LIFE[FX_KIND.WaterSplash] + 0.01), old);
    expect(old.lit.n + old.tris.n).toBe(0);
    expect(fx.records).toBe(0);
  });

  it('a plunge makes a bigger splash than an entering', () => {
    const a = new Effects3d(map), b = new Effects3d(map);
    a.frame(frameOf(1, cues({ enters: [{ id: 3, x: 2, z: 2 }] })), newOut());
    b.frame(frameOf(1, cues({ plunges: [{ id: 3, x: 2, z: 2 }] })), newOut());
    const oa = newOut(), ob = newOut();
    a.frame(frameOf(1.02), oa);
    b.frame(frameOf(1.02), ob);
    expect(ob.lit.n).toBeGreaterThan(oa.lit.n);
  });

  it('a hidden id makes none', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, cues({ enters: [{ id: 3, x: 2, z: 2 }], plunges: [{ id: 3, x: 2, z: 2 }], spray: [{ id: 3, x: 2, z: 2 }], bubbles: [{ id: 3, x: 2, z: 2 }] }), [3]), newOut());
    expect(fx.records).toBe(0);
  });

  it('a spray and a bubble make one drop record each, lit', () => {
    const fx = new Effects3d(map);
    fx.frame(frameOf(1, cues({ spray: [{ id: 3, x: 2, z: 2 }], bubbles: [{ id: 3, x: 1, z: 1 }] })), newOut());
    expect(fx.records).toBe(2);
    const out = newOut();
    fx.frame(frameOf(1.1), out);
    expect(out.lit.n).toBeGreaterThan(0);
    expect(out.tris.n).toBe(0);
    const old = newOut();
    fx.frame(frameOf(1 + FX_LIFE[FX_KIND.WaterDrop] + 0.01), old);
    expect(old.lit.n).toBe(0);
    expect(fx.records).toBe(0);
  });
});

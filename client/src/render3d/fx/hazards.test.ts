import { beforeEach, describe, expect, it } from 'vitest';
import { ANIM, KIND } from '../../generated/defs';
import { HAZARD_LOOKS } from '../../game/fxLooks';
import type { EntState } from '../../game/world';
import { TileMap } from '../../sim/map';
import { TILE } from '../../sim/map';
import { newGlowBuf } from '../cards';
import { Effects3d, clearFxRegistry, type FxFrame } from './effects3d';
import { hazardRadii, hazardStrength, registerHazards } from './hazards';
import { FxTris } from './tris';
import type { FxOut } from './types';

const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [] });
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const ent = (id: number, kind: number, o: Partial<EntState> = {}): EntState => ({ id, kind, x: 5 * TILE, y: 5 * TILE, hp: 1, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 500, effects: 0, side: 1, entangled: 0, ...o });
const frameOf = (now: number, ents: EntState[], o: { hidden?: number[]; fp?: FxFrame['fp'] } = {}): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs: [], ents: new Map(ents.map((e) => [e.id, e])), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(o.hidden ?? []), you: 0, ownCast: null, fp: o.fp,
});

beforeEach(() => { clearFxRegistry(); registerHazards(); });

describe('hazards', () => {
  it('hazard fades with its life', () => {
    const l = HAZARD_LOOKS[KIND.FirePatch];
    expect(hazardStrength(250, 1, 3, l.alpha)).toBeCloseTo(hazardStrength(500, 1, 3, l.alpha) / 2, 9);
    expect(hazardStrength(900, 1, 3, l.alpha)).toBe(hazardStrength(500, 1, 3, l.alpha));
  });

  it('fire patch is squashed', () => {
    const r = hazardRadii(KIND.FirePatch, 20);
    expect(r.rx / r.rz).toBeCloseTo(1.75 / 0.98, 6);
    expect(r.rx).toBeCloseTo((20 * 1.75) / TILE, 6);
  });

  it('draws each kind, and nothing outside the footprint or for a hidden one', () => {
    for (const k of [KIND.FirePatch, KIND.HolyGround, KIND.Roots]) {
      const fx = new Effects3d(map), out = newOut();
      fx.frame(frameOf(1, [ent(1, k)]), out);
      expect(out.tris.n + out.lit.n).toBeGreaterThan(0);
      const far = newOut();
      fx.frame(frameOf(1, [ent(1, k)], { fp: { x0: 20, x1: 30, z0: 20, z1: 30 } }), far);
      expect(far.tris.n + far.lit.n).toBe(0);
      const hid = newOut();
      fx.frame(frameOf(1, [ent(1, k)], { hidden: [1] }), hid);
      expect(hid.tris.n + hid.lit.n).toBe(0);
    }
  });

  it('a spent patch draws nothing', () => {
    const out = newOut();
    new Effects3d(map).frame(frameOf(1, [ent(1, KIND.Roots, { extra: 0 })]), out);
    expect(out.tris.n + out.lit.n).toBe(0);
  });
});

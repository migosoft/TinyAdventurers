import { newSmokeBuf } from './smoke';
import { beforeEach, describe, expect, it } from 'vitest';
import { KIND } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { newFxBuf } from '../models/fx';
import { Effects3d, clearFxRegistry, type FxFrame } from './effects3d';
import { registerShots, shotTris } from './shots';
import { FxTris } from './tris';
import type { FxCtx, FxOut } from './types';

const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const ctx: FxCtx = { cam, ax: { right: [Math.cos(0.3), 0, Math.sin(0.3)], up: [0, 1, 0] }, now: 1, detail: 1, ballDetail: 2, smokeTone: null };
const newOut = (): FxOut => ({ tris: new FxTris(5000), lit: new FxTris(100), glows: { position: [], uv: [], color: [], foot: [], n: 0 }, lights: [], smoke: newSmokeBuf() });
const dump = (T: FxTris): number[] => { const o = newFxBuf(); T.flush(o, cam, false); return o.position; };
const map = new TileMap(4, 4, new Uint8Array(16));
const frame = (now: number, o: Partial<FxFrame> = {}): FxFrame => ({
  ctx: { ...ctx, now }, figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(), you: 0, ownCast: null, ...o,
});

beforeEach(() => { clearFxRegistry(); registerShots(); });

describe('shots', () => {
  it('fire shot draws a ball at the shot', () => {
    const out = newOut();
    shotTris(out, ctx, KIND.FireBolt, 5, 0.5, 6, 0.4, 1, 3);
    const p = dump(out.tris);
    expect(p.length).toBeGreaterThan(0);
    let near = 0;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i] - 5, p[i + 1] - 0.5, p[i + 2] - 6);
      expect(d).toBeLessThan(0.45);
      if (d < 0.3) near++;
    }
    // the ball (and most of the trail) lies within 0.3 tiles
    expect(near / (p.length / 3)).toBeGreaterThan(0.9);
    expect(out.glows.n).toBe(1);
  });

  it('frost shot points along its flight', () => {
    const out = newOut();
    const dir = 0.7;
    shotTris(out, ctx, KIND.FrostBolt, 5, 0.5, 6, dir, 1, 3);
    const p = dump(out.tris);
    const tx = 5 + Math.cos(dir) * 0.25, tz = 6 + Math.sin(dir) * 0.25;
    let best = 1e9;
    for (let i = 0; i < p.length; i += 3) best = Math.min(best, Math.hypot(p[i] - tx, p[i + 1] - 0.5, p[i + 2] - tz));
    expect(best).toBeLessThan(1e-4);
  });

  it('other glowing shots and gloom shots draw; frame shots do not', () => {
    for (const k of [KIND.Missile, KIND.ShadowBolt, KIND.GloomBolt, KIND.Judgement]) {
      const out = newOut();
      shotTris(out, ctx, k, 5, 0.5, 6, 0, 1, 3);
      expect(out.tris.n).toBeGreaterThan(0);
      expect(out.glows.n).toBe(1);
    }
    const out = newOut();
    shotTris(out, ctx, KIND.Arrow, 5, 0.5, 6, 0, 1, 3);
    expect(out.tris.n).toBe(0);
  });

  it('hidden shots draw nothing and visible ones come from the frame', () => {
    const fx = new Effects3d(map);
    const e = { id: 20, kind: KIND.Fireball, x: 40, y: 40, hp: 1, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: 0, entangled: 0 };
    const ents = new Map([[20, e]]);
    const a = newOut(); fx.frame(frame(1, { ents }), a);
    expect(a.tris.n).toBeGreaterThan(0);
    const b = newOut(); fx.frame(frame(1, { ents, hiddenShots: new Set([20]) }), b);
    expect(b.tris.n).toBe(0);
  });

  it('wall hit sparks end', () => {
    const fx = new Effects3d(map);
    fx.shotEnded({ shot: 1, kind: KIND.FireBolt, x: 40, y: 40, vx: 1, vy: 0 }, 'wall', 1);
    const a = newOut(); fx.frame(frame(1.1), a);
    expect(a.tris.n).toBeGreaterThan(0);
    const b = newOut(); fx.frame(frame(1.5), b);
    expect(b.tris.n).toBe(0);
    expect(fx.records).toBe(0);
  });

  it('a card shot hitting a wall leaves nothing', () => {
    const fx = new Effects3d(map);
    fx.shotEnded({ shot: 1, kind: KIND.Arrow, x: 40, y: 40, vx: 1, vy: 0 }, 'wall', 1);
    const a = newOut(); fx.frame(frame(1.1), a);
    expect(a.tris.n).toBe(0);
    expect(fx.records).toBe(0);
  });
});

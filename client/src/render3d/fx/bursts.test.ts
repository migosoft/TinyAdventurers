import { newSmokeBuf } from './smoke';
import { describe, expect, it } from 'vitest';
import { newFxBuf } from '../models/fx';
import { fireBurst, frostBurst, frostShards } from './bursts';
import { FxTris } from './tris';
import type { FxCtx, FxOut } from './types';

const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const ctx: FxCtx = { cam, ax: { right: [Math.cos(0.3), 0, Math.sin(0.3)], up: [0, 1, 0] }, now: 1, detail: 1, ballDetail: 2, smokeTone: null };
const newOut = (): FxOut => ({ tris: new FxTris(8000), lit: new FxTris(500), glows: { position: [], uv: [], color: [], foot: [], n: 0 }, lights: [], smoke: newSmokeBuf() });
const dump = (T: FxTris): number[] => { const o = newFxBuf(); T.flush(o, cam, false); return o.position; };
const X = 10, Z = 12, R = 2;

describe('bursts', () => {
  it('fireball grows within 0.2 s to about r', () => {
    const out = newOut();
    fireBurst(out, ctx, X, Z, R, 0.2, 7);
    const p = dump(out.tris);
    let far = 0;
    for (let i = 0; i < p.length; i += 3) far = Math.max(far, Math.hypot(p[i] - X, p[i + 2] - Z));
    expect(far).toBeGreaterThan(0.8 * R);
    expect(far).toBeLessThan(1.6 * R);
  });

  it('fireball ends', () => {
    const a = newOut();
    fireBurst(a, ctx, X, Z, R, 2, 7);
    expect(a.tris.n).toBe(0);
    expect(a.lit.n).toBeGreaterThan(0);
    const b = newOut();
    fireBurst(b, ctx, X, Z, R, 4.01, 7);
    expect(b.tris.n + b.lit.n).toBe(0);
    expect(b.glows.n).toBe(0);
  });

  it('frost crystals break up', () => {
    const a = newOut();
    frostShards(a.tris, 0.3, X, Z, R, 7);
    expect(a.tris.n).toBeGreaterThan(0);
    const b = newOut();
    frostShards(b.tris, 1.6, X, Z, R, 7);
    expect(b.tris.n).toBe(0);
  });

  it('scorch is lit, ball is not', () => {
    const out = newOut();
    fireBurst(out, ctx, X, Z, R, 0.5, 7);
    expect(out.lit.n).toBeGreaterThan(0);
    expect(out.tris.n).toBeGreaterThan(0);
    const f = newOut();
    frostBurst(f, ctx, X, Z, R, 0.5, 7);
    expect(f.lit.n).toBeGreaterThan(0);
    expect(f.tris.n).toBeGreaterThan(0);
  });

  it('no client light', () => {
    const a = newOut(), b = newOut();
    fireBurst(a, ctx, X, Z, R, 0.1, 7);
    frostBurst(b, ctx, X, Z, R, 0.1, 7);
    expect(a.lights.length).toBe(0);
    expect(b.lights.length).toBe(0);
    expect(a.glows.n).toBeGreaterThan(0);
    expect(b.glows.n).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';
import { KIND } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { Effects3d, FX_KIND, FX_LIFE, boomKind, clearFxRegistry, registerFx, type FxFrame } from './effects3d';
import { FxTris } from './tris';
import { FX_KIND_CAP, type FxOut } from './types';

const boom = (k: number, x = 160) => ({ t: 'Boom' as const, x, y: 160, r: 24, k });
const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(100), lit: new FxTris(100), glows: { position: [], uv: [], color: [], foot: [], n: 0 }, lights: [] });
const frameAt = (now: number): FxFrame => ({
  ctx: { cam: { x: 0, z: 0, pitch: 0.9, yaw: 0 }, ax: { right: [1, 0, 0], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(), you: 0, ownCast: null,
});

describe('Effects3d', () => {
  it('caps hold under a flood of records', () => {
    const fx = new Effects3d(map);
    for (let i = 0; i < 500; i++) fx.event(boom(0, 100 + i), 1 + i * 1e-4, false);
    expect(fx.records).toBeLessThanOrEqual(FX_KIND_CAP);
    expect(fx.records).toBe(FX_KIND_CAP);
    // the newest are kept
    const seen: number[] = [];
    clearFxRegistry();
    registerFx(FX_KIND.FireBlast, (_o, _f, r) => { seen.push(r.x); });
    fx.frame(frameAt(1.1), newOut());
    expect(Math.min(...seen)).toBeCloseTo((100 + 488) / 16, 5);
    clearFxRegistry();
  });
  it('dark events make nothing', () => {
    const fx = new Effects3d(map);
    fx.event(boom(0), 1, true);
    fx.event({ t: 'Zap', x: 0, y: 0, x2: 16, y2: 16 }, 1, true);
    expect(fx.records).toBe(0);
  });
  it('records end after their life and drawers are called with the age', () => {
    const fx = new Effects3d(map);
    clearFxRegistry();
    const ages: number[] = [];
    registerFx(FX_KIND.Zap, (_o, _f, _r, age) => { ages.push(age); });
    fx.event({ t: 'Zap', x: 0, y: 0, x2: 16, y2: 16 }, 2, false);
    fx.frame(frameAt(2.1), newOut());
    expect(ages).toEqual([expect.closeTo(0.1, 6)]);
    expect(fx.records).toBe(1);
    fx.frame(frameAt(2 + FX_LIFE[FX_KIND.Zap] + 0.01), newOut());
    expect(fx.records).toBe(0);
    clearFxRegistry();
  });
  it('creates records for the events and shots the plan names', () => {
    const fx = new Effects3d(map);
    fx.event({ t: 'Dmg', x: 0, y: 0, v: 3, crit: false, p: false, ty: 0, imm: false }, 0, false);
    fx.event({ t: 'Dmg', x: 0, y: 0, v: 0, crit: false, p: false, ty: 0, imm: true }, 0, false);
    fx.event({ t: 'Raise', x: 0, y: 0, k: 1 }, 0, false);
    fx.event({ t: 'Immune', x: 0, y: 0 }, 0, false);
    fx.event({ t: 'Died', id: 5, x: 0, y: 0, kind: KIND.Ghost }, 0, false);
    fx.event({ t: 'Died', id: 6, x: 0, y: 0, kind: KIND.Shade }, 0, false);
    fx.event({ t: 'Cast', id: 7, x: 0, y: 0, look: 1, windup_ms: 600, primary: false, aim: 0 }, 0, false);
    fx.event({ t: 'Heal', x: 0, y: 0, v: 1, p: false }, 0, false);
    // the Shade's death leaves its veil drifting apart (a record), the Heal nothing
    expect(fx.records).toBe(6);
    fx.shotEnded({ shot: 1, kind: 0, x: 16, y: 16, vx: 0, vy: 0 }, 'wall', 0);
    fx.shotEnded({ shot: 2, kind: 0, x: 16, y: 16, vx: 0, vy: 0 }, 'enemy', 0);
    expect(fx.records).toBe(7);
    expect(boomKind(3)).toBeNull();
  });
});

describe('Effects3d own casts', () => {
  const YOU = 5;
  const withCast = (now: number, seq: number): FxFrame => {
    const f = frameAt(now);
    f.you = YOU;
    f.ents = new Map([[YOU, { id: YOU, x: 32, y: 32 } as never]]);
    f.ownCast = seq ? { seq, look: 2, primary: true, aim: 0 } : null;
    return f;
  };
  const serverCast = { t: 'Cast' as const, id: YOU, x: 32, y: 32, look: 2, windup_ms: 0, primary: true, aim: 0 };

  it('own cast starts on the key press', () => {
    const fx = new Effects3d(map);
    fx.frame(withCast(1, 1), newOut());
    expect(fx.records).toBe(1);
    fx.frame(withCast(1.016, 1), newOut());
    expect(fx.records).toBe(1);
  });
  it('server cast for own hero is not doubled', () => {
    const fx = new Effects3d(map);
    fx.frame(withCast(1, 1), newOut());
    fx.event(serverCast, 1.1, false);
    expect(fx.records).toBe(1);
  });
  it('unpredicted own cast still shows', () => {
    const fx = new Effects3d(map);
    fx.frame(withCast(1, 0), newOut());
    fx.event(serverCast, 1.1, false);
    expect(fx.records).toBe(1);
  });
  it('a server cast 0.8 s late is still one record', () => {
    const fx = new Effects3d(map);
    fx.frame(withCast(1, 1), newOut());
    fx.event(serverCast, 1.8, false);
    expect(fx.records).toBe(1);
  });
  it('two predicted casts, two late server events: two records', () => {
    const fx = new Effects3d(map);
    fx.frame(withCast(1, 1), newOut());
    fx.frame(withCast(1.2, 2), newOut());
    expect(fx.records).toBe(2);
    fx.event(serverCast, 1.9, false);
    fx.event(serverCast, 2.1, false);
    expect(fx.records).toBe(2);
    // a third server cast has no prediction left: it shows
    fx.event(serverCast, 2.2, false);
    expect(fx.records).toBe(3);
  });
  it('a refused prediction expires: a server cast 2.5 s later shows', () => {
    const fx = new Effects3d(map);
    fx.frame(withCast(1, 1), newOut());
    fx.event(serverCast, 3.5, false);
    expect(fx.records).toBe(2);
  });
  it('the predicted record belongs to the hero with the right look and mode', () => {
    const fx = new Effects3d(map);
    fx.frame(withCast(1, 1), newOut());
    const r = fx.castRecords()[0].rune!;
    expect(r.caster).toBe(YOU);
    expect(r.look).toBe(2);
    expect(r.mode).toBe('primary');
    expect(r.start).toBe(1);
  });
});

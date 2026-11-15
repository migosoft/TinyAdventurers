import { describe, expect, it } from 'vitest';
import { KIND } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { registerBooms } from './booms';
import { Effects3d, FX_LIFE, type FxFrame } from './effects3d';
import { registerBursts } from './bursts';
import { FxTris } from './tris';
import { FX_LIGHT_CAP, type FxOut } from './types';
import { newFxBuf } from '../models/fx';

registerBooms();
registerBursts();
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const map = new TileMap(4, 4, new Uint8Array(16));
const newOut = (): FxOut => ({ tris: new FxTris(20000), lit: new FxTris(5000), glows: { position: [], uv: [], color: [], foot: [], n: 0 }, lights: [] });
const frameAt = (now: number, hidden: number[] = []): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(0.3), 0, Math.sin(0.3)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(hidden), you: 0, ownCast: null,
});
const X = 160, Y = 160, R = 32;
type Ev = Parameters<Effects3d['event']>[0];
const rows: Array<[string, Ev, number, boolean]> = [
  ['dmg', { t: 'Dmg', x: X, y: Y, amount: 5, imm: false, p: false } as unknown as Ev, 0.25, false],
  ['k1', { t: 'Boom', x: X, y: Y, r: R, k: 1 }, 0.8, false],
  ['k13', { t: 'Boom', x: X, y: Y, r: R, k: 13 }, 0.8, false],
  ['k2', { t: 'Boom', x: X, y: Y, r: R, k: 2 }, 0.7, true],
  ['k5', { t: 'Boom', x: X, y: Y, r: R, k: 5 }, 0.9, false],
  ['k6', { t: 'Boom', x: X, y: Y, r: R, k: 6 }, 0.8, true],
  ['k8', { t: 'Boom', x: X, y: Y, r: R, k: 8 }, 0.9, false],
  ['k9', { t: 'Boom', x: X, y: Y, r: R, k: 9 }, 0.8, false],
  ['k11', { t: 'Boom', x: X, y: Y, r: R, k: 11 }, 0.5, false],
  ['k12', { t: 'Boom', x: X, y: Y, r: R, k: 12 }, 0.5, false],
  ['zap', { t: 'Zap', x: X, y: Y, x2: X + 48, y2: Y + 16 } as Ev, 0.18, true],
  ['died', { t: 'Died', id: 5, kind: KIND.OrcWarrior, x: X, y: Y } as Ev, 0.6, false],
  ['skeleton', { t: 'Died', id: 5, kind: KIND.SkeletonWarrior, x: X, y: Y } as Ev, 0.6, false],
  ['boss', { t: 'Died', id: 5, kind: KIND.Dragon, x: X, y: Y } as Ev, 1, false],
  ['ghost', { t: 'Died', id: 5, kind: KIND.Ghost, x: X, y: Y } as Ev, 1, false],
  ['raise0', { t: 'Raise', k: 0, x: X, y: Y } as Ev, 0.9, false],
  ['raise1', { t: 'Raise', k: 1, x: X, y: Y } as Ev, 0.9, false],
  ['raise2', { t: 'Raise', k: 2, x: X, y: Y } as Ev, 0.9, false],
  ['immune', { t: 'Immune', x: X, y: Y } as Ev, 0.3, false],
];
const run = (ev: Ev, age: number, hidden: number[] = []): { out: FxOut; fx: Effects3d } => {
  const fx = new Effects3d(map), out = newOut();
  fx.event(ev, 0, false);
  fx.frame(frameAt(age, hidden), out);
  return { out, fx };
};

/** The largest reach of each row from the event's point, in tiles (r is 2 tiles): its ring or sphere, or the farthest thing thrown. */
const REACH: Record<string, number> = {
  dmg: 1.1, k1: 2, k13: 2, k2: 4.2, k5: 2, k6: 2, k8: 2.7, k9: 2, k11: 2, k12: 2, zap: Math.hypot(3, 1) + 0.15,
  died: 1.5, skeleton: 1.5, boss: 3.6, ghost: 0.5, raise0: 0.7, raise1: 0.7, raise2: 0.7, immune: 0.45,
};

describe('booms and other events', () => {
  for (const [name, ev, life] of rows) {
    it(`${name}: draws, ends and stays near the event`, () => {
      let total = 0, far = 0;
      const tx = X / 16, tz = Y / 16;
      for (let a = 0.02; a < life; a += 0.04) {
        const { out } = run(ev, a);
        total += out.tris.n + out.lit.n;
        for (const T of [out.tris, out.lit]) {
          const b = newFxBuf(); T.flush(b, cam, false);
          for (let i = 0; i < b.position.length; i += 3) far = Math.max(far, Math.hypot(b.position[i] - tx, b.position[i + 2] - tz));
        }
      }
      expect(total).toBeGreaterThan(0);
      expect(far).toBeLessThan(REACH[name] + 0.5);
      const end = run(ev, life + 0.05);
      expect(end.out.tris.n + end.out.lit.n).toBe(0);
    });
  }

  it('lit pieces are lit', () => {
    for (const k of [5, 8]) {
      const { out } = run({ t: 'Boom', x: X, y: Y, r: R, k }, 0.3);
      expect(out.lit.n, `k ${k}`).toBeGreaterThan(0);
    }
  });

  it('barrel boom also throws splinters', () => {
    const fx = new Effects3d(map);
    fx.event({ t: 'Boom', x: X, y: Y, r: R, k: 7 }, 0, false);
    expect(fx.records).toBe(2);
  });

  it('dark boom draws nothing', () => {
    const fx = new Effects3d(map), out = newOut();
    fx.event({ t: 'Boom', x: X, y: Y, r: R, k: 2 }, 0, true);
    fx.frame(frameAt(0.1), out);
    expect(out.tris.n + out.lit.n + out.lights.length + out.glows.n).toBe(0);
  });

  it('hidden figures leave no death', () => {
    const { out } = run({ t: 'Died', id: 5, kind: KIND.OrcWarrior, x: X, y: Y } as Ev, 0.2, [5]);
    expect(out.tris.n + out.lit.n).toBe(0);
  });

  it('client lights only where the table says', () => {
    for (const [name, ev, , lit] of rows) {
      const { out } = run(ev, 0.05);
      if (name === 'boss') expect(out.lights.length).toBe(1);
      else expect(out.lights.length > 0, name).toBe(lit);
    }
  });

  it('lights stay under the cap', () => {
    const fx = new Effects3d(map), out = newOut();
    for (let i = 0; i < 12; i++) fx.event({ t: 'Zap', x: X + i, y: Y, x2: X + 40, y2: Y }, 0, false);
    fx.frame(frameAt(0.02), out);
    expect(out.lights.length).toBeLessThanOrEqual(FX_LIGHT_CAP);
  });

  it('lives match', () => {
    expect(FX_LIFE[11]).toBe(0.18);
  });
});

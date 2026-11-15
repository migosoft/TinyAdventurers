import { beforeEach, describe, expect, it } from 'vitest';
import { FIGURES } from '../../game/anim/defs';
import type { EntState } from '../../game/world';
import { ANIM, EFFECT, FLAG, KIND, LIGHT_KIND, RUNE_LOOK, SIDE } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { newFxBuf } from '../models/fx';
import { carrierMap } from '../lights';
import { Effects3d, clearFxRegistry, type FxFrame } from './effects3d';
import { channelPalette, registerRunes, RUNE_PALETTES } from './runes';
import { FxTris } from './tris';
import type { DrawnFig, FxOut } from './types';

const map = new TileMap(4, 4, new Uint8Array(16));
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const ID = 7, X = 5, Z = 6;
const newOut = (): FxOut => ({ tris: new FxTris(5000), lit: new FxTris(100), glows: { position: [], uv: [], color: [], foot: [], n: 0 }, lights: [] });
const fig = (o: Partial<DrawnFig> = {}): DrawnFig => ({
  id: ID, kind: KIND.Wizard, x: X, z: Z, top: 1, hand: [X, 0.6, Z], aim: 0, anim: ANIM.Windup, animT: 0, effects: 0, alpha: 1, model: false, side: SIDE.Friendly,
  def: FIGURES[KIND.Wizard], yaw: 0, swingY: 0.6, arc: 0, bite: -1, ...o,
});
const ent = (o: Partial<EntState> = {}): EntState => ({
  id: ID, kind: KIND.Wizard, x: X * 16, y: Z * 16, hp: 10, anim: ANIM.Windup, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: SIDE.Friendly, entangled: 0, ...o,
});
const frame = (now: number, figs: DrawnFig[], o: Partial<FxFrame> = {}): FxFrame => ({
  ctx: { cam, ax: { right: [Math.cos(0.3), 0, Math.sin(0.3)], up: [0, 1, 0] }, now, detail: 1, ballDetail: 2 },
  figs, ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(), you: 0, ownCast: null, ...o,
});
const cast = (fx: Effects3d, windupMs: number, primary = false, at = 1, look: number = RUNE_LOOK.Fire): void =>
  fx.event({ t: 'Cast', id: ID, x: X * 16, y: Z * 16, look, windup_ms: windupMs, primary, aim: 0 }, at, false);
const run = (fx: Effects3d, now: number, figs: DrawnFig[] = [fig()], o: Partial<FxFrame> = {}): FxOut => {
  const out = newOut();
  fx.frame(frame(now, figs, o), out);
  return out;
};

beforeEach(() => { clearFxRegistry(); registerRunes(); });

describe('runes', () => {
  it('wind-up runes appear one by one', () => {
    const fx = new Effects3d(map);
    cast(fx, 1200);
    const a = run(fx, 1.1).tris.n, b = run(fx, 1.6).tris.n, c = run(fx, 2.1).tris.n;
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('release bursts then ends', () => {
    const fx = new Effects3d(map);
    cast(fx, 1200);                    // release at 2.2
    expect(run(fx, 2.3).tris.n).toBeGreaterThan(0);
    expect(run(fx, 2.2 + 0.65).tris.n).toBe(0);
    expect(fx.records).toBe(0);
  });

  it('broken-off cast winks out and the record is gone', () => {
    const idle = (): DrawnFig => fig({ anim: ANIM.Idle });
    const a = new Effects3d(map);
    cast(a, 1200);
    run(a, 1.4);
    expect(run(a, 1.5, [idle()]).tris.n).toBeGreaterThan(0);   // still fading at the moment it is seen
    expect(run(a, 1.5 + 0.21, [idle()]).tris.n).toBe(0);
    expect(a.records).toBe(0);

    const b = new Effects3d(map);
    cast(b, 1200);
    run(b, 1.4);
    run(b, 1.5, [fig()], { ents: new Map([[ID, ent({ flags: FLAG.DEAD })]]) });
    expect(run(b, 1.71, [fig()], { ents: new Map([[ID, ent({ flags: FLAG.DEAD })]]) }).tris.n).toBe(0);
    expect(b.records).toBe(0);

    const c = new Effects3d(map);
    cast(c, 1200);
    run(c, 1.4);
    run(c, 1.5, []);
    run(c, 1.8, []);
    expect(run(c, 1.82, []).tris.n).toBeGreaterThan(0);   // winking out from the 0.25 s mark, not popping
    expect(run(c, 1.8 + 0.21, []).tris.n).toBe(0);
    expect(c.records).toBe(0);

    const d = new Effects3d(map);
    cast(d, 1200);
    run(d, 1.4);
    const ent2 = new Map([[ID, ent({ effects: 1 << EFFECT.Sleep })]]);
    run(d, 1.5, [fig()], { ents: ent2 });
    expect(run(d, 1.71, [fig()], { ents: ent2 }).tris.n).toBe(0);
    expect(d.records).toBe(0);
  });

  it('primary vortex sits in front', () => {
    const fx = new Effects3d(map);
    cast(fx, 0, true);
    const out = run(fx, 1.1, [fig({ anim: ANIM.Cast })]);
    expect(out.tris.n).toBeGreaterThan(0);
    const buf = newFxBuf();
    out.tris.flush(buf, cam, false);
    for (let i = 0; i < buf.position.length; i += 3) {
      expect(Math.hypot(buf.position[i] - (X + 0.5), buf.position[i + 2] - Z)).toBeLessThan(0.75);
    }
  });

  it('hidden caster draws nothing and adds no light, also after the release', () => {
    const fx = new Effects3d(map);
    cast(fx, 1200);
    const hidden = new Set([ID]);
    for (const t of [1.6, 2.3]) {
      const out = run(fx, t, [fig()], { hidden });
      expect(out.tris.n).toBe(0);
      expect(out.glows.n).toBe(0);
      expect(out.lights.length).toBe(0);
    }
  });

  it('caster light skips the caster', () => {
    const fx = new Effects3d(map);
    cast(fx, 1200);
    const out = run(fx, 2.1);
    expect(out.lights.length).toBe(1);
    const l = out.lights[0];
    expect(l.id).toBe(`m${ID}.9`);
    expect(l.kind).toBe(LIGHT_KIND.Magic);
    expect(carrierMap(out.lights).get(l.id)).toBe(ID);
  });

  it('same seed, same picture', () => {
    const dump = (): number[] => {
      const fx = new Effects3d(map);
      cast(fx, 1200, false, 1, RUNE_LOOK.Gloom);
      const out = run(fx, 1.9);
      const buf = newFxBuf();
      out.tris.flush(buf, cam, false);
      return [...buf.position, ...buf.rgba, ...out.glows.position];
    };
    expect(dump()).toEqual(dump());
  });

  it('a channelling figure gets runes in its colour until it stops', () => {
    const fx = new Effects3d(map);
    run(fx, 1, [fig({ anim: ANIM.Channel })]);
    expect(run(fx, 1.5, [fig({ anim: ANIM.Channel })]).tris.n).toBeGreaterThan(0);
    expect(run(fx, 12, [fig({ anim: ANIM.Channel })]).tris.n).toBeGreaterThan(0);   // longer than the record's life cap
    expect(fx.records).toBe(1);
    run(fx, 12.1, [fig({ anim: ANIM.Idle })]);
    expect(run(fx, 12.15, [fig({ anim: ANIM.Idle })]).tris.n).toBeGreaterThan(0);   // past the life cap, still winking out
    expect(run(fx, 12.4, [fig({ anim: ANIM.Idle })]).tris.n).toBe(0);
    expect(fx.records).toBe(0);
    const p = channelPalette(0x4a7aff);
    expect(p.runes[0][2]).toBeCloseTo(1, 5);
  });

  it('every look has a palette', () => {
    for (const v of Object.values(RUNE_LOOK)) expect(RUNE_PALETTES[v].runes.length).toBeGreaterThan(0);
  });
});

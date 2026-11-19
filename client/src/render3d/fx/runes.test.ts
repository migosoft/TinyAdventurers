import { beforeEach, describe, expect, it } from 'vitest';
import { FIGURES } from '../../game/anim/defs';
import type { EntState } from '../../game/world';
import { ANIM, EFFECT, FLAG, KIND, LIGHT_KIND, RUNE_LOOK, SIDE } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { newFxBuf } from '../models/fx';
import { carrierMap } from '../lights';
import { Effects3d, clearFxRegistry, type FxFrame } from './effects3d';
import { APPEAR, channelPalette, HOLD, newRune, registerRunes, RUNE_N, RUNE_PALETTES, runeBorn, SPHERE_MIN } from './runes';
import { FxTris } from './tris';
import type { DrawnFig, FxOut } from './types';

const map = new TileMap(4, 4, new Uint8Array(16));
const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };
const ID = 7, X = 5, Z = 6;
const newOut = (): FxOut => ({ tris: new FxTris(5000), lit: new FxTris(100), glows: { position: [], uv: [], color: [], foot: [], n: 0 }, lights: [] });
const fig = (o: Partial<DrawnFig> = {}): DrawnFig => ({
  id: ID, kind: KIND.Wizard, x: X, z: Z, top: 1, foot: 0, hand: [X, 0.6, Z], aim: 0, anim: ANIM.Windup, animT: 0, effects: 0, alpha: 1, dashing: false, model: false, side: SIDE.Friendly,
  def: FIGURES[KIND.Wizard], yaw: 0, swingY: 0.6, arc: 0, bite: -1, spectre: null, form: 1, ...o,
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

  it('every rune of a released cast stands whole before the burst, also on a short cast', () => {
    const casts: Array<['instant' | 'primary' | 'windup', number]> = [['instant', 0], ['primary', 0], ['primary', 0.35], ['windup', 0.3], ['windup', 0.6], ['windup', 1.2]];
    for (const [mode, w] of casts) {
      for (let seed = 1; seed < 40; seed++) {
        const r = newRune(ID, RUNE_LOOK.Holy, mode, 1, w, 0, X, Z, seed);
        const n = RUNE_N[mode];
        for (let i = 0; i < n; i++) expect(1 + runeBorn(r, i, n) + APPEAR + HOLD, `${mode} ${w} rune ${i}`).toBeLessThanOrEqual(r.release! + 1e-9);
      }
    }
    // the long wind-up still brings its runes in one by one
    const long = newRune(ID, RUNE_LOOK.Fire, 'windup', 1, 1.2, 0, X, Z, 3);
    expect(runeBorn(long, RUNE_N.windup - 1, RUNE_N.windup)).toBeGreaterThan(runeBorn(long, 0, RUNE_N.windup) + 0.5);
  });

  it('an instant cast is a short wind-up: the same runes, born over the same share of its time', () => {
    const instant = newRune(ID, RUNE_LOOK.Holy, 'instant', 1, 0, 0, X, Z, 5), long = newRune(ID, RUNE_LOOK.Holy, 'windup', 1, 1.2, 0, X, Z, 5);
    expect(instant.release).toBeCloseTo(1 + SPHERE_MIN);
    expect(RUNE_N.instant).toBe(RUNE_N.windup);
    const share = (r: typeof long, i: number): number => runeBorn(r, i, RUNE_N.windup) / (r.release! - r.start - APPEAR - HOLD);
    for (let i = 0; i < RUNE_N.windup; i++) expect(share(instant, i)).toBeCloseTo(share(long, i));
    // a wind-up shorter than the minimum stands as long as an instant cast
    expect(newRune(ID, RUNE_LOOK.Holy, 'windup', 1, 0.1, 0, X, Z, 5).release).toBeCloseTo(1 + SPHERE_MIN);
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

  it('a monster primary with a wind-up releases with its bolt and breaks off like a wind-up', () => {
    const fx = new Effects3d(map);
    cast(fx, 350, true);                                  // release at 1.35, vortex pops in at 1.15
    expect(run(fx, 1.14, [fig({ anim: ANIM.Cast })]).tris.n).toBe(0);
    expect(run(fx, 1.25, [fig({ anim: ANIM.Cast })]).tris.n).toBeGreaterThan(0);
    const b = new Effects3d(map);
    cast(b, 350, true);
    run(b, 1.2, [fig({ anim: ANIM.Cast })]);
    run(b, 1.25, [fig({ anim: ANIM.Idle })]);              // broken off at 0.25
    expect(run(b, 1.5, [fig({ anim: ANIM.Idle })]).tris.n).toBe(0);
    expect(b.records).toBe(0);
    const c = new Effects3d(map);
    cast(c, 350, true);
    run(c, 1.2, [fig({ anim: ANIM.Cast })]);
    expect(run(c, 1.4, [fig({ anim: ANIM.Cast })]).tris.n).toBeGreaterThan(0);   // released
  });

  it('cast records have their own cap and keep the boss and the own hero', () => {
    const fx = new Effects3d(map);
    const BOSS = 99, YOU = 5;
    fx.event({ t: 'Cast', id: BOSS, x: 16, y: 16, look: RUNE_LOOK.Fire, windup_ms: 2000, primary: false, aim: 0 }, 1, false);
    run(fx, 1, [fig({ id: YOU })], { you: YOU, ownCast: { seq: 1, look: RUNE_LOOK.Fire, primary: true, aim: 0 }, ents: new Map([[YOU, ent({ id: YOU })]]) });
    for (let i = 0; i < 30; i++) fx.event({ t: 'Cast', id: 100 + i, x: 16, y: 16, look: RUNE_LOOK.Fire, windup_ms: 0, primary: false, aim: 0 }, 1.01 + i * 0.001, false);
    const ids = fx.castRecords().map((r) => r.rune?.caster);
    expect(ids.length).toBe(24);
    expect(ids).toContain(BOSS);
    expect(ids).toContain(YOU);
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

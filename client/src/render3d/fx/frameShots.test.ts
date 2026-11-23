import { newSmokeBuf } from './smoke';
import { describe, expect, it } from 'vitest';
import { CONST, KIND } from '../../generated/defs';
import type { EntState } from '../../game/world';
import { flightTime, shotZ } from '../../sim/arc';
import { newFxBuf } from '../models/fx';
import type { FxFrame } from './effects3d';
import { ARROW, FrameShots, TRAIL, isFrameShot } from './frameShots';
import { FxTris } from './tris';
import type { FxCtx, FxOut, StuckShot } from './types';

const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0 };
const ctx: FxCtx = { cam, ax: { right: [1, 0, 0], up: [0, 1, 0] }, now: 0, detail: 1, ballDetail: 2, smokeTone: null };
const newOut = (): FxOut => ({ tris: new FxTris(5000), lit: new FxTris(5000), glows: { position: [], uv: [], color: [], foot: [], n: 0 }, lights: [], smoke: newSmokeBuf() });
const frame = (now: number, o: Partial<FxFrame> = {}): FxFrame => ({
  ctx: { ...ctx, now }, figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(), you: 0, ownCast: null, ...o,
});
const ys = (T: FxTris): number[] => { const o = newFxBuf(); T.flush(o, cam, false); return o.position.filter((_, i) => i % 3 === 1); };
const ent = (id: number, kind: number, x: number, z: number): EntState => ({ id, kind, x, y: 80, z, aim: 0 } as EntState);

// An arrow flying #321's arc along +x: 160 px in 0.8 s, drawn at 60 frames a second up to `until` seconds.
const SPEED = 200, T = flightTime(160, SPEED);
function fly(fs: FrameShots, until: number, o: Partial<FxFrame> = {}): FxOut {
  let out = newOut();
  for (let t = 0; t <= until + 1e-9; t += 1 / 60) {
    out = newOut();
    fs.draw(out, frame(t, { ents: new Map([[7, ent(7, KIND.Arrow, SPEED * t, shotZ(T, t))]]), ...o }));
  }
  return out;
}

describe('frame shots (#407)', () => {
  it('are the shots with a pack frame: arrows, bolts and the thrown axe', () => {
    expect([KIND.Arrow, KIND.Bolt, KIND.ThrownAxe].every(isFrameShot)).toBe(true);
    expect([KIND.FireBolt, KIND.Missile, KIND.Wizard].some(isFrameShot)).toBe(false);
  });

  it('an arrow points along its arc: nose up while it rises, nose down while it falls', () => {
    const up = new FrameShots();
    fly(up, 0.1);
    expect(up.dirOf(7)![1]).toBeGreaterThan(0.1);
    const down = new FrameShots();
    fly(down, T - 0.05);
    const d = down.dirOf(7)!;
    expect(d[1]).toBeLessThan(-0.1);
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 6);
    expect(d[0]).toBeGreaterThan(0.5);
  });

  it('a level shot flies level, and a hidden one draws nothing', () => {
    const fs = new FrameShots();
    let out = newOut();
    for (let t = 0; t < 0.2; t += 1 / 60) { out = newOut(); fs.draw(out, frame(t, { ents: new Map([[7, ent(7, KIND.Bolt, SPEED * t, CONST.SHOT_HEIGHT)]]) })); }
    expect(fs.dirOf(7)![1]).toBeCloseTo(0, 6);
    expect(out.lit.n).toBeGreaterThan(0);
    const hid = newOut();
    new FrameShots().draw(hid, frame(0, { ents: new Map([[7, ent(7, KIND.Bolt, 0, 8)]]), hiddenShots: new Set([7]) }));
    expect(hid.lit.n).toBe(0);
  });

  it('the trail is lit and pale for an ordinary shot, glowing with sparkles and a glow for a magic one', () => {
    const plain = fly(new FrameShots(), 0.3);
    expect(plain.tris.n).toBe(0);
    expect(plain.glows.n).toBe(0);
    const magic = fly(new FrameShots(), 0.3, { shotMagic: new Map([[7, 0xff9926]]) });
    expect(magic.tris.n).toBeGreaterThan(40);
    expect(magic.glows.n).toBe(1);
    // the same arrow, and the trail moved from the lit list to the glowing one
    expect(magic.lit.n).toBeLessThan(plain.lit.n);
  });

  it('the trail outlives the shot by its length, the sparkles by their life; then the history is dropped', () => {
    const fs = new FrameShots();
    fly(fs, 0.3, { shotMagic: new Map([[7, 0xff9926]]) });
    const after = (dt: number): FxOut => { const o = newOut(); fs.draw(o, frame(0.3 + dt)); return o; };
    expect(after(TRAIL.secs / 2).lit.n).toBe(0);          // no arrow any more
    expect(after(TRAIL.secs / 2).tris.n).toBeGreaterThan(0);
    expect(after(0.6).tris.n).toBeGreaterThan(0);          // sparkles only
    expect(after(1).tris.n).toBe(0);
    expect(fs.dirOf(7)).toBeNull();
  });

  it('a stuck arrow takes the landing angle of the flight that ended there, tip in the ground', () => {
    const fs = new FrameShots();
    fly(fs, T - 1 / 60);
    const st: StuckShot = { x: 160, y: 80, kind: KIND.Arrow, aim: 0, alpha: 1, left: 1 };
    const out = newOut();
    fs.draw(out, frame(T + 0.01, { stuck: [st] }));
    expect(st.pitch).toBeCloseTo(Math.asin(-fs.dirOf(7)![1]), 6);
    const y = ys(out.lit);
    expect(Math.min(...y)).toBeLessThan(0);
    expect(Math.max(...y)).toBeGreaterThan(ARROW.len * Math.sin(st.pitch!) * 0.7);
    // a landing nobody saw fly gets the default angle
    const lone: StuckShot = { x: 900, y: 80, kind: KIND.Arrow, aim: 0, alpha: 1, left: 1 };
    fs.draw(newOut(), frame(T + 0.02, { stuck: [lone] }));
    expect(lone.pitch).toBeCloseTo(0.44, 6);
  });

  it('the axe is drawn flying and stuck', () => {
    const fs = new FrameShots(), out = newOut();
    fs.draw(out, frame(0, { ents: new Map([[9, ent(9, KIND.ThrownAxe, 0, 8)]]), stuck: [{ x: 300, y: 80, kind: KIND.ThrownAxe, aim: 0, alpha: 0.5, left: 0.2 }] }));
    expect(out.lit.n).toBeGreaterThan(100);
  });
});

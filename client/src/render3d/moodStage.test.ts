// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
import { FIRE_EVERY, MOOD_H, MOOD_W, moodMap } from '../game/moodDemoScript';
import { r3dPage, isR3dDemo, wants3d } from '../r3dFlag';
import { parseParams, type R3dParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import { createMoodStage, moodEnts } from './moodStage';
import type { FrameInput } from './view';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`npc_knight_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
const assets = { image: {} as HTMLImageElement, frames };

/** The stages a test made: each is disposed (its caption removed) when the test ends. */
const made: Stage[] = [];
afterEach(() => {
  for (const s of made.splice(0)) s.dispose();
});

interface Run { stage: Stage; setAirDev: boolean[]; frames: FrameInput[] }

/** Plays `seconds` of the page for `search` in steps of `dt`, collecting what the view was handed. */
function play(search: string, seconds: number, dt = 0.05): Run {
  const params = parseParams(search);
  const setAirDev: boolean[] = [];
  const host = { params, setParams(): void {}, setAirDev: (on: boolean) => setAirDev.push(on) };
  const stage = createMoodStage(assets, params, search, host);
  made.push(stage);
  const out: FrameInput[] = [];
  const view = { draw: (i: FrameInput) => (out.push(structuredCloneAir(i)), 0) };
  const zoom = 2;
  for (let n = 0; n < Math.round(seconds / dt); n++) {
    stage.frame({
      now: n * dt, dt, params: params as R3dParams, held: new Set<string>(), canvas: { w: 1280, h: 720 }, zoom,
      plan: { ...renderPlan('balanced', zoom, 1280, 720), halfW: 40, halfH: 40 }, canvasEl: null, view, timer: { lap() {}, renderStart() {} },
    } as unknown as StageCtx);
  }
  return { stage, setAirDev, frames: out };
}

/** The air parts are reused arrays: copy the counts of the frame. */
function structuredCloneAir(i: FrameInput): FrameInput {
  const a = i.air;
  return a ? { ...i, air: { ...a, parts: { ...a.parts, specks: { ...a.parts.specks }, embers: { ...a.parts.embers }, puffs: { ...a.parts.puffs } } as typeof a.parts } } : i;
}

describe('the ?r3d=mood stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=mood')).toBe('mood');
    expect(isR3dDemo('?r3d=mood')).toBe(true);
    expect(wants3d('?r3d=mood', true)).toBe(false);
  });

  it("shows the script's room, shows Stir and Draft, and has no cracks", () => {
    const r = play('?r3d=mood', 0.1);
    expect(r.stage.world.map.w).toBe(MOOD_W);
    expect(r.stage.world.map.h).toBe(MOOD_H);
    expect(Array.from(r.stage.world.map.tiles)).toEqual(Array.from(moodMap().tiles));
    expect(r.setAirDev).toEqual([true]);
    expect(r.frames[0].cracks ?? []).toHaveLength(0);
  });

  it('plays the knight, the arrow and the fireball as figures', () => {
    const e1 = moodEnts(1);
    expect(e1.filter((e) => e.kind === KIND.Knight)).toHaveLength(1);
    expect(e1.filter((e) => e.kind === KIND.Arrow)).toHaveLength(0); // the arrow starts at 1.5 s
    expect(e1.filter((e) => e.kind === KIND.Fireball)).toHaveLength(1);
    expect(e1.filter((e) => e.kind === KIND.Torch)).toHaveLength(4);
    expect(moodEnts(2).filter((e) => e.kind === KIND.Arrow)).toHaveLength(1);
  });

  it('passes the air with smoke from the lit torches', () => {
    const r = play('?r3d=mood&lcap=8', 4);
    const last = r.frames[r.frames.length - 1];
    expect(last.air).toBeTruthy();
    expect(last.air!.parts.puffs.count).toBeGreaterThan(0);
    expect(last.air!.haze).toEqual({ on: true, t: expect.any(Number) });
    expect(last.shafts).toBe(true);
  });

  it('gives no smoke with smoke=0 and no specks with dust=0', () => {
    const noSmoke = play('?r3d=mood&smoke=0', 4);
    expect(Math.max(...noSmoke.frames.map((f) => f.air!.parts.puffs.count))).toBe(0);
    const some = play('?r3d=mood', 6);
    expect(Math.max(...some.frames.map((f) => f.air!.parts.specks.count))).toBeGreaterThan(0);
    const none = play('?r3d=mood&dust=0', 6);
    expect(Math.max(...none.frames.map((f) => f.air!.parts.specks.count))).toBe(0);
  });

  it('throws one burst of embers where the fireball blasts, once per crossing', () => {
    const r = play('?r3d=mood', 2 * FIRE_EVERY);
    const n = r.frames.map((f) => f.air!.parts.embers.count);
    let jumps = 0;
    for (let i = 1; i < n.length; i++) if (n[i] - n[i - 1] >= 15) jumps++;
    expect(jumps).toBe(2);
  });
});

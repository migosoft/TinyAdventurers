// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CONST, KIND } from '../generated/defs';
import { TILE } from '../sim/map';
import { TORCHES, W, H, buildMap } from '../game/lightsDemoScript';
import { isR3dDemo, r3dPage } from '../r3dFlag';
import { parseParams, type R3dParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import { CRACK_TILE, createLightsStage, lightsEnts, lightsKnight } from './lightsStage';
import type { FrameInput } from './view';
import { SIGHT_MARGIN } from './sightmask';

// Only the walking knight's frames: enough for its card (and so its shadow); the torches are the world's models, not cards.
const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`npc_knight_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
const assets = { image: {} as HTMLImageElement, frames };

/** Runs one frame of a stage built for `search` and returns what it handed the view. */
function drawn(search: string, big = true, change?: (p: R3dParams) => R3dParams): { stage: Stage; f: FrameInput | null; host: { params: R3dParams; setParams(p: R3dParams): void } } {
  const initial = parseParams(search);
  const host = { params: initial, setParams(p: R3dParams): void { host.params = p; } };
  const stage = createLightsStage(assets, initial, search, host);
  const params = change ? change(initial) : initial;
  let f: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((f = i), 0) };
  const zoom = 2;
  const c = {
    now: 0, dt: 0, params, held: new Set<string>(), canvas: { w: 1280, h: 720 }, zoom,
    plan: big ? { ...renderPlan('balanced', zoom, 1280, 720), halfW: 40, halfH: 40 } : renderPlan('balanced', zoom, 1280, 720),
    canvasEl: null, view, timer: { lap() {}, renderStart() {} },
  } as unknown as StageCtx;
  stage.frame(c);
  return { stage, f, host };
}

describe('the ?r3d=lights stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=lights')).toBe('lights');
    expect(isR3dDemo('?r3d=lights')).toBe(true);
  });

  it("shows the script's map", () => {
    const { stage } = drawn('?r3d=lights');
    const map = buildMap();
    expect(stage.world.map.w).toBe(W);
    expect(stage.world.map.h).toBe(H);
    expect(Array.from(stage.world.map.tiles)).toEqual(Array.from(map.tiles));
  });

  it('lists the 7 torches, the daylight crack and the 2 moving lights at t = 0', () => {
    expect(TORCHES).toHaveLength(7);
    const { f } = drawn('?r3d=lights&t=0');
    expect(f!.lights).toHaveLength(10);
  });

  it('gives every torch entity a field light on its tile, on its wall, lit as it is (#391)', () => {
    const { stage } = drawn('?r3d=lights&t=0');
    for (const e of lightsEnts(0).filter((x) => x.kind === KIND.Torch)) {
      const l = stage.world.taken!.lights.find((x) => x.x === Math.floor(e.x / TILE) && x.y === Math.floor(e.y / TILE));
      expect(l?.wall).toBe(e.extra + 1);
      expect((l as { on?: boolean } | undefined)?.on).toBe(e.anim === 1);
    }
  });

  it('misses the blue torch at t = 3.1', () => {
    const ids = (f: FrameInput | null): string[] => (f!.lights as unknown as { id: string }[]).map((l) => l.id);
    const blue = `s${TORCHES.findIndex((t) => t.blue) + 1}`; // light ids run from 1 in TORCHES order
    const on = drawn('?r3d=lights&t=0').f;
    const off = drawn('?r3d=lights&t=3.1').f;
    expect(ids(on)).toContain(blue);
    expect(ids(off)).not.toContain(blue);
    expect(off!.lights).toHaveLength(9);
  });

  it('passes a dark sight mask centred on the viewer, off with sight=0, and on &at', () => {
    const s = drawn('?r3d=lights').f!.sight!;
    expect(s.mode).toBe('dark');
    expect(s.mask!.ox + s.mask!.size / 2).toBeCloseTo(7.5, 0);
    expect(s.mask!.oz + s.mask!.size / 2).toBeCloseTo(9.5, 0);
    expect(s.mask!.size).toBe(2 * (CONST.FOV_RADIUS + 0.5 + SIGHT_MARGIN));
    const off = drawn('?r3d=lights&sight=0').f!.sight!;
    expect(off.mode).toBe('off');
    expect(off.mask).toBeNull();
    const at = drawn('?r3d=lights&at=4,6').f!.sight!;
    expect(at.mask!.ox + at.mask!.size / 2).toBeCloseTo(4, 0);
    expect(at.mask!.oz + at.mask!.size / 2).toBeCloseTo(6, 0);
  });

  it('reads the darkvision from the params every frame', () => {
    const { f } = drawn('?r3d=lights', true, (p) => ({ ...p, dv: 100 }));
    expect(f!.darkvision).toEqual({ x: 7.5, z: 9.5, reach: CONST.FOV_RADIUS });
  });

  it('V advances the params darkvision 0, 50, 100, 0', () => {
    const { stage, host } = drawn('?r3d=lights');
    const key = (): boolean => stage.key!({ code: 'KeyV', repeat: false } as KeyboardEvent);
    const seen: (number | null)[] = [];
    for (let i = 0; i < 3; i++) {
      expect(key()).toBe(true);
      seen.push(host.params.dv);
    }
    expect(seen).toEqual([50, 100, 0]);
  });

  it('hands the view the lava pool (#344): both arrays, its clock and the shimmer on Balanced', () => {
    const { f } = drawn('?r3d=lights');
    expect(f?.lavaPool?.bubbles).toBeInstanceOf(Float32Array);
    expect(f?.lavaPool?.stirs).toBeInstanceOf(Float32Array);
    expect(f?.lavaPool?.heat).toBe(true);
  });

  it('passes the lava texels and no darkvision by default', () => {
    const { f } = drawn('?r3d=lights');
    expect(f!.lava).not.toBeNull();
    expect(f!.lava!.length).toBe(W * H * 4);
    expect(f!.darkvision).toBeNull();
    // the walking knight is the only figure with a shadow; the torches are not casters
    expect(f!.casters.map((c) => c.id)).toEqual([100]);
  });

  it('publishes the light and caster counts on window.__r3d for the F3 readout', () => {
    const state = {} as NonNullable<Window['__r3d']>;
    window.__r3d = state;
    try {
      const { f } = drawn('?r3d=lights&t=0');
      expect(state.lights).toEqual({ list: f!.lights.length, inView: expect.any(Number) });
      expect(state.lights!.inView).toBeGreaterThanOrEqual(state.lights!.list);
      expect(state.casters).toBe(f!.casters.length);
      expect(state.casters).toBe(1);
    } finally {
      delete window.__r3d;
    }
  });

  it('passes no casters in the work light', () => {
    const { f } = drawn('?r3d=lights&light=work');
    expect(f!.casters).toEqual([]);
  });

  it('gives no casters with the cap at 0', () => {
    const { f } = drawn('?r3d=lights&ccap=0');
    expect(f!.casters).toEqual([]);
  });

  it('takes the darkvision from dv, around the viewer', () => {
    const { f } = drawn('?r3d=lights&dv=50');
    expect(f!.darkvision).toEqual({ x: 7.5, z: 9.5, reach: 0.5 * CONST.FOV_RADIUS });
  });

  it('keeps the work light flat with no point lights', () => {
    const { f } = drawn('?r3d=lights&light=work');
    expect(f!.lights).toEqual([]);
  });

  it('walks a knight along a loop', () => {
    const a = lightsKnight(0);
    const b = lightsKnight(1);
    expect(a.x !== b.x || a.y !== b.y).toBe(true);
    const ents = lightsEnts(0);
    expect(ents.filter((e) => e.kind === KIND.Knight)).toHaveLength(1);
    // The torch with a figure each; the lava-side torch has none.
    expect(ents.filter((e) => e.kind === KIND.Torch)).toHaveLength(TORCHES.filter((t) => t.sprite).length);
    // and its light is a free one (wall 0): no torch model hangs on a wall that is not there
    const { stage } = drawn('?r3d=lights&t=0');
    const lava = TORCHES.findIndex((t) => !t.sprite);
    expect(stage.world.taken!.lights.find((l) => l.id === lava + 1)!.wall).toBe(0);
  });
});

describe('the ?r3d=lights stage: the Daylight crack and its shafts', () => {
  it('asks for the shafts and passes the crack, centred on a tile of the knight\'s west leg', () => {
    const { f } = drawn('?r3d=lights');
    expect(f!.shafts).toBe(true);
    expect(f!.cracks).toHaveLength(1);
    const c = f!.cracks![0];
    expect(c.fx).toBe(CRACK_TILE[0] + 0.5);
    expect(c.fz).toBe(CRACK_TILE[1] + 0.5);
    // The west leg runs along x 7.5 from z 8.5 to 14.5: the patch's centre lies on it, so the knight crosses the patch.
    // (7 + 10 + 3 = 20 tiles along the loop at 2 tiles/s: t = 11.5 s is the middle of that leg.)
    const mid = lightsKnight(11.5);
    expect(mid.x / 16).toBeCloseTo(7.5, 9);
    expect(c.fx).toBe(mid.x / 16);
    expect(c.fz).toBeGreaterThanOrEqual(8.5);
    expect(c.fz).toBeLessThanOrEqual(14.5);
  });

  it('sends the crack only if the viewer sees its tile (the stage\'s sight mask), and every crack with sight off', () => {
    expect(drawn('?r3d=lights&at=7.5,9.5').f!.cracks).toHaveLength(1);
    expect(drawn('?r3d=lights&at=25,7').f!.cracks).toHaveLength(0);
    expect(drawn('?r3d=lights&at=25,7&sight=0').f!.cracks).toHaveLength(1);
  });

  it('sends none in the work light', () => {
    expect(drawn('?r3d=lights&light=work').f!.cracks).toHaveLength(0);
  });
});

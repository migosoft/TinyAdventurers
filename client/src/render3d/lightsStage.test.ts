// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CONST, KIND } from '../generated/defs';
import { TORCHES, W, H, buildMap } from '../game/lightsDemoScript';
import { isR3dDemo, r3dPage, wants3d } from '../r3dFlag';
import { parseParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import { createLightsStage, lightsEnts, lightsKnight } from './lightsStage';
import type { FrameInput } from './view';

const assets = { image: {} as HTMLImageElement, frames: {} };

/** Runs one frame of a stage built for `search` and returns what it handed the view. */
function drawn(search: string, big = true): { stage: Stage; f: FrameInput | null } {
  const params = parseParams(search);
  const stage = createLightsStage(assets, params, search);
  let f: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((f = i), 0) };
  const zoom = 2;
  const c = {
    now: 0, dt: 0, params, held: new Set<string>(), canvas: { w: 1280, h: 720 }, zoom,
    plan: big ? { ...renderPlan('balanced', zoom, 1280, 720), halfW: 40, halfH: 40 } : renderPlan('balanced', zoom, 1280, 720),
    canvasEl: null, view, timer: { lap() {}, renderStart() {} },
  } as unknown as StageCtx;
  stage.frame(c);
  return { stage, f };
}

describe('the ?r3d=lights stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=lights')).toBe('lights');
    expect(isR3dDemo('?r3d=lights')).toBe(true);
    expect(wants3d('?r3d=lights', true)).toBe(false);
  });

  it("shows the script's map", () => {
    const { stage } = drawn('?r3d=lights');
    const map = buildMap();
    expect(stage.world.map.w).toBe(W);
    expect(stage.world.map.h).toBe(H);
    expect(Array.from(stage.world.map.tiles)).toEqual(Array.from(map.tiles));
  });

  it('lists the 7 torches and the 2 moving lights at t = 0', () => {
    expect(TORCHES).toHaveLength(7);
    const { f } = drawn('?r3d=lights&t=0');
    expect(f!.lights).toHaveLength(9);
  });

  it('misses the blue torch at t = 3.1', () => {
    const { f } = drawn('?r3d=lights&t=3.1');
    expect(f!.lights).toHaveLength(8);
  });

  it('passes the lava texels and no darkvision by default', () => {
    const { f } = drawn('?r3d=lights');
    expect(f!.lava).not.toBeNull();
    expect(f!.lava!.length).toBe(W * H * 4);
    expect(f!.darkvision).toBeNull();
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
  });
});

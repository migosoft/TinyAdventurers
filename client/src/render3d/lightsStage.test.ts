// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CONST, KIND } from '../generated/defs';
import { TORCHES, W, H, buildMap } from '../game/lightsDemoScript';
import { isR3dDemo, r3dPage, wants3d } from '../r3dFlag';
import { parseParams, type R3dParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import { createLightsStage, lightsEnts, lightsKnight } from './lightsStage';
import type { FrameInput } from './view';

const assets = { image: {} as HTMLImageElement, frames: {} };

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
    const ids = (f: FrameInput | null): string[] => (f!.lights as unknown as { id: string }[]).map((l) => l.id);
    const blue = `s${TORCHES.findIndex((t) => t.blue) + 1}`; // light ids run from 1 in TORCHES order
    const on = drawn('?r3d=lights&t=0').f;
    const off = drawn('?r3d=lights&t=3.1').f;
    expect(ids(on)).toContain(blue);
    expect(ids(off)).not.toContain(blue);
    expect(off!.lights).toHaveLength(8);
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

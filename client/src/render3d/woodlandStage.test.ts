// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { isR3dDemo, r3dPage, wants3d } from '../r3dFlag';
import { parseParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import { SUN_MAP, fitSunMap, mistLightOf, sky, sunView } from './sun';
import { footprint } from './lights';
import type { FrameInput } from './view';
import { WIND } from './wind';
import { createWoodlandStage } from './woodlandStage';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`npc_knight_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
const assets = { image: {} as HTMLImageElement, frames };

/** A stage built for `search`; `run(n, dt)` runs n frames and returns the last one handed to the view. */
function setup(search: string, start = 0) {
  const p = parseParams(search);
  const host = { setDaylight: vi.fn(), setSky: vi.fn() };
  const stage: Stage = createWoodlandStage(assets, p, search, host);
  let f: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((f = i), 0) };
  let now = start;
  const run = (n: number, dt: number, held: string[] = []): FrameInput => {
    for (let i = 0; i < n; i++) {
      now += dt;
      const c = {
        now, dt, params: p, held: new Set(held), canvas: { w: 1280, h: 720 }, zoom: 2,
        plan: { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 },
        canvasEl: null, view, timer: { lap() {}, renderStart() {} },
      } as unknown as StageCtx;
      stage.frame(c);
    }
    return f!;
  };
  return { stage, host, run, p };
}

describe('the ?r3d=woodland stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=woodland')).toBe('woodland');
    expect(isR3dDemo('?r3d=woodland')).toBe(true);
    expect(wants3d('?r3d=woodland', true)).toBe(false);
  });

  it('shows a painted world and turns on the sky rows and the mist rows', () => {
    const { stage, host } = setup('?r3d=woodland');
    expect(stage.world.painted).toBe(true);
    expect(stage.world.map.w).toBe(40);
    expect(host.setSky).toHaveBeenCalledWith(true);
    expect(host.setDaylight).toHaveBeenCalledWith(true);
  });

  it('hands the view the sun, the ambient and the mist day of the hour', () => {
    const { run } = setup('?r3d=woodland&hour=13&hourRate=0');
    const f = run(1, 0.016);
    const s = sky(13);
    expect(f.sun!.dir).toEqual(s.dir);
    expect(f.sun!.colour).toEqual(s.colour);
    expect(f.ambient).toEqual(s.ambient);
    expect(f.sight!.mode).toBe('mist');
    expect(f.sight!.mistDay).toBe(s.day);
    expect(f.sight!.mistLight).toEqual(mistLightOf(s));
    expect(f.sun!.shadows).toBe(true);
    expect(f.sun!.clouds).toBe(true);
    expect(f.sun!.wind).toEqual(WIND);
    expect(f.sight!.wind).toEqual(WIND);
  });

  it('fits the shadow map to the sun and the footprint', () => {
    const { run, p } = setup('?r3d=woodland&hour=9.5&hourRate=0&quality=fast');
    const f = run(1, 0.016);
    const cam = f.cam;
    const fit = fitSunMap(sky(9.5).dir, sunView(footprint(cam, 40, 40), cam), { w: 40, h: 26 }, SUN_MAP.fast);
    expect(f.sun!.fit).toEqual(fit);
    expect(p.quality).toBe('fast');
  });

  it('has the moon at hour 0', () => {
    const { run } = setup('?r3d=woodland&hour=0&hourRate=0');
    const f = run(1, 0.016);
    expect(sky(0).moon).toBe(true);
    expect(f.sun!.dir).toEqual(sky(0).dir);
    expect(f.ambient).toEqual(sky(0).ambient);
  });

  it('keeps the hour with hourRate=0 and runs it otherwise', () => {
    const still = setup('?r3d=woodland&hour=10&hourRate=0');
    const a = still.run(1, 0.016).sun!.dir;
    const b = still.run(10, 1).sun!.dir;
    expect(b).toEqual(a);
    const moving = setup('?r3d=woodland&hour=10&hourRate=100');
    const c = moving.run(1, 0.016).sun!.dir;
    const d = moving.run(10, 1).sun!.dir;
    expect(d).not.toEqual(c);
  });

  it('switches clouds and wind off with clouds=0 and wind=0', () => {
    const { run } = setup('?r3d=woodland&clouds=0&wind=0');
    const f = run(1, 0.016);
    expect(f.sun!.clouds).toBe(false);
    expect(f.sun!.wind).toEqual([0, 0]);
    expect(f.sight!.wind).toEqual([0, 0]);
  });

  it('moves the mist and the clouds on one clock', () => {
    // The page's clock (`now`) started long before the stage: the stage's own seconds drive both.
    const { run } = setup('?r3d=woodland&hourRate=0', 500);
    const f = run(5, 0.2);
    expect(f.sight!.t).toBe(f.sun!.t);
    expect(f.sight!.t).toBeCloseTo(1, 5);
    expect(run(1, 0.2).plants!.t).toBeCloseTo(f.sun!.t + 0.2, 5);
  });

  it('draws the plants a few at a time and hands them to the view with the wind switch', () => {
    const { run } = setup('?r3d=woodland&hourRate=0');
    const first = run(1, 0.016).plants!;
    expect(first.wind).toBe(true);
    expect(first.pages.length).toBeGreaterThan(0);
    const later = run(40, 0.016).plants!;
    expect(later.chunks.size).toBeGreaterThan(0);
    expect(later.t).toBeGreaterThan(first.t);
    expect(setup('?r3d=woodland&wind=0').run(1, 0.016).plants!.wind).toBe(false);
  });

  it('follows the Wall shadows switch', () => {
    expect(setup('?r3d=woodland&shadows=0').run(1, 0.016).sun!.shadows).toBe(false);
  });

  it('walks the knight with WASD, never onto a blocked tile, and the camera follows', () => {
    const { run, stage } = setup('?r3d=woodland&hourRate=0');
    const x0 = run(1, 0.016).cam.x;
    const after = run(30, 0.1, ['KeyD']);
    expect(after.cam.x).toBeGreaterThan(x0);
    const north = run(400, 0.1, ['KeyW']);
    const map = stage.world.map;
    // the forest edge stops it: the thicket rows are blocked, so it never enters row 2
    expect(north.cam.z).toBeGreaterThanOrEqual(3);
    expect(map.get(Math.floor(north.cam.x), Math.floor(north.cam.z))).not.toBe(TILE_ID.Thicket);
  });

  it('draws a fireball light and the daylight mask around the knight', () => {
    const { run } = setup('?r3d=woodland');
    const f = run(1, 0.016);
    expect(f.lights).toHaveLength(1);
    const m = f.sight!.mask!;
    expect(m.daylight).toBe(true);
    expect(m.ox + m.size / 2).toBeCloseTo(20.5, 0);
  });

  it('shows no sight with sight=0 but still a sun', () => {
    const f = setup('?r3d=woodland&sight=0').run(1, 0.016);
    expect(f.sight!.mode).toBe('off');
    expect(f.sun).not.toBeNull();
  });
});

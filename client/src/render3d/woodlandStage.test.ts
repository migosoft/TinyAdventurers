// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { KIND, SIDE, TILE_ID } from '../generated/defs';
import { FIGURES } from '../game/anim/defs';
import type { FigureKit } from './models/kit';
import { isR3dDemo, r3dPage } from '../r3dFlag';
import { parseParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import { SUN_MAP, fitSunMap, mistLightOf, sky, sunView } from './sun';
import { footprint } from './lights';
import type { FrameInput } from './view';
import { WIND } from './wind';
import { BRUSH_LANE, brushWalk, WOODLAND_STAGE_EXTRA, WOODLAND_STAGE_PLANTS, woodlandStageMap } from './woodlandMap';
import { createWoodlandStage, woodlandEnts } from './woodlandStage';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`npc_knight_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
for (const d of Object.values(FIGURES)) {
  for (let i = 0; i < 4; i++) for (const q of [d.idle, d.run]) frames[`${q}${i}`] = { x: 0, y: 0, w: 16, h: 28 };
  for (const q of [d.hit, d.weapon, d.meleeWeapon]) if (q) frames[q] = { x: 0, y: 0, w: 8, h: 20 };
  for (const a of Object.values(d.frames ?? {})) for (let i = 0; i < a.n; i++) frames[`${a.prefix}${i}`] = { x: 0, y: 0, w: 86, h: 54 };
}
const assets = { image: {} as HTMLImageElement, frames };

/** A stage built for `search`; `run(n, dt)` runs n frames and returns the last one handed to the view. `kit` stands in for the model kit. */
function setup(search: string, start = 0, kit?: FigureKit) {
  const p = parseParams(search);
  const host = { setDaylight: vi.fn(), setSky: vi.fn() };
  const stage: Stage = createWoodlandStage(assets, p, search, host, { kit });
  let f: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((f = i), 0), maxTexture: 512, setGround: vi.fn(), setCover: vi.fn() };
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
  return { stage, host, run, p, view };
}

describe('the ?r3d=woodland stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=woodland')).toBe('woodland');
    expect(isR3dDemo('?r3d=woodland')).toBe(true);
  });

  it('shows a painted world and turns on the sky rows and the mist rows', () => {
    const { stage, host } = setup('?r3d=woodland');
    expect(stage.world.painted).toBe(true);
    expect(stage.world.map.w).toBe(40);
    expect(host.setSky).toHaveBeenCalledWith(true);
    expect(host.setDaylight).toHaveBeenCalledWith(true);
  });

  it('starts the knight, and so the camera, at `at=x,z` (tiles) when the URL gives a free tile (#329)', () => {
    const f = setup('?r3d=woodland&at=18,21').run(1, 0.016);
    expect(f.cam.x).toBeCloseTo(18.5);
    expect(f.cam.z).toBeCloseTo(21.5);
    expect(setup('?r3d=woodland&at=18,22').run(1, 0.016).cam).toMatchObject({ x: 20.5, z: 11.5 }); // a Trunk tile: ignored
    expect(setup('?r3d=woodland&at=abc').run(1, 0.016).cam).toMatchObject({ x: 20.5, z: 11.5 });
  });

  it('builds the grass cover whole: the bare ground and the cover go to the view, the frame carries the cover parameters (#330)', () => {
    window.__r3d = { backend: 'test', frames: 0, renderSize: [0, 0], zoom: 1 };
    const { stage, view, run } = setup('?r3d=woodland&gh=2');
    stage.built!(view as never);
    expect(view.setGround).toHaveBeenCalledTimes(1);
    expect(view.setCover).toHaveBeenCalledTimes(1);
    const cover = view.setCover.mock.calls[0][0] as { sheets: number; bushels: unknown[] };
    expect(cover.sheets).toBe(4);
    const f = run(1, 0.016);
    expect(f.cover).toMatchObject({ on: true, gh: 2, wind: true });
    expect(window.__r3d.cover).toEqual({ sheets: 4, bushels: cover.bushels.length });
    stage.built!(view as never); // a rebuilt view gets the kept cover, not a new one
    expect((view.setCover.mock.calls[1][0] as { image: unknown }).image).toBe((cover as unknown as { image: unknown }).image);
    delete window.__r3d;
  });

  it('says how many trees are built of all in window.__r3d.plants (for the pictures script)', () => {
    window.__r3d = { backend: 'test', frames: 0, renderSize: [0, 0], zoom: 1 };
    const { run } = setup('?r3d=woodland');
    run(1, 0.016);
    expect(window.__r3d.plants!.total).toBe(WOODLAND_STAGE_PLANTS.length + WOODLAND_STAGE_EXTRA.length);
    expect(window.__r3d.plants!.built).toBeGreaterThan(0);
    delete window.__r3d;
  });

  it('draws the leaf override and the plain switch of the URL through to the trees', () => {
    const f = setup('?r3d=woodland&leaf=25&plain=1').run(1, 0.016);
    expect(f.trees!.leafOverride).toBe(0.25);
    expect(f.trees!.plain).toBe(true);
    expect(setup('?r3d=woodland').run(1, 0.016).trees!.leafOverride).toBe(-1);
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
    const fit = fitSunMap(sky(9.5).dir, sunView(footprint(cam, 40, 40), cam), { w: 40, h: 26 }, 512);
    expect(SUN_MAP.fast).toBeGreaterThan(512);
    expect(f.sun!.fit).toEqual(fit); // fitted at the device's clamped size, not at SUN_MAP
    expect(f.sun!.fit.size).toBe(512);
    expect(p.quality).toBe('fast');
  });

  it('sends no sun under the work light, as a run does', () => {
    expect(setup('?r3d=woodland&light=work').run(1, 0.016).sun).toBeNull();
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
    expect(run(1, 0.2).trees!.t).toBeCloseTo(f.sun!.t + 0.2, 5);
  });

  it('grows the trees a few at a time and hands them to the view with the wind switch', () => {
    const { run } = setup('?r3d=woodland&hourRate=0');
    const first = run(1, 0.016);
    expect(first).not.toHaveProperty('plants');
    expect(first.trees!.wind).toBe(true);
    expect(first.trees!.chunks.size).toBeGreaterThan(0);
    const later = run(40, 0.016).trees!;
    expect(later.chunks.size).toBeGreaterThan(0);
    expect(later.t).toBeGreaterThan(first.trees!.t);
    expect(setup('?r3d=woodland&wind=0').run(1, 0.016).trees!.wind).toBe(false);
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
    expect(f.lights.map((l) => l.shadow).sort()).toEqual([false, true]); // the pixie (no shadow) and the fireball
    const m = f.sight!.mask!;
    expect(m.daylight).toBe(true);
    expect(m.ox + m.size / 2).toBeCloseTo(20.5, 0);
  });

  it('hands seven model figures to Figures3d with models=1: the walking paladin, three heroes, a skeleton, the ogre and the wolf (#338)', () => {
    const asked: string[] = [];
    const kit = { get: (k: string) => (asked.push(k), null), picture: () => null, known: () => true, times: new Map(), version: 0, dispose: vi.fn() };
    const { run } = setup('?r3d=woodland&models=1', 0, kit);
    const f = run(2, 0.016);
    expect(new Set(asked)).toEqual(new Set(['knight', 'wizard', 'dwarf', 'elf', 'skelet', 'ogre', 'wolf']));
    expect(f.models!.kit).toBe(kit);
    expect(f.models!.insts).toEqual([]); // nothing is built yet: they are cards until then
  });

  it('keeps cards for every figure without models=1, and makes no kit', () => {
    const asked: string[] = [];
    const kit = { get: (k: string) => (asked.push(k), null), picture: () => null, known: () => true, times: new Map(), version: 0, dispose: vi.fn() };
    const { run } = setup('?r3d=woodland', 0, kit);
    expect(run(2, 0.016).models).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('puts the seven where a figure can stand, and the monsters on the hostile side', () => {
    expect(woodlandEnts(true, 0, { x: 20, z: 13, aim: 0, moving: false }).length).toBe(7);
    const es = woodlandEnts(true, 0, { x: 20, z: 13, aim: 0, moving: false });
    expect(es.filter((e) => e.side === SIDE.Hostile).map((e) => e.kind).sort()).toEqual([KIND.SkeletonWarrior, KIND.Ogre, KIND.DireWolf].sort());
    expect(woodlandEnts(false, 0, { x: 20, z: 13, aim: 0, moving: false }).map((e) => e.kind)).toEqual([KIND.Knight, KIND.Wizard, KIND.Paladin, KIND.Barbarian, KIND.ElvenRanger]);
    const map = woodlandStageMap();
    for (let t = 0; t < 20; t += 1.7) for (const e of woodlandEnts(true, t, { x: 20, z: 13, aim: 0, moving: false })) expect(map.blocks(Math.floor(e.x / 16), Math.floor(e.y / 16), 'hero')).toBe(false);
  });

  it('shows no sight with sight=0 but still a sun', () => {
    const f = setup('?r3d=woodland&sight=0').run(1, 0.016);
    expect(f.sight!.mode).toBe('off');
    expect(f.sun).not.toBeNull();
  });

  it('with brush=1 paces the knight along the lane and feeds the brushers; a pinned t gives the same brushers twice (#331)', () => {
    const a = setup('?r3d=woodland&brush=1&t=2').run(1, 0.016);
    const b = setup('?r3d=woodland&brush=1&t=2').run(1, 0.016);
    expect(a.brush!.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(a.brush))).toEqual(JSON.parse(JSON.stringify(b.brush)));
    expect(a.t).toBe(2);
    expect(setup('?r3d=woodland&brush=1&t=2', 500).run(3, 0.1).t).toBe(2); // the page's clock does not move a pinned picture
    expect(a.brush![0].z).toBeCloseTo(BRUSH_LANE.z + 0.5); // the knight on the lane
    expect(a.brush![0].x).toBeCloseTo(brushWalk(2).x);
    expect(a.cam).toMatchObject({ x: BRUSH_LANE.bush.x, z: BRUSH_LANE.bush.z }); // the camera holds on the bush
    expect(setup('?r3d=woodland').run(3, 0.016).brush).toEqual([]);
  });
});

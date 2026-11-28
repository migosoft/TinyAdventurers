// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_KIND, TILE_ID } from '../generated/defs';
import { isR3dDemo, r3dPage } from '../r3dFlag';
import { parseParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import { COVE_STAGE, PILLARS, coveStageMap, createCoveStage } from './coveStage';
import { Cove3d, coveWillow } from './cove3d';
import { buildTree } from './trees/build';
import type { FrameInput } from './view';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {
  cove_bush_a: { x: 100, y: 0, w: 24, h: 20 }, cove_bush_b: { x: 130, y: 0, w: 24, h: 20 },
  cove_tuft_a: { x: 160, y: 0, w: 12, h: 8 }, cove_tuft_b: { x: 180, y: 0, w: 12, h: 8 }, cove_fern: { x: 200, y: 0, w: 14, h: 14 },
  floor_1: { x: 300, y: 0, w: 16, h: 16 },
};
for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`npc_knight_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
const assets = { image: {} as HTMLImageElement, frames };

/** A stage built for `search`; `run(n, dt)` runs n frames and returns the last one handed to the view. */
function setup(search: string) {
  const p = parseParams(search);
  const stage: Stage = createCoveStage(assets, p, search);
  let f: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((f = i), 0), maxTexture: 512, setCover: vi.fn() };
  let now = 0;
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
  return { stage, run, view };
}

describe('the ?r3d=cove stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=cove')).toBe('cove');
    expect(isR3dDemo('?r3d=cove')).toBe(true);
  });

  it('keeps the torch pillars outside the willow\'s reach', () => {
    const w = coveWillow(COVE_STAGE);
    const radius = buildTree(w).radius;
    for (const p of PILLARS) expect(Math.hypot(p.x + 0.5 - w.x, p.y + 0.5 - w.z)).toBeGreaterThan(radius + 0.5);
  });

  it('is a dark stone map with the room as floor and the trunk tile at the tree', () => {
    const { stage } = setup('?r3d=cove');
    const map = stage.world.map;
    expect(stage.world.painted).toBe(false);
    expect(map.get(COVE_STAGE.tree_x, COVE_STAGE.tree_y)).toBe(TILE_ID.Trunk);
    expect(map.get(COVE_STAGE.x, COVE_STAGE.y)).toBe(TILE_ID.Floor);
    expect(map.get(COVE_STAGE.x - 1, COVE_STAGE.y)).toBe(TILE_ID.Wall);
    expect(Array.from(map.tiles)).toEqual(Array.from(coveStageMap().tiles));
  });

  it("draws the cove's willow and bushes as trees without a sun; its tufts and ferns are no atlas plants", () => {
    const f = setup('?r3d=cove').run(60, 0.016);
    expect(f.sun ?? null).toBeNull();
    expect(f.trees!.complete).toBe(true);
    expect(f.trees!.chunks.size).toBeGreaterThan(0);
    expect(f).not.toHaveProperty('plants');
    expect(new Cove3d(COVE_STAGE, frames).bushes().length).toBeGreaterThan(0);
  });

  it("builds the room's cover (moss and the cove's grass with bushels from the tufts and ferns) and hands it to the view (#330)", () => {
    window.__r3d = { backend: 'test', frames: 0, renderSize: [0, 0], zoom: 1 };
    const { stage, view, run } = setup('?r3d=cove&gh=1.5&cover=0');
    stage.built!(view as never);
    expect(view.setCover).toHaveBeenCalledTimes(1);
    const cover = view.setCover.mock.calls[0][0] as { sheets: number; bushels: unknown[]; bare: unknown };
    expect(cover.bare).toBeNull();
    expect(cover.bushels.length).toBeGreaterThan(0);
    const f = run(1, 0.016);
    expect(f.cover).toMatchObject({ on: false, gh: 1.5 });
    expect(window.__r3d.cover).toEqual({ sheets: cover.sheets, bushels: cover.bushels.length });
    delete window.__r3d;
  });

  it('lights it with two torches and the pixies, and shadows the willow and its bushes (#333)', () => {
    const f = setup('?r3d=cove&sight=0').run(1, 0.016);
    const ids = (f.lights as unknown as { id: string }[]).map((l) => l.id);
    expect(ids.filter((i) => i.startsWith('x'))).toHaveLength(7);
    expect(ids.filter((i) => i === 's1' || i === 's2')).toHaveLength(2);
    expect(f.plantShadows!.plants.length).toBeGreaterThan(0);
    expect(f.plantShadows).toMatchObject({ tile: 128, cap: 40 });
    expect(setup('?r3d=cove&quality=fast').run(1, 0.016).plantShadows).toBeNull();
  });

  it('has the cove\'s five suns, as finish_cove places them, and drops the torches with &torches=0 (#333)', () => {
    const at = (search: string) => (setup(search).stage.world.taken!.lights as { kind: number; x: number; y: number }[]);
    const c = COVE_STAGE;
    const want = [[c.tree_x, c.tree_y], ...[1, 3].flatMap((f) => [1, 3].map((g) => [c.x + Math.floor((c.w * f) / 4), c.y + Math.floor((c.h * g) / 4)]))];
    const l = at('?r3d=cove');
    expect(l.filter((k) => k.kind === LIGHT_KIND.Daylight).map((k) => [k.x, k.y])).toEqual(want);
    expect(l.filter((k) => k.kind === LIGHT_KIND.Torch)).toHaveLength(2);
    expect(at('?r3d=cove&torches=0').filter((k) => k.kind === LIGHT_KIND.Torch)).toHaveLength(0);
    expect(setup('?r3d=cove&sight=0').run(1, 0.016).cracks!.length).toBe(5);
  });

  it('shows the pixies as glows and has the knight walk with WASD', () => {
    const { run } = setup('?r3d=cove');
    const a = run(2, 0.016); // the first frame's sight mask is still blank
    expect(a.dynamic.glows.count).toBeGreaterThan(0);
    const x0 = a.cam.x;
    const b = run(30, 0.016, ['KeyD']);
    expect(b.cam.x).toBeGreaterThan(x0);
  });

  it('says how many trees are built of all in window.__r3d.plants', () => {
    window.__r3d = { backend: 'test', frames: 0, renderSize: [0, 0], zoom: 1 };
    const { run } = setup('?r3d=cove');
    run(1, 0.016);
    expect(window.__r3d.plants!.built).toBeGreaterThan(0);
    run(60, 0.016);
    expect(window.__r3d.plants!.total).toBeGreaterThan(1);
    expect(window.__r3d.plants!.built).toBe(window.__r3d.plants!.total);
    delete window.__r3d;
  });
});

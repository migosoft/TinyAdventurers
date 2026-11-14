// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { isR3dDemo, r3dPage, wants3d } from '../r3dFlag';
import { parseParams } from './params';
import { renderPlan } from './quality';
import type { Stage, StageCtx } from './host';
import { COVE_STAGE, coveStageMap, createCoveStage } from './coveStage';
import { CAST_ID0, Cove3d } from './cove3d';
import type { FrameInput } from './view';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {
  cove_tree: { x: 0, y: 0, w: 96, h: 100 }, cove_bush_a: { x: 100, y: 0, w: 24, h: 20 }, cove_bush_b: { x: 130, y: 0, w: 24, h: 20 },
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
  const view = { draw: (i: FrameInput) => ((f = i), 0), maxTexture: 512 };
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
  return { stage, run };
}

describe('the ?r3d=cove stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=cove')).toBe('cove');
    expect(isR3dDemo('?r3d=cove')).toBe(true);
    expect(wants3d('?r3d=cove', true)).toBe(false);
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

  it("draws the cove's willow and bushes as trees without a sun and its tufts and ferns as plants", () => {
    const f = setup('?r3d=cove').run(60, 0.016);
    expect(f.sun ?? null).toBeNull();
    expect(f.trees!.complete).toBe(true);
    expect(f.trees!.chunks.size).toBeGreaterThan(0);
    expect(f.plants).toBeDefined();
    expect(new Cove3d(COVE_STAGE, frames).bushes().length).toBeGreaterThan(0);
  });

  it('lights it with two torches and the pixies, and casts the willow', () => {
    const f = setup('?r3d=cove&sight=0').run(1, 0.016);
    const ids = (f.lights as unknown as { id: string }[]).map((l) => l.id);
    expect(ids.filter((i) => i.startsWith('x'))).toHaveLength(7);
    expect(ids.filter((i) => !i.startsWith('x'))).toHaveLength(2);
    expect(f.casters.some((k) => k.id === CAST_ID0)).toBe(true);
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

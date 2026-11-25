// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { FIGURES } from '../game/anim/defs';
import { r3dPage } from '../r3dFlag';
import demo from '../generated/pond-demo.json';
import { TileMap } from '../sim/map';
import { parseParams } from './params';
import { renderPlan } from './quality';
import type { StageCtx } from './host';
import type { FrameInput } from './view';
import { createPondStage } from './pondStage';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`npc_knight_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
for (const d of Object.values(FIGURES)) {
  for (let i = 0; i < 4; i++) for (const q of [d.idle, d.run]) frames[`${q}${i}`] = { x: 0, y: 0, w: 16, h: 28 };
  for (const q of [d.hit, d.weapon, d.meleeWeapon]) if (q) frames[q] = { x: 0, y: 0, w: 8, h: 20 };
}
const assets = { image: {} as HTMLImageElement, frames };

function setup(search: string) {
  const p = parseParams(search);
  const host = { setDaylight: vi.fn(), setSky: vi.fn() };
  const stage = createPondStage(assets, p, search, host);
  let f: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((f = i), 0), maxTexture: 512, setGround: vi.fn(), setCover: vi.fn() };
  let now = 0;
  const run = (n: number, dt: number, held: string[] = []): FrameInput => {
    for (let i = 0; i < n; i++) {
      now += dt;
      stage.frame({
        now, dt, params: p, held: new Set(held), canvas: { w: 1280, h: 720 }, zoom: 2,
        plan: { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 },
        canvasEl: null, view, timer: { lap() {}, renderStart() {} },
      } as unknown as StageCtx);
    }
    return f!;
  };
  return { stage, host, run };
}

const isWater = (t: number) => t === TILE_ID.ShallowWater || t === TILE_ID.DeepWater;

describe('the ?r3d=pond stage (#360)', () => {
  it('is a dev page', () => {
    expect(r3dPage('?r3d=pond')).toBe('pond');
  });

  it('the pond page builds each demo level', () => {
    for (let i = 0; i < demo.length; i++) {
      for (const at of ['pond', 'mouth', 'bridge', 'stream']) {
        const { stage, host, run } = setup(`?r3d=pond&pond=${i}&at=${at}`);
        const rules = new TileMap(demo[i].w, demo[i].h, Uint8Array.from(demo[i].tiles));
        const k = (stage as unknown as { knight: { x: number; z: number } }).knight;
        const tx = Math.floor(k.x), tz = Math.floor(k.z);
        expect(rules.blocks(tx, tz, 'hero')).toBe(false);
        if (at === 'pond') {
          expect(isWater(rules.get(tx, tz))).toBe(false);
          let near = false;
          for (let j = -3; j <= 3; j++) for (let x = -3; x <= 3; x++) near ||= isWater(rules.get(tx + x, tz + j));
          expect(near).toBe(true);
        }
        const f = run(2, 0.016);
        expect(f.water).toBeDefined();
        expect(f.trees!.chunks.size).toBeGreaterThan(0);
        expect(host.setSky).toHaveBeenCalledWith(true);
        expect((stage as unknown as { scene: { field: { decks: unknown[] } } }).scene.field.decks.length).toBe(demo[i].woodland!.pond.bridges.length);
      }
    }
  });

  it('walks the knight on the rules map: never into deep water', () => {
    const { stage, run } = setup('?r3d=pond&pond=0');
    const k = (stage as unknown as { knight: { x: number; z: number } }).knight;
    const rules = new TileMap(demo[0].w, demo[0].h, Uint8Array.from(demo[0].tiles));
    for (let i = 0; i < 200; i++) { run(1, 0.1, ['KeyW']); expect(rules.get(Math.floor(k.x), Math.floor(k.z))).not.toBe(TILE_ID.DeepWater); }
  });
});

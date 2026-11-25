// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { CONST, TILE_ID } from '../generated/defs';
import { FIGURES } from '../game/anim/defs';
import { r3dPage } from '../r3dFlag';
import demo from '../generated/pond-demo.json';
import { TileMap } from '../sim/map';
import { parseParams } from './params';
import { renderPlan } from './quality';
import type { StageCtx } from './host';
import type { FrameInput } from './view';
import { createPondStage } from './pondStage';
import { sky, waterSky } from './sun';

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
const rulesOf = (i: number) => new TileMap(demo[i].w, demo[i].h, Uint8Array.from(demo[i].tiles));

describe('the ?r3d=pond stage (#360)', () => {
  it('is a dev page', () => {
    expect(r3dPage('?r3d=pond')).toBe('pond');
  });

  it('the pond page builds each demo level', () => {
    for (let i = 0; i < demo.length; i++) {
      const rules = rulesOf(i);
      for (const at of ['pond', 'mouth', 'bridge', 'stream']) {
        const { stage, host, run } = setup(`?r3d=pond&pond=${i}&at=${at}`);
        const tx = Math.floor(stage.knight.x), tz = Math.floor(stage.knight.z);
        expect(rules.blocks(tx, tz, 'hero')).toBe(false);
        if (at === 'pond') {
          // dry, no water beside it, and a tile of the pond's own body within 2 tiles
          expect(isWater(rules.get(tx, tz))).toBe(false);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(isWater(stage.world.map.get(tx + dx, tz + dz))).toBe(false);
          let near = false;
          for (let j = -2; j <= 2; j++) for (let x = -2; x <= 2; x++) near ||= stage.body.has((tz + j) * rules.w + tx + x);
          expect(near).toBe(true);
        }
        const f = run(2, 0.016);
        expect(f.water).toBeDefined();
        expect(f.trees!.chunks.size).toBeGreaterThan(0);
        expect(host.setSky).toHaveBeenCalledWith(true);
        expect(stage.scene.field.decks.length).toBe(demo[i].woodland!.pond.bridges.length);
      }
    }
  });

  it('gives the water the hour\'s sky, and `&dry=1` leaves the surface out', () => {
    const wet = setup('?r3d=pond&pond=0&hour=13');
    expect(wet.stage.world.dry).toBe(false);
    expect(wet.run(1, 0.016).water!.sky).toEqual(waterSky(sky(13)));
    expect(setup('?r3d=pond&pond=0&dry=1').stage.world.dry).toBe(true);
  });

  it('walks the knight on the rules map: it moves, and never into deep water', () => {
    const { stage, run } = setup('?r3d=pond&pond=0');
    const rules = rulesOf(0);
    const z0 = stage.knight.z;
    for (let i = 0; i < 200; i++) { run(1, 0.1, ['KeyW']); expect(rules.get(Math.floor(stage.knight.x), Math.floor(stage.knight.z))).not.toBe(TILE_ID.DeepWater); }
    expect(stage.knight.z).not.toBeCloseTo(z0, 1);
  });

  it('a step in shallow water is SHALLOW_SPEED times a step on dry ground', () => {
    const rules = rulesOf(1);
    let shallow: string | null = null, dry: string | null = null;
    for (let z = 0; z < rules.h && !(shallow && dry); z++) for (let x = 0; x < rules.w - 1; x++) {
      if (rules.blocks(x + 1, z, 'hero') || rules.blocks(x, z, 'hero')) continue;
      if (!shallow && rules.get(x, z) === TILE_ID.ShallowWater) shallow = `${x},${z}`;
      if (!dry && rules.get(x, z) === TILE_ID.Floor) dry = `${x},${z}`;
    }
    const step = (at: string): number => {
      const { stage, run } = setup(`?r3d=pond&pond=1&at=${at}`);
      const x0 = stage.knight.x;
      run(1, 0.05, ['KeyD']);
      return stage.knight.x - x0;
    };
    expect(shallow && dry).toBeTruthy();
    expect(step(dry!)).toBeGreaterThan(0);
    expect(step(shallow!) / step(dry!)).toBeCloseTo(CONST.SHALLOW_SPEED, 5);
  });
});

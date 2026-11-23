// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isR3dDemo, r3dPage } from '../../r3dFlag';
import { parseParams } from '../params';
import { renderPlan } from '../quality';
import type { StageCtx } from '../host';
import type { FrameInput } from '../view';
import { LAID, ROCK } from './field';
import { kindAt, stoneField } from './field';
import { PLACES, STONE_SEED, STONE_TORCHES, stoneMap, zoneKinds } from './stoneMap';
import { createStoneStage } from './stoneStage';

const assets = { image: {} as HTMLImageElement, frames: {} };

/** Builds the stage for `search` and runs one frame; returns the stage and what it handed the view. */
function drawn(search: string): { world: ReturnType<typeof createStoneStage>['world']; f: FrameInput } {
  const p = parseParams(search);
  const stage = createStoneStage(assets, p, search);
  let f: FrameInput | null = null;
  const view = { draw: (i: FrameInput) => ((f = i), 0) };
  stage.frame({
    now: 0, dt: 0.016, params: p, held: new Set<string>(), canvas: { w: 1280, h: 720 }, zoom: 2,
    plan: { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 }, canvasEl: null, view, timer: { lap() {}, renderStart() {} },
  } as unknown as StageCtx);
  return { world: stage.world, f: f! };
}

describe('the ?r3d=stone stage (#380)', () => {
  it('is a dev page that builds without a GPU, with torches in the laid rooms and crystals in the caves', () => {
    expect(r3dPage('?r3d=stone')).toBe('stone');
    expect(isR3dDemo('?r3d=stone')).toBe(true);
    const { world, f } = drawn('?r3d=stone&at=hall');
    expect(world.stone!.kinds.some((k) => k === ROCK)).toBe(true);
    expect(f.lights.length).toBeGreaterThan(0);
    expect(drawn('?r3d=stone&at=hall&lamp=0').f.lights).toHaveLength(f.lights.length - 1); // the knight's own lamp
  });

  it('turns every crystal light off for &break=1', () => {
    expect(drawn('?r3d=stone&at=cave&break=1').f.lights.length).toBeLessThan(drawn('?r3d=stone&at=cave').f.lights.length);
  });

  it('gives a field of only rock for &stone=rock, and only laid for &stone=laid', () => {
    expect(Array.from(new Set(drawn('?r3d=stone&stone=rock').world.stone!.kinds))).toEqual([ROCK]);
    expect(Array.from(new Set(drawn('?r3d=stone&stone=laid').world.stone!.kinds))).toEqual([LAID]);
  });

  it('STONE_TORCHES: torches on laid and on rock walls, a west and an east rock wall, one out; each on an opaque cell with open floor in front', () => {
    const map = stoneMap(), f = stoneField(map, zoneKinds(map), STONE_SEED);
    const kind = (t: (typeof STONE_TORCHES)[number]): number => kindAt(f, t.tx, t.ty);
    expect(STONE_TORCHES.some((t) => kind(t) === LAID && t.lit)).toBe(true);
    expect(STONE_TORCHES.some((t) => kind(t) === LAID && !t.lit)).toBe(true);
    for (const side of [0, 1, 2]) expect(STONE_TORCHES.some((t) => kind(t) === ROCK && t.side === side && t.lit), `side ${side}`).toBe(true);
    expect(STONE_TORCHES.some((t) => kind(t) === ROCK && !t.lit)).toBe(true);
    for (const t of STONE_TORCHES) {
      const [dx, dy] = [[0, -1], [-1, 0], [1, 0]][t.side];
      expect(map.opaque(t.tx + dx, t.ty + dy), `wall of ${t.tx},${t.ty}`).toBe(true);
      expect(map.opaque(t.tx, t.ty), `floor of ${t.tx},${t.ty}`).toBe(false);
    }
    expect(new Set(STONE_TORCHES.map((t) => `${t.tx},${t.ty},${t.side}`)).size).toBe(STONE_TORCHES.length);
  });

  it('starts the camera in the place asked for', () => {
    const [x, z] = PLACES.hall;
    const { f } = drawn('?r3d=stone&at=hall');
    expect(Math.abs(f.cam.x - x)).toBeLessThan(1);
    expect(Math.abs(f.cam.z - z)).toBeLessThan(1);
  });
});

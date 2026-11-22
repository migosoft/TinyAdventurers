// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isR3dDemo, r3dPage } from '../../r3dFlag';
import { parseParams } from '../params';
import { renderPlan } from '../quality';
import type { StageCtx } from '../host';
import type { FrameInput } from '../view';
import { ROCK } from './field';
import { PLACES } from './stoneMap';
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
    expect(drawn('?r3d=stone&at=hall&lamp=0').f.lights).toHaveLength(0);
  });

  it('gives a field of only rock for &stone=rock, and only laid for &stone=laid', () => {
    expect(Array.from(new Set(drawn('?r3d=stone&stone=rock').world.stone!.kinds))).toEqual([ROCK]);
    expect(Array.from(new Set(drawn('?r3d=stone&stone=laid').world.stone!.kinds))).toEqual([0]);
  });

  it('starts the camera in the place asked for', () => {
    const [x, z] = PLACES.hall;
    const { f } = drawn('?r3d=stone&at=hall');
    expect(Math.abs(f.cam.x - x)).toBeLessThan(1);
    expect(Math.abs(f.cam.z - z)).toBeLessThan(1);
  });
});

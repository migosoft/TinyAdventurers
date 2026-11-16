// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { r3dPage, isR3dDemo, wants3d } from '../r3dFlag';
import { parseParams, type R3dParams } from './params';
import { renderPlan } from './quality';
import type { PageButton } from './panel';
import type { Stage, StageCtx } from './host';
import { createLiquidsStage } from './liquidsStage';
import type { FrameInput } from './view';

const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
for (const n of ['elf_f', 'knight_m', 'imp', 'chort']) for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`${n}_${a}_anim_f${i}`] = { x: 0, y: 0, w: 16, h: 28 };
const assets = { image: {} as HTMLImageElement, frames };

const made: Stage[] = [];
afterEach(() => { for (const s of made.splice(0)) s.dispose(); delete (window as { __r3d?: unknown }).__r3d; });

function make(search: string): { stage: Stage; buttons: PageButton[]; step: (n: number, dt?: number) => FrameInput[] } {
  const params = parseParams(search);
  const buttons: PageButton[] = [];
  const host = { setPageButtons: (l: PageButton[]) => { buttons.splice(0, buttons.length, ...l); }, syncPageButtons(): void {} };
  const stage = createLiquidsStage(assets, params, search, host as never);
  made.push(stage);
  let now = 0;
  const out: FrameInput[] = [];
  const view = { draw: (i: FrameInput) => (out.push(i), 0), tileChanged(): void {} };
  const step = (n: number, dt = 0.05): FrameInput[] => {
    const mine: FrameInput[] = [];
    for (let k = 0; k < n; k++) {
      now += dt;
      const before = out.length;
      stage.frame({ now, dt, params: params as R3dParams, held: new Set<string>(), canvas: { w: 1280, h: 720 }, zoom: 2, plan: { ...renderPlan('balanced', 2, 1280, 720), halfW: 40, halfH: 40 }, canvasEl: null, view, timer: { lap() {}, renderStart() {} } } as unknown as StageCtx);
      mine.push(...out.slice(before));
    }
    return mine;
  };
  return { stage, buttons, step };
}

const g = (): { t: number; fallers: number } | undefined => (window as unknown as { __r3d?: { liquids?: { t: number; fallers: number } } }).__r3d?.liquids;

describe('the ?r3d=liquids stage', () => {
  it('is a dev page of its own', () => {
    expect(r3dPage('?r3d=liquids')).toBe('liquids');
    expect(isR3dDemo('?r3d=liquids')).toBe(true);
    expect(wants3d('?r3d=liquids', true)).toBe(false);
  });

  it('builds frames without a view error', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids');
    expect(r.stage.world.map.w).toBe(18);
    expect(r.step(10)).toHaveLength(10);
    expect(g()!.fallers).toBe(0);
  });

  it('pushes into the chasm on key 1', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids');
    r.step(4);
    expect(r.stage.key!({ code: 'Digit1', repeat: false } as KeyboardEvent)).toBe(true);
    let seen = 0;
    for (let k = 0; k < 20; k++) { r.step(1); seen = Math.max(seen, g()!.fallers); }
    expect(seen).toBe(1);
    expect(r.buttons.map((b) => b.name)).toEqual(['Push chasm', 'Push water', 'Push barrel']);
  });

  it('pins the clock with &t and asks &push at 1 s', () => {
    (window as unknown as { __r3d: object }).__r3d = {};
    const r = make('?r3d=liquids&push=chasm&t=1.5');
    r.step(3);
    expect(g()!.t).toBeCloseTo(1.5);
    expect(g()!.fallers).toBe(1); // the imp sank at 1.35 and falls until 2.05
  });
});

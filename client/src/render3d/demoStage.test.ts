// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from './params';
import { renderPlan } from './quality';
import type { StageCtx } from './host';
import { createDemoStage } from './demoStage';
import type { FrameInput } from './view';

describe('the ?r3d=demo stage (#330)', () => {
  it('builds moss in every room and hands it to the view; the frame carries the cover parameters', () => {
    window.__r3d = { backend: 'test', frames: 0, renderSize: [0, 0], zoom: 1 };
    const stage = createDemoStage({ image: {} as HTMLImageElement, frames: {} }, DEFAULTS);
    let f: FrameInput | null = null;
    const view = { draw: (i: FrameInput) => ((f = i), 0), maxTexture: 512, setCover: vi.fn() };
    stage.built!(view as never);
    expect(view.setCover).toHaveBeenCalledTimes(1);
    const r = view.setCover.mock.calls[0][0] as { sheets: number; bushels: unknown[]; bare: unknown };
    expect(r.sheets).toBe(2); // moss: 2 px at most
    expect(r.bare).toBeNull();
    stage.frame({
      now: 1, dt: 0.016, params: { ...DEFAULTS, gh: 2 }, held: new Set(), canvas: { w: 1280, h: 720 }, zoom: 2,
      plan: renderPlan('balanced', 2, 1280, 720), canvasEl: null, view, timer: { lap() {}, renderStart() {} },
    } as unknown as StageCtx);
    expect(f!.cover).toEqual({ on: true, gh: 2, wind: true, t: 1 });
    expect(window.__r3d.cover).toEqual({ sheets: 2, bushels: 0 });
    stage.built!(view as never);
    expect((view.setCover.mock.calls[1][0] as typeof r & { image: unknown }).image).toBe((r as typeof r & { image: unknown }).image); // the kept result
    delete window.__r3d;
  });
});

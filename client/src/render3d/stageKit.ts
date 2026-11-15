// The figure kit of a dev stage (#338): sprite pixels read from the atlas image, a model worker, and the readout `window.__r3d.models`.
// Normal runs never make one (they never choose an entity for a model).

import { createKit, workerRunner, type FigureKit } from './models/kit';
import type { SpritePixels } from './models/weapons';
import type { Assets } from './view';

/** `sprite(name)` for the kit: the frame `name` of the atlas image as RGBA (rows top to bottom), read through a canvas once and kept. Null for an unknown frame. */
export function atlasSprites(assets: Assets): (name: string) => SpritePixels | null {
  const cache = new Map<string, SpritePixels | null>();
  let ctx: CanvasRenderingContext2D | null = null;
  return (name) => {
    if (cache.has(name)) return cache.get(name)!;
    const r = assets.frames[name];
    let px: SpritePixels | null = null;
    if (r) {
      const c = document.createElement('canvas');
      c.width = r.w;
      c.height = r.h;
      ctx = c.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(assets.image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        const d = ctx.getImageData(0, 0, r.w, r.h);
        px = { w: r.w, h: r.h, data: new Uint8ClampedArray(d.data) };
      }
    }
    cache.set(name, px);
    return px;
  };
}

/** One kit for a stage: models built in a worker off the atlas image. The stage keeps it across a rebuilt view and disposes it when it ends. */
export const createStageKit = (assets: Assets): FigureKit => createKit(atlasSprites(assets), workerRunner());

/** What the stage publishes as `window.__r3d.models`: the layer's counts of the last frame and the kit's build times (ms by key). */
export function modelsReadout(kit: FigureKit, drawn: { figures: number; batches: number; draws: number }): { figures: number; batches: number; draws: number; builtMs: Record<string, number> } {
  return { figures: drawn.figures, batches: drawn.batches, draws: drawn.draws, builtMs: Object.fromEntries(kit.times) };
}

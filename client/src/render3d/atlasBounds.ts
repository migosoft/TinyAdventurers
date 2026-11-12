// The opaque bounds of an atlas frame, read from the atlas image: the Phaser-free twin of `frameBounds` (game/status.ts).
// The pose (game/anim/pose.ts) wants them for the lying layout and the frame's size.
import type { FrameBounds } from '../game/anim/pose';
import type { FrameRects } from './worldMesh';

/** Bounds of the rectangle `r` in RGBA pixels `px` of an image `imgW` wide; a fully transparent frame counts as fully opaque. */
export function boundsOfPixels(px: ArrayLike<number>, imgW: number, r: { x: number; y: number; w: number; h: number }): FrameBounds {
  let l = r.w;
  let right = -1;
  let t = r.h;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++)
      if (px[((r.y + y) * imgW + r.x + x) * 4 + 3] > 0) {
        l = Math.min(l, x);
        right = Math.max(right, x);
        t = Math.min(t, y);
      }
  return right < 0 ? { l: 0, r: r.w - 1, t: 0, w: r.w, h: r.h } : { l, r: right, t, w: r.w, h: r.h };
}

const NONE = { x: 0, y: 0, w: 16, h: 16 };

/**
 * `bounds(frame)`: read once from the atlas image (the whole image is drawn into a canvas on the first call), then cached.
 * Without a readable image (a test's stand-in) the bounds are the whole frame. A frame the atlas lacks is 16 x 16.
 */
export function atlasBounds(image: CanvasImageSource, frames: FrameRects): (frame: string) => FrameBounds {
  const cache = new Map<string, FrameBounds>();
  let pixels: { data: Uint8ClampedArray; w: number } | null | undefined;
  const load = (): { data: Uint8ClampedArray; w: number } | null => {
    if (pixels !== undefined) return pixels;
    pixels = null;
    try {
      const w = (image as { naturalWidth?: number; width?: number }).naturalWidth || (image as { width?: number }).width || 0;
      const h = (image as { naturalHeight?: number; height?: number }).naturalHeight || (image as { height?: number }).height || 0;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (g && w > 0 && h > 0) {
        g.drawImage(image, 0, 0);
        pixels = { data: g.getImageData(0, 0, w, h).data, w };
      }
    } catch {
      pixels = null;
    }
    return pixels;
  };
  return (frame) => {
    let b = cache.get(frame);
    if (b) return b;
    const r = frames[frame] ?? NONE;
    const px = frames[frame] ? load() : null;
    b = px ? boundsOfPixels(px.data, px.w, r) : { l: 0, r: r.w - 1, t: 0, w: r.w, h: r.h };
    cache.set(frame, b);
    return b;
  };
}

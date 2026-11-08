// Ground shadows of plants: the pure projection of a plant raster into a solid black raster.
import type { SunInfo } from '../../generated/SunInfo';
import type { Drawn, Rgba } from '../vegetation';

export const SHADOW_X = 0.9, SHADOW_Y = 0.45, SHADOW_ALPHA = 0.28, CONTACT_RX = 0.3, CONTACT_RY = 0.12;

/** Ground offset (px per px of height) a plant's shadow is thrown by. */
export interface ShadowVec { sx: number; sy: number }

/** The shadow falls away from the sun (side -1 = sun on the left, shadow to the right) and toward the viewer. */
export function shadowVector(sun: SunInfo): ShadowVec {
  const L = 1 / Math.tan(sun.elevation * Math.PI / 180);
  return { sx: -sun.side * L * SHADOW_X, sy: L * SHADOW_Y };
}

/**
 * The shadow of a plant: a solid raster (alpha 255 where shadow, else 0) and `foot`, the point of it that sits on the
 * plant's world foot. `mirrored` mirrors the plant's pixels first (as WoodlandView does); the shadow is never flipped.
 */
export function shadowOf(img: Rgba, foot: { x: number; y: number }, vec: ShadowVec, mirrored: boolean): Drawn {
  const { w, h, data } = img;
  const fx = mirrored ? w - foot.x : foot.x, fy = foot.y;
  const rx = CONTACT_RX * w, ry = CONTACT_RY * w;
  const pts: number[] = [];
  let minX = Math.floor(fx - rx), maxX = Math.ceil(fx + rx), minY = Math.floor(fy - ry), maxY = Math.ceil(fy + ry);
  for (let y = 0; y < h; y++) {
    const ht = fy - y;
    if (ht <= 0) continue;
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue;
      const px = Math.round((mirrored ? w - 1 - x : x) + ht * vec.sx), py = Math.round(fy + ht * vec.sy);
      pts.push(px, py);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
  }
  const sw = maxX - minX + 1, sh = maxY - minY + 1;
  const out = new Uint8ClampedArray(sw * sh * 4);
  const put = (x: number, y: number) => { out[((y - minY) * sw + (x - minX)) * 4 + 3] = 255; };
  for (let i = 0; i < pts.length; i += 2) put(pts[i], pts[i + 1]);
  const cx = Math.round(fx), cy = Math.round(fy);
  for (let y = Math.floor(fy - ry); y <= Math.ceil(fy + ry); y++) {
    for (let x = Math.floor(fx - rx); x <= Math.ceil(fx + rx); x++) {
      const dx = (x - cx) / Math.max(rx, 0.5), dy = (y - cy) / Math.max(ry, 0.5);
      if (dx * dx + dy * dy <= 1) put(x, y);
    }
  }
  return { img: { w: sw, h: sh, data: out }, foot: { x: fx - minX, y: fy - minY } };
}

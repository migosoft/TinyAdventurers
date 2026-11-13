// The pure sight functions of the 2D view, without Phaser (#305): the polygon wedge geometry, the scanline
// raster and blur of the grey field, the mask resolution, the soft shadow's test and the haze look. The 2D mask
// files (visionmask.ts, shademask.ts, unseenfx.ts) re-export them; the 3D view (render3d) imports them from here.
import { inside } from '../sim/vispoly';
import type { View } from '../sim/view';

/** How dark the soft shadow is (alpha of black). */
export const SHADE = 0.3;

/** Is the point (world px) in the soft shadow: inside the hard polygon and outside the full one? */
export function shadeCovers(hard: View, all: View, x: number, y: number): boolean {
  return inside(hard.polygon, hard.px, hard.py, x, y) && !inside(all.polygon, all.px, all.py, x, y);
}

/** What unseen ground looks like. `blurPx` is in world pixels (the canvas is at screen resolution and the integer zoom lives on the camera). */
export interface HazeLook {
  /** Unseen strength beyond sight (0..1; read by VisionMask.outside). */
  outside: number;
  /** Unseen strength behind a soft blocker such as a trunk (read by VisionMask.soft). */
  soft: number;
  /** The wash colour, 0xRRGGBB. */
  colour: number;
  /** How far full unseen strength moves the colour toward `colour`. */
  mix: number;
  /** How far full unseen strength moves the colour toward grey. */
  desat: number;
  /** Blur tap distance at full strength, in world pixels. */
  blurPx: number;
  /** The blur radius of the vision mask in world pixels: how softly the edge of sight fades (read by VisionMask.feather). */
  feather: number;
  /** World px behind a soft blocker over which the haze grows from nothing to `soft` (read by VisionMask.ramp); 0: crisp from the blocker's edge. */
  ramp: number;
}

/** First guess, tuned on the phone. */
export const DEFAULT_HAZE: HazeLook = { outside: 0.8, soft: 0.7, colour: 0xb8c4cc, mix: 0.45, desat: 0.6, blurPx: 1.5, feather: 24, ramp: 24 };

/**
 * Every point of a polygon (flat x, y pairs) moved `d` world px outward along its ray from (px, py). Written into
 * `out` (resized, so a caller can reuse one array and allocate nothing per redraw); `out` may be `points` itself.
 */
export function extendPoints(points: ArrayLike<number>, px: number, py: number, d: number, out: number[] = []): number[] {
  const n = points.length;
  out.length = n;
  for (let i = 0; i < n; i += 2) {
    const dx = points[i] - px, dy = points[i + 1] - py;
    const len = Math.hypot(dx, dy);
    const k = len > 0 ? (len + d) / len : 1;
    out[i] = px + dx * k;
    out[i + 1] = py + dy * k;
  }
  return out;
}

/**
 * The points within 1 px of distance `r` from (px, py) (the rays that reached the radius) moved `ext` px outward; the
 * others stay. A hard wall face that happens to lie within 1 px of `r` is moved too (rare, cosmetic). Written into
 * `out` like `extendPoints`.
 */
export function extendRim(points: ArrayLike<number>, px: number, py: number, r: number, ext: number, out: number[] = []): number[] {
  const n = points.length;
  out.length = n;
  for (let i = 0; i < n; i += 2) {
    const dx = points[i] - px, dy = points[i + 1] - py;
    const len = Math.hypot(dx, dy);
    if (Math.abs(len - r) <= 1 && len > 0) {
      out[i] = px + dx * ((len + ext) / len);
      out[i + 1] = py + dy * ((len + ext) / len);
    } else {
      out[i] = points[i];
      out[i + 1] = points[i + 1];
    }
  }
  return out;
}

/**
 * The wedge's ramp as `n` layers, lightest first: layer k covers everything at least `depth` world px behind the
 * full polygon and darkens it to `grey`, a step `(k + 1) / n` of the way from white to the `soft` grey. With `ramp` 0
 * there is one layer at the full `soft` grey from depth 0 (crisp).
 */
export function rampLayers(soft: number, ramp: number, n: number): { depth: number; grey: number }[] {
  if (ramp <= 0) return [{ depth: 0, grey: soft }];
  return Array.from({ length: n }, (_, k) => ({ depth: (k * ramp) / n, grey: Math.round(255 - (255 - soft) * ((k + 1) / n)) }));
}

/** Sub-scanlines per canvas row of `fillPolygon`: its vertical antialiasing (horizontally the coverage is exact). */
const SUB = 4;
const byValue = (a: number, b: number) => a - b;

/** Work arrays of `fillPolygon`, kept by the caller so a redraw allocates nothing once they have grown. */
export interface RasterScratch { xs: number[][]; row: Float32Array }

/** Adds `wt` × the covered part of each pixel of `row` between x positions `xa` and `xb`. */
function addSpan(row: Float32Array, w: number, xa: number, xb: number, wt: number): void {
  xa = Math.max(0, xa);
  xb = Math.min(w, xb);
  if (xb <= xa) return;
  const ia = Math.floor(xa), ib = Math.floor(xb);
  if (ia === ib) {
    row[ia] += (xb - xa) * wt;
    return;
  }
  row[ia] += (ia + 1 - xa) * wt;
  for (let i = ia + 1; i < ib; i++) row[i] += wt;
  if (ib < w) row[ib] += (xb - ib) * wt;
}

/**
 * Paints a polygon (flat world x, y pairs; even-odd) in white into the grey `field` (`w`×`h`, 0..255) the way a
 * canvas fill would: each pixel moves toward 255 by the share of it the polygon covers. A world point (x, y) lands
 * on canvas px ((x - tx) · s, (y - ty) · s). Scanline fill with `SUB` sub-scanlines per row (#290: the haze mask is
 * built in memory, so it is never read back from the canvas).
 */
export function fillPolygon(field: Float32Array, w: number, h: number, pts: ArrayLike<number>, tx: number, ty: number, s: number, scratch: RasterScratch): void {
  const lines = h * SUB;
  const xs = scratch.xs;
  while (xs.length < lines) xs.push([]);
  for (let l = 0; l < lines; l++) xs[l].length = 0;
  if (scratch.row.length < w) scratch.row = new Float32Array(w);
  const row = scratch.row;
  const n = pts.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const x0 = (pts[i] - tx) * s, y0 = (pts[i + 1] - ty) * s;
    const x1 = (pts[j] - tx) * s, y1 = (pts[j + 1] - ty) * s;
    if (y0 === y1) continue;
    // the sub-scanlines whose centre (l + 0.5) / SUB lies in [min y, max y): each crossing counted once at a shared vertex
    const lo = Math.max(0, Math.ceil(Math.min(y0, y1) * SUB - 0.5));
    const hi = Math.min(lines - 1, Math.ceil(Math.max(y0, y1) * SUB - 0.5) - 1);
    const k = (x1 - x0) / (y1 - y0);
    for (let l = lo; l <= hi; l++) xs[l].push(x0 + ((l + 0.5) / SUB - y0) * k);
  }
  for (let y = 0; y < h; y++) {
    row.fill(0, 0, w);
    let any = false;
    for (let k = 0; k < SUB; k++) {
      const c = xs[y * SUB + k];
      if (c.length < 2) continue;
      c.sort(byValue);
      for (let i = 0; i + 1 < c.length; i += 2) addSpan(row, w, c[i], c[i + 1], 1 / SUB);
      any = true;
    }
    if (!any) continue;
    for (let x = 0, o = y * w; x < w; x++, o++) if (row[x] > 0) field[o] += (255 - field[o]) * Math.min(1, row[x]);
  }
}

/** One running-sum box pass (window 2r+1, edge pixels repeated) over `n` values at `stride` apart, `src` into `dst`. */
function boxLine(src: Float32Array, dst: Float32Array, start: number, stride: number, n: number, r: number): void {
  const last = n - 1, first = src[start], end = src[start + last * stride];
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += i < 0 ? first : i > last ? end : src[start + i * stride];
  const div = 2 * r + 1;
  for (let i = 0; i < n; i++) {
    dst[start + i * stride] = sum / div;
    const add = i + r + 1, drop = i - r;
    sum += (add > last ? end : src[start + add * stride]) - (drop < 0 ? first : src[start + drop * stride]);
  }
}

/**
 * Blurs the grey `field` (`w`×`h`) in place: three separable box passes, close to a gaussian. `tmp` holds at least
 * `w`×`h` values. `radius` is in canvas px; 0 changes nothing.
 */
export function blurField(field: Float32Array, w: number, h: number, radius: number, tmp: Float32Array): void {
  const r = Math.floor(radius);
  if (r <= 0) return;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) boxLine(field, tmp, y * w, 1, w, r);
    for (let x = 0; x < w; x++) boxLine(tmp, field, x, w, h, r);
  }
}

/**
 * Canvas pixels per tile: 8 is enough for a straight, antialiased edge. Haze mode uses 4 (#280): its redraw is CPU work
 * (the raster, the blur, putImageData, the upload) on every frame the hero moves, and its edges are blurred anyway.
 */
export function canvasRes(haze: boolean): number {
  return haze ? 4 : 8;
}

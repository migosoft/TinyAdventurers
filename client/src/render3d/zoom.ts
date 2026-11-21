// The wheel zoom: limits, notch size, the glide and the label scale.

import { pickZoom } from './quality';

/** Tiles across x down of the view at the farthest zoom. */
export const FAR_TILES: readonly [number, number] = [28, 17.7];
/** Tiles across x down at the closest zoom. */
export const NEAR_TILES: readonly [number, number] = [6, 3.8];
/** Zoom factor per wheel notch. */
export const NOTCH = 1.12;
/** deltaMode 0: px per notch; deltaMode 1: 3 lines per notch; deltaMode 2: 1 page per notch. */
export const NOTCH_PX = 100;
/** Time constant of the glide, in s. */
export const GLIDE_TAU = 0.05;
export const LABEL_MIN = 0.75, LABEL_MAX = 1.3;

/** The zoom range for a w x h canvas, widened to hold the start zoom. */
export function zoomLimits(w: number, h: number, start: number): { min: number; max: number } {
  const min = Math.max(w / (16 * FAR_TILES[0]), h / (16 * FAR_TILES[1]));
  const max = Math.min(w / (16 * NEAR_TILES[0]), h / (16 * NEAR_TILES[1]));
  return { min: Math.min(min, start), max: Math.max(max, start) };
}

/** The zoom factor of one wheel event; above 1 for deltaY < 0 (closer). */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const unit = deltaMode === 1 ? 3 : deltaMode === 2 ? 1 : NOTCH_PX;
  return NOTCH ** (-deltaY / unit);
}

/** The zoom the overlay labels are sized for: they follow the square root of the zoom change, within limits. */
export function labelZoom(zoom: number, start: number): number {
  const r = Math.min(LABEL_MAX, Math.max(LABEL_MIN, Math.sqrt(zoom / start)));
  return start * r;
}

export class WheelZoom {
  // Both are ratios to the start zoom.
  private target = 1;
  private shown = 1;

  wheel(deltaY: number, deltaMode: number): void {
    this.target *= wheelFactor(deltaY, deltaMode);
  }

  /** Advances the glide by dt (s) and returns this frame's zoom for a w x h canvas. */
  frame(dt: number, w: number, h: number): number {
    const start = pickZoom(w, h);
    const l = zoomLimits(w, h, start);
    this.target = Math.min(l.max / start, Math.max(l.min / start, this.target));
    const d = Math.log(this.target) - Math.log(this.shown);
    if (Math.abs(d) < 1e-4) this.shown = this.target;
    else this.shown = Math.exp(Math.log(this.shown) + d * (1 - Math.exp(-dt / GLIDE_TAU)));
    return this.shown * start;
  }
}

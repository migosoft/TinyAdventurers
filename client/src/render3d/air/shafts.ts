// The light shafts' numbers and their CPU twins (#307). The shaft pass (shaftNodes.ts) is the dungeon 3D demo's `shafts` march at one
// pixel per art pixel; the sample points and the jitter are written here as plain code so tests can check them without a GPU.
import type { RenderPlan } from '../quality';
import type { Vec3 } from '../sun';
import type { Crack } from './cracks';

/** Samples along one pixel's ray from the surface up to the ceiling (the demo's N). */
export const SHAFT_STEPS = 14;
/** How much of the summed light a pixel keeps (the demo's uShaft; first guess). */
export const SHAFT_GAIN = 0.11;
/** The composite's 5-tap blur: the centre tap and each of the four diagonal taps (the demo's compProg); together 1. */
export const BLUR_CENTRE = 0.36;
export const BLUR_DIAG = 0.16;

const fract = (x: number): number => x - Math.floor(x);

/**
 * The interleaved-gradient offset of an art pixel, 0..1: fixed per pixel, never per frame (no grain, no flicker). The demo adds
 * `uFrame * 0.61803` to move the pattern; here nothing moves it, so the blur of the composite alone smooths it.
 */
export function ignOffset(px: number, py: number): number {
  return fract(52.9829189 * fract(px * 0.06711056 + py * 0.00583715));
}

/** CPU twin of the march: the sample points from surface `P` toward the camera (unit `toward`) up to height `top`; `j` is the pixel's offset. */
export function marchPoints(P: Vec3, toward: Vec3, top: number, j: number, steps: number = SHAFT_STEPS): Vec3[] {
  const dt = Math.max(top - P[1], 0) / toward[1] / steps;
  const out: Vec3[] = [];
  for (let k = 0; k < steps; k++) {
    const s = (k + j) * dt;
    out.push([P[0] + toward[0] * s, P[1] + toward[1] * s, P[2] + toward[2] * s]);
  }
  return out;
}

/** What the shaft pass of one frame needs: the work size in art px, the composite's scale and texel, and the ceiling to march up to. */
export interface ShaftPlan {
  artW: number; artH: number;
  /** The picture's share of the shaft texture (1 when the art grid is the picture; less when drawing straight to the canvas, whose size is not a whole number of art px). */
  uvScale: [number, number];
  texel: [number, number];
  top: number;
}

/** Whether the pass runs this frame (shafts on and at least one crack) and how; null: none of its three renders runs and no target is made. */
export function shaftPlan(f: { plan: RenderPlan; shafts?: boolean; cracks?: readonly Crack[] }): ShaftPlan | null {
  if (!f.shafts || !f.cracks || f.cracks.length === 0) return null;
  const { artW, artH, targetW, targetH, ze } = f.plan;
  let top = 0;
  for (const c of f.cracks) top = Math.max(top, c.ceil);
  return {
    artW, artH,
    uvScale: [targetW / ze / artW, targetH / ze / artH],
    texel: [1 / artW, 1 / artH],
    top,
  };
}

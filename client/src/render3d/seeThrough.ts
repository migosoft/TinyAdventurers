// The see-through mask of the 3D view (#303 Task 8): walls open softly around the things standing behind them.
// Pure parts here (strengths, the Bayer threshold, the disc quads, the opening rule); `view.ts` draws the quads into a
// quarter-size mask and `materials.ts` reads it in the wall shader.
import type { Cam } from './camera';
import { viewRay } from './camera';
import type { Opener } from './figures';

export type SeeMode = 'soft' | 'lattice' | 'off';
/** `radius` in tiles on screen; `keep` 0..1 of the wall that stays at the centre; `edge` 0..1 of the radius the fade runs over. */
export interface SeeLook { mode: SeeMode; radius: number; keep: number; edge: number }
export const SEE_DEFAULTS: SeeLook = { mode: 'soft', radius: 1.3, keep: 0.15, edge: 0.4 };

/** The look the page's parameters ask for. */
export function seeLook(p: { see: SeeMode; seeR: number; seeKeep: number; seeEdge: number }): SeeLook {
  return { mode: p.see, radius: p.seeR, keep: p.seeKeep, edge: p.seeEdge };
}

/** The mask stores `SEE_DEPTH_BIAS - near` in green, so that every value is positive and the cleared 0 loses a MAX blend against any disc. */
export const SEE_DEPTH_BIAS = 48;
/** A wall opens only if it is at least this many tiles nearer the camera than the thing. */
export const SEE_DEPTH_MARGIN = 0.05;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Strength of the opening at distance `d` (tiles on screen) from a disc's centre: 1 inside (1 - edge) * radius, a smoothstep to 0 at the radius. */
export function discStrength(d: number, look: SeeLook): number {
  const full = (1 - look.edge) * look.radius;
  if (d <= full) return 1;
  if (d >= look.radius) return 0;
  return 1 - smoothstep(full, look.radius, d);
}

/** How much of the wall stays at strength `k`: 1 - k * (1 - keep). */
export function wallKeep(k: number, look: SeeLook): number {
  return 1 - k * (1 - look.keep);
}

/** 4x4 Bayer threshold (0..1) at an output pixel: the bits of x ^ y and y, interleaved (the wall shader computes the same). */
export function bayer4(px: number, py: number): number {
  const x = ((px % 4) + 4) % 4, y = ((py % 4) + 4) % 4;
  const xy = x ^ y;
  return ((xy & 1) * 8 + (y & 1) * 4 + ((xy >> 1) & 1) * 2 + ((y >> 1) & 1)) / 16;
}

/**
 * The rule the wall shader applies at one pixel: the mask's red (`strength`) is above 0 and the wall is nearer the camera
 * than the farthest thing under the disc (`green` = `SEE_DEPTH_BIAS - near` of that thing).
 */
export function wallOpens(strength: number, green: number, wallNear: number): boolean {
  return strength > 0 && wallNear > SEE_DEPTH_BIAS - green + SEE_DEPTH_MARGIN;
}

/**
 * Camera-facing disc quads (two triangles each) at each opener's mid point: `position` is world x y z, `uv` runs -1..1, `near` is
 * dot(p - target, viewRay) (larger = nearer the camera; one value per disc, constant over its quad).
 */
export function discQuads(openers: readonly Opener[], cam: Cam, look: SeeLook): { position: Float32Array; uv: Float32Array; near: Float32Array; count: number } {
  const n = openers.length;
  const position = new Float32Array(n * 18);
  const uv = new Float32Array(n * 12);
  const near = new Float32Array(n * 6);
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  // Screen right and up in world space (the inverse of `project`).
  const rx = c * look.radius, rz = s * look.radius;
  const ux = s * sp * look.radius, uy = cp * look.radius, uz = -c * sp * look.radius;
  const ray = viewRay(cam.pitch, cam.yaw);
  const corners: [number, number][] = [[-1, 1], [-1, -1], [1, -1], [-1, 1], [1, -1], [1, 1]];
  openers.forEach((o, i) => {
    const nr = (o.x - cam.x) * ray[0] + o.mid * ray[1] + (o.z - cam.z) * ray[2];
    corners.forEach(([u, v], k) => {
      const j = i * 6 + k;
      position[j * 3] = o.x + u * rx + v * ux;
      position[j * 3 + 1] = o.mid + v * uy;
      position[j * 3 + 2] = o.z + u * rz + v * uz;
      uv[j * 2] = u;
      uv[j * 2 + 1] = v;
      near[j] = nr;
    });
  });
  return { position, uv, near, count: n };
}

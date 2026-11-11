// Per-frame quads of the demo scene: figure and prop cards, torch flames and glows.
import { facesLeft, snapGround, type Cam } from './camera';
import { torchFlicker } from './light';
import { frameOf, orbAt, type SceneState } from './scene';
import type { FrameRects } from './worldMesh';

export interface Quads { position: Float32Array; uv: Float32Array; count: number } // 6 vertices per quad
export interface Glows { position: Float32Array; uv: Float32Array; color: Float32Array; count: number } // uv -1..1; color rgb already times strength
export interface Dynamic { cards: Quads; emissive: Quads; glows: Glows }

type V = [number, number, number, number, number]; // x y z u v
// Corners run top-left, top-right, bottom-right, bottom-left seen from the camera side; wound counter-clockwise.
const ORDER = [0, 3, 2, 0, 2, 1];

export function buildDynamic(s: SceneState, frames: FrameRects, cam: Cam, t: number, orb: boolean): Dynamic {
  const cp: number[] = [], cu: number[] = [];
  const ep: number[] = [], eu: number[] = [];
  const gp: number[] = [], gu: number[] = [], gc: number[] = [];
  let cn = 0, en = 0, gn = 0;
  const c = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);

  const push = (pos: number[], uv: number[], q: [V, V, V, V], col?: number[], rgb?: number[]) => {
    for (const i of ORDER) {
      pos.push(q[i][0], q[i][1], q[i][2]);
      uv.push(q[i][3], q[i][4]);
      if (col && rgb) col.push(rgb[0], rgb[1], rgb[2]);
    }
  };

  const card = (frame: string, x: number, z: number, flip: boolean) => {
    const r = frames[frame];
    if (!r) return;
    const f = snapGround(cam.pitch, cam.yaw, x, z);
    const h = r.h / 16, ax = (r.w / 32) * c, az = (r.w / 32) * sn;
    const u0 = flip ? r.x + r.w : r.x, u1 = flip ? r.x : r.x + r.w;
    push(cp, cu, [
      [f.x - ax, h, f.z - az, u0, r.y], [f.x + ax, h, f.z + az, u1, r.y],
      [f.x + ax, 0, f.z + az, u1, r.y + r.h], [f.x - ax, 0, f.z - az, u0, r.y + r.h],
    ]);
    cn++;
  };

  for (const e of s.ents) {
    e.flip = facesLeft(cam.yaw, e.fx, e.fz, e.flip);
    card(frameOf(e), e.x, e.z, e.flip);
  }
  for (const p of s.props) card(p.frame, p.x, p.z, false);

  // Glow quad: upright and turned to the camera's yaw like a card, `size` wide each way and `size / cos(pitch)` tall
  // each way, so it reads as a square of side 2 size on screen. Upright, it never leans into the wall behind a torch.
  const hh = 1 / Math.cos(cam.pitch);
  const glow = (x: number, y: number, z: number, size: number, rgb: number[]) => {
    const rx = size * c, rz = size * sn, uy = size * hh;
    push(gp, gu, [
      [x - rx, y + uy, z - rz, -1, -1], [x + rx, y + uy, z + rz, 1, -1],
      [x + rx, y - uy, z + rz, 1, 1], [x - rx, y - uy, z - rz, -1, 1],
    ], gc, rgb);
    gn++;
  };

  for (const tc of s.torches) {
    const fr = frames[`torch_f${Math.floor(t * 8 + tc.ph) % 5}`];
    const zz = tc.z - 0.14;
    if (fr) {
      push(ep, eu, [
        [tc.x - 0.5, tc.y + 0.5, zz, fr.x, fr.y], [tc.x + 0.5, tc.y + 0.5, zz, fr.x + fr.w, fr.y],
        [tc.x + 0.5, tc.y - 0.5, zz, fr.x + fr.w, fr.y + fr.h], [tc.x - 0.5, tc.y - 0.5, zz, fr.x, fr.y + fr.h],
      ]);
      en++;
    }
    const k = 0.5 * torchFlicker(t, tc.ph);
    glow(tc.x, tc.y + 0.25, zz, 1.5, [1 * k, 0.6 * k, 0.28 * k]);
  }
  if (orb) {
    const o = orbAt(t);
    glow(o.x, o.y, o.z, 0.9, [0.4 * 0.9, 0.58 * 0.9, 1 * 0.9]);
    glow(o.x, o.y, o.z, 0.22, [0.4 * 3, 0.58 * 3, 1 * 3]);
  }

  return {
    cards: { position: new Float32Array(cp), uv: new Float32Array(cu), count: cn },
    emissive: { position: new Float32Array(ep), uv: new Float32Array(eu), count: en },
    glows: { position: new Float32Array(gp), uv: new Float32Array(gu), color: new Float32Array(gc), count: gn },
  };
}

// The per-vertex sight attributes of the dynamic meshes (#305): one `footSight` read per quad, copied to its six vertices.
// The caller owns `out` (reused every frame, so nothing is allocated per quad); it must hold `count * 6` vertices.
import type { Glows, Quads, Shadows } from './cards';
import type { SmokeBuf } from './fx/smoke';
import type { FxBuf } from './models/fx';
import { footSight, thingHard, type SightMask } from './sightmask';

/** `sight` (hard, soft, scenery) per vertex of a card pass; zeros when `mask` is null (sight off). Returns `out`. */
export function cardSightData(q: Quads, mask: SightMask | null, out: Float32Array): Float32Array {
  const n = q.count * 6;
  if (!mask) return out.fill(0, 0, n * 3);
  for (let k = 0; k < q.count; k++) {
    const f = k * 24;
    const s = footSight(mask, q.foot[f], q.foot[f + 1], q.foot[f + 2]);
    const hard = thingHard(mask, s.hard), soft = s.soft;
    const scenery = q.foot[f + 3];
    for (let i = k * 18, e = i + 18; i < e; i += 3) {
      out[i] = hard;
      out[i + 1] = soft;
      out[i + 2] = scenery;
    }
  }
  return out;
}

/** What the sight rules read of a figure instance: a model instance (`FigureInst`) or a built figure's (`BuiltInst`, #358) fits. */
export interface SightThing { owner: number; x: number; z: number; reach?: number; scenery?: boolean; sight: { hard: number; soft: number } }

/** The sight of each model instance (#338), read once at its foot with its `reach` like a card; zeros when `mask` is null (sight off). */
export function figureSight(insts: readonly SightThing[], mask: SightMask | null): void {
  for (const i of insts) {
    if (!mask) { i.sight.hard = 0; i.sight.soft = 0; continue; }
    const s = footSight(mask, i.x, i.z, i.reach ?? 0);
    i.sight.hard = i.scenery && mask.daylight ? 0 : thingHard(mask, s.hard);   // scenery on a daylight map is never hidden (`cardShown`)
    i.sight.soft = s.soft;
  }
}

/** `sight` (hard, soft) per vertex of the shadows or glows (their `foot` is the centre, 2 floats per vertex). Returns `out`. */
function pairSightData(foot: Float32Array, count: number, mask: SightMask | null, out: Float32Array): Float32Array {
  if (!mask) return out.fill(0, 0, count * 12);
  for (let k = 0; k < count; k++) {
    const s = footSight(mask, foot[k * 12], foot[k * 12 + 1], 0);
    const hard = thingHard(mask, s.hard), soft = s.soft;
    for (let i = k * 12, e = i + 12; i < e; i += 2) {
      out[i] = hard;
      out[i + 1] = soft;
    }
  }
  return out;
}

/** `sight` (hard, soft) per vertex of the figures' effect triangles (#338), read once at the triangle's first corner; zeros when `mask` is null. `out` holds `fx.n * 6` floats. */
export function fxSightData(fx: FxBuf, mask: SightMask | null, out: Float32Array): Float32Array {
  if (!mask) return out.fill(0, 0, fx.n * 6);
  for (let k = 0; k < fx.n; k++) {
    const s = footSight(mask, fx.position[k * 9], fx.position[k * 9 + 2], 0);
    const hard = thingHard(mask, s.hard);
    for (let i = k * 6; i < k * 6 + 6; i += 2) { out[i] = hard; out[i + 1] = s.soft; }
  }
  return out;
}

export const shadowSightData = (s: Shadows, mask: SightMask | null, out: Float32Array): Float32Array => pairSightData(s.foot, s.count, mask, out);
export const glowSightData = (g: Glows, mask: SightMask | null, out: Float32Array): Float32Array => pairSightData(g.foot, g.count, mask, out);

/**
 * Adds to `out` the ids of the things the picture hides (#305): the owner of a card whose `thingHard` is above 0.5, by the
 * owner's first card (its body; the weapon is pushed after it). Scenery on a daylight map is never hidden (as `cardShown`).
 * `seen` is the caller's scratch set (cleared here), so nothing is allocated per frame.
 */
export function hiddenByPicture(passes: readonly Quads[], mask: SightMask, seen: Set<number>, out: Set<number>, models: readonly SightThing[] = [], built: readonly SightThing[] = []): void {
  seen.clear();
  // A model or built figure owns no card: its first instance (the body; a weapon or a copy comes after) is read at its foot like a card's.
  const things = (list: readonly SightThing[]): void => {
    for (const i of list) {
      if (i.owner < 0 || seen.has(i.owner)) continue;
      seen.add(i.owner);
      if (i.scenery && mask.daylight) continue;
      if (thingHard(mask, footSight(mask, i.x, i.z, i.reach ?? 0).hard) > 0.5) out.add(i.owner);
    }
  };
  things(models);
  things(built);
  for (const q of passes) {
    for (let k = 0; k < q.count; k++) {
      const id = q.owner[k * 6];
      if (id < 0 || seen.has(id)) continue;
      seen.add(id);
      const f = k * 24;
      if (q.foot[f + 3] === 1 && mask.daylight) continue;
      if (thingHard(mask, footSight(mask, q.foot[f], q.foot[f + 1], q.foot[f + 2]).hard) > 0.5) out.add(id);
    }
  }
}

/** The upload arrays of the smoke mesh (#359), owned by the view and reused every frame: `position` 3, `rgba` 4, `c` 4 and `sight` 2 floats per corner. */
export interface SmokeArrays { pos: Float32Array; rgba: Float32Array; c: Float32Array; sight: Float32Array }

/**
 * Copies a smoke buffer into `a` (growing the arrays when it is longer than they are) with its sight data (`fxSightData`, read at each
 * triangle's first corner) and returns the corner count; 0 for no buffer or no triangle, so the mesh then draws nothing.
 */
export function smokeUpload(buf: SmokeBuf | undefined, mask: SightMask | null, a: SmokeArrays): number {
  const corners = (buf?.n ?? 0) * 3;
  if (!buf || corners === 0) return 0;
  if (a.pos.length < corners * 3) {
    const room = corners * 2;
    a.pos = new Float32Array(room * 3); a.rgba = new Float32Array(room * 4); a.c = new Float32Array(room * 4); a.sight = new Float32Array(room * 2);
  }
  a.pos.set(buf.position); a.rgba.set(buf.rgba); a.c.set(buf.c);
  fxSightData(buf, mask, a.sight);
  return corners;
}

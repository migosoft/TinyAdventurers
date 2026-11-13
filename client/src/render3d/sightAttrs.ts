// The per-vertex sight attributes of the dynamic meshes (#305): one `footSight` read per quad, copied to its six vertices.
// The caller owns `out` (reused every frame, so nothing is allocated per quad); it must hold `count * 6` vertices.
import type { Glows, Quads, Shadows } from './cards';
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

export const shadowSightData = (s: Shadows, mask: SightMask | null, out: Float32Array): Float32Array => pairSightData(s.foot, s.count, mask, out);
export const glowSightData = (g: Glows, mask: SightMask | null, out: Float32Array): Float32Array => pairSightData(g.foot, g.count, mask, out);

/**
 * Adds to `out` the ids of the things the picture hides (#305): the owner of a card whose `thingHard` is above 0.5, by the
 * owner's first card (its body; the weapon is pushed after it). Scenery on a daylight map is never hidden (as `cardShown`).
 * `seen` is the caller's scratch set (cleared here), so nothing is allocated per frame.
 */
export function hiddenByPicture(passes: readonly Quads[], mask: SightMask, seen: Set<number>, out: Set<number>): void {
  seen.clear();
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

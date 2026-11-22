// Per map chunk, the vertex arrays of the ground-cover layer (#330): stacked sheets (one quad per cell per sheet the cover reaches)
// and bushel cards, with bounds for frustum culling. Pure data: the shaders that read these attributes live in coverNodes.
import { CARD_BIAS } from '../materials';
import { PITCH_MAX } from '../params';
import { SWAY_WAVE_MAX } from '../wind';
import { CHUNK } from '../worldMesh';
import type { CoverResult } from './coverJob';
import { COVER_KINDS, coverH, GH_MAX } from './kinds';

export interface CoverChunk {
  cx: number; cz: number;
  /** 6 vertices per cell quad at y 0; layer 1..sheets. */
  sheet: { position: Float32Array; layer: Float32Array; count: number };
  /** 6 vertices per bushel card: foot xyz, corner (0..1, 0..1), info (w, h, seed, fern). */
  bushel: { foot: Float32Array; corner: Float32Array; info: Float32Array; count: number };
  min: [number, number, number]; max: [number, number, number];
}

const QUAD: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
const PX = 16;
const STRETCH = 1 / Math.cos((PITCH_MAX * Math.PI) / 180);
/** The largest bushel sway of any cover kind, tiles (the bounds do not depend on which kind a bushel stands on). */
const BUSHEL_SWAY = Math.max(0, ...COVER_KINDS.map((k) => k.bushels?.sway ?? 0)) * SWAY_WAVE_MAX;

/** null when the chunk has no cover and no bushel (also for the 1x1 image of a run without cover sources). */
export function buildCoverChunk(r: CoverResult, cx: number, cz: number, floorY?: (x: number, z: number) => number): CoverChunk | null {
  if (r.sheets <= 0) return null;
  const { image } = r, mapW = Math.floor(image.w / PX), mapH = Math.floor(image.h / PX);
  const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = Math.min(mapW, x0 + CHUNK), z1 = Math.min(mapH, z0 + CHUNK);
  const pos: number[] = [], layer: number[] = [];
  let cells = 0, low = 0; // `low`: the lowest floor under the chunk's cover, which the bounds reach down to
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    let top = 0;
    for (let pz = 0; pz < PX; pz++) for (let px = 0; px < PX; px++) top = Math.max(top, coverH(image.data[((z * PX + pz) * image.w + x * PX + px) * 4 + 3]));
    if (!top) continue;
    cells++;
    // The floor under the cell's four corners, taken once for all its sheets.
    const ys = [0, 1, 2, 3].map((k) => floorY?.(x + (k & 1), z + (k >> 1)) ?? 0);
    low = Math.min(low, ...ys);
    for (let n = 1; n <= Math.min(top, r.sheets); n++) for (const [u, v] of QUAD) { pos.push(x + u, ys[v * 2 + u], z + v); layer.push(n); }
  }
  const mine = r.bushels.filter((b) => Math.floor(b.x / CHUNK) === cx && Math.floor(b.z / CHUNK) === cz);
  if (!cells && !mine.length) return null;

  const foot: number[] = [], corner: number[] = [], info: number[] = [];
  const min: [number, number, number] = [x0, 0, z0], max: [number, number, number] = [x1, cells ? (r.sheets / PX) * GH_MAX : 0, z1];
  for (const b of mine) {
    const y = floorY?.(b.x, b.z) ?? 0;
    low = Math.min(low, y);
    for (const [u, v] of QUAD) { foot.push(b.x, y, b.z); corner.push(u, v); info.push(b.w, b.h, b.seed, b.fern ? 1 : 0); }
    // Half the card, the sway, and the card shader's push toward the camera (its horizontal part is at most CARD_BIAS).
    const room = b.w / PX / 2 + BUSHEL_SWAY + CARD_BIAS;
    min[0] = Math.min(min[0], b.x - room); max[0] = Math.max(max[0], b.x + room);
    min[2] = Math.min(min[2], b.z - room); max[2] = Math.max(max[2], b.z + room);
    max[1] = Math.max(max[1], (b.h / PX) * STRETCH * GH_MAX + BUSHEL_SWAY);
  }
  min[1] = low;
  return {
    cx, cz,
    sheet: { position: new Float32Array(pos), layer: new Float32Array(layer), count: pos.length / 3 },
    bushel: { foot: new Float32Array(foot), corner: new Float32Array(corner), info: new Float32Array(info), count: foot.length / 3 },
    min, max,
  };
}

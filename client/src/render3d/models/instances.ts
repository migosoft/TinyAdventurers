// The instances of figures (#338): the record of one drawn model per frame, the row of floats it becomes (one row of the data
// texture the vertex shader reads). Pure maths.

import { MAX_BENDS, MAX_BONES } from './bones';
import type { Pose3d } from './pose3d';

export interface FigureInst {
  owner: number;            // the entity id: the id pass, the caster slot, sight
  model: string;            // kit key
  x: number; z: number;     // foot, tiles
  lift: number;             // tiles above the ground (negative: sunk)
  /**
   * The model's own `FigureModel.scale`. The pose's dash stretch and fall shrink are NOT in it: they are `pose.root.sx/sy/sz`
   * (the root step of `skinVertex` takes them, the model's scale multiplies them), so the fall shrink must not be put in here too.
   * The scale is applied to the figure, not to the root's shift (`pose.root.x/y/z` are already in the scaled frame).
   */
  scale: number;
  pose: Pose3d;             // a weapon instance carries its wielder's pose and reads one bone of it
  bone: number;             // -1: the whole skeleton; else the wielder's bone a one-bone model hangs on (BONES index)
  boneScale: number;        // a weapon's size on that bone (the game's weapon scale)
  /** A weapon: the wielder's pivot of `bone` (`wielderModel.pivots[bone * 3 ..]`, sprite px), where the weapon model's origin (its grip) sits. Default 0, 0, 0. */
  pivot?: readonly [number, number, number];
  tint: [number, number, number]; stone: boolean; alpha: number; dark: boolean;
  cut: boolean;             // nothing below the ground is drawn (sinking, drowning)
  /** Height (tiles) below which the picture's world hides the figure (`hidingHeightAt`): the id pass leaves out what lies below it. */
  groundY: number;
  sight: { hard: number; soft: number };
  /** Tiles: for the sight mask's wide-figure rule, what the figure's card would use (half the opaque width of its body frame x the pose scale), so it is seen and hidden where the card would be. 0 when absent. */
  reach?: number;
}

/** Texels per row, 4 floats each. */
export const ROW_TEXELS = 64;
/** The owners of a frame are numbered 0 .. OWNER_MAX - 1 (modulo) in the rows. */
export const OWNER_MAX = 65536;
const PX = 1 / 16;  // tiles per sprite px

/**
 * The texel columns of a row (a texel is 4 floats; a 3x4 matrix is 3 texels, one per matrix row: a, b, c, d with d the shift):
 *  - `root` (3 texels): model space (sprite px, after the bones) to world tiles: the root step of `skinVertex` (scale by
 *    `root.s * scale`, roll about x, shift by `root.x/y/z`), then the yaw, then `/ 16`, then the place (x, lift, z). The height
 *    stretch (1 / cos pitch) is NOT in it;
 *  - `bones` (MAX_BONES x 3 texels): the bone matrices, `pose.bones` row by row. A weapon has only bone 0 (see `packInstance`);
 *  - `bends` (MAX_BENDS texels): axis x, y, z and the angle at the tip, per bend;
 *  - `robe` (1 texel): dx, dz, the dip, 0 (as `pose.robe`);
 *  - `tint` (1 texel): r, g, b, stone (0 or 1);
 *  - `seen` (1 texel): alpha, sight hard, sight soft, the caster slot;
 *  - `flags` (1 texel): dark (0 or 1), cut (0 or 1), the owner's number (see `OWNER_MAX`), `groundY`.
 * The rest of the 64 texels is free.
 */
export const ROW = { root: 0, bones: 3, bends: 45, robe: 49, tint: 50, seen: 51, flags: 52 } as const;

/**
 * Writes row `row` of `out` (ROW_TEXELS x 4 floats). A weapon instance (`bone >= 0`) is a one-bone model whose origin is the grip
 * and whose vertices use bone 0: its bone 0 is the wielder's bone matrix `M` put on the grip, `M * T(pivot) * S(boneScale)`, so a
 * weapon vertex `v` lands where the wielder's rest-space point `pivot + boneScale * v` does. Its other bones are not written, its
 * bends and robe are zero. The root (yaw, place, the wielder's scale and stretch) is the wielder's, as for a figure.
 */
export function packInstance(out: Float32Array, row: number, inst: FigureInst, slot: number, ownerNo: number): void {
  const base = row * ROW_TEXELS * 4, pose = inst.pose, R = pose.root;
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), cr = Math.cos(R.roll), sr = Math.sin(R.roll);
  const Sx = R.sx * inst.scale * PX, Sy = R.sy * inst.scale * PX, Sz = R.sz * inst.scale * PX;
  let o = base + ROW.root * 4;
  // Yaw * Roll * diag(S), then the shift: Yaw * (R.x, R.y, R.z) / 16, plus the place.
  out[o] = c * Sx; out[o + 1] = -s * sr * Sy; out[o + 2] = -s * cr * Sz; out[o + 3] = (c * R.x - s * R.z) * PX + inst.x;
  out[o + 4] = 0; out[o + 5] = cr * Sy; out[o + 6] = -sr * Sz; out[o + 7] = R.y * PX + inst.lift;
  out[o + 8] = s * Sx; out[o + 9] = c * sr * Sy; out[o + 10] = c * cr * Sz; out[o + 11] = (s * R.x + c * R.z) * PX + inst.z;

  o = base + ROW.bones * 4;
  if (inst.bone < 0) {
    for (let i = 0; i < MAX_BONES * 12; i++) out[o + i] = pose.bones[i];
    for (let i = 0; i < MAX_BENDS * 4; i++) out[base + ROW.bends * 4 + i] = pose.bends[i];
    o = base + ROW.robe * 4;
    out[o] = pose.robe[0]; out[o + 1] = pose.robe[1]; out[o + 2] = pose.robe[2]; out[o + 3] = 0;
  } else {
    const b = inst.bone * 12, k = inst.boneScale, M = pose.bones, p = inst.pivot;
    const px = p ? p[0] : 0, py = p ? p[1] : 0, pz = p ? p[2] : 0;
    for (let r = 0; r < 3; r++) {
      const m = b + r * 4;
      out[o + r * 4] = M[m] * k; out[o + r * 4 + 1] = M[m + 1] * k; out[o + r * 4 + 2] = M[m + 2] * k;
      out[o + r * 4 + 3] = M[m] * px + M[m + 1] * py + M[m + 2] * pz + M[m + 3];
    }
    for (let i = 0; i < MAX_BENDS * 4; i++) out[base + ROW.bends * 4 + i] = 0;
    o = base + ROW.robe * 4;
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
  }

  o = base + ROW.tint * 4;
  out[o] = inst.tint[0]; out[o + 1] = inst.tint[1]; out[o + 2] = inst.tint[2]; out[o + 3] = inst.stone ? 1 : 0;
  o = base + ROW.seen * 4;
  out[o] = inst.alpha; out[o + 1] = inst.sight.hard; out[o + 2] = inst.sight.soft; out[o + 3] = slot;
  o = base + ROW.flags * 4;
  out[o] = inst.dark ? 1 : 0; out[o + 1] = inst.cut ? 1 : 0; out[o + 2] = ownerNo; out[o + 3] = inst.groundY;
}

/** A float array that keeps its content and at least doubles when `rows` (a count of floats) exceeds it. */
export function growRows(buf: Float32Array, rows: number): Float32Array {
  if (rows <= buf.length) return buf;
  const g = new Float32Array(Math.max(rows, buf.length * 2));
  g.set(buf);
  return g;
}

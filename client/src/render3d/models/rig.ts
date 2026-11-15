// The skeleton of a figure (#338): how the per-bone turns, scales and shifts of a pose become one matrix per bone, and the CPU
// reference of what the vertex shader does with them. Pure typed-array maths, so it runs under node and in a worker.

import { MAX_BONES } from './bones';
import type { FigureModel } from './model';
import type { Pose3d } from './pose3d';

/**
 * What a bone does on its own, as a three.js group would: a turn about the bone's pivot (Euler XYZ angles, or the quaternion `q`
 * when it is given), a scale from the pivot (in the turned bone's own axes) and a shift of the pivot. The bone's matrix is
 * `parent * T(pivot + shift) * R * S * T(-pivot)`, where every pivot is in the model's rest space.
 */
export interface BoneLocal { rx: number; ry: number; rz: number; sx: number; sy: number; sz: number; tx: number; ty: number; tz: number; q?: [number, number, number, number] }

export const identityLocal = (): BoneLocal => ({ rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, tx: 0, ty: 0, tz: 0 });
export const identityLocals = (): BoneLocal[] => Array.from({ length: MAX_BONES }, identityLocal);

/**
 * The bone matrices in model space, 3x4 row major (`out[bone * 12 + row * 4 + column]`; the last column is the shift), for the
 * bones in `m.parents` order (a parent always comes before its children). A bone's matrix takes a rest-space point to where the
 * pose has put it. A weapon bone moves a weapon model placed with its origin (the grip) at the bone's pivot.
 */
export function composeBones(m: FigureModel, local: readonly BoneLocal[], out: Float32Array): void {
  for (let b = 0; b < MAX_BONES; b++) {
    const L = local[b], o = b * 12;
    // The linear part: R * diag(s).
    let r00: number, r01: number, r02: number, r10: number, r11: number, r12: number, r20: number, r21: number, r22: number;
    if (L.q) {
      const [x, y, z, w] = L.q, x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      r00 = 1 - (yy + zz); r01 = xy - wz; r02 = xz + wy;
      r10 = xy + wz; r11 = 1 - (xx + zz); r12 = yz - wx;
      r20 = xz - wy; r21 = yz + wx; r22 = 1 - (xx + yy);
    } else {
      // three.js's Euler order XYZ: R = Rx * Ry * Rz.
      const a = Math.cos(L.rx), bb = Math.sin(L.rx), c = Math.cos(L.ry), d = Math.sin(L.ry), e = Math.cos(L.rz), f = Math.sin(L.rz);
      const ae = a * e, af = a * f, be = bb * e, bf = bb * f;
      r00 = c * e; r01 = -c * f; r02 = d;
      r10 = af + be * d; r11 = ae - bf * d; r12 = -bb * c;
      r20 = bf - ae * d; r21 = be + af * d; r22 = a * c;
    }
    const l00 = r00 * L.sx, l01 = r01 * L.sy, l02 = r02 * L.sz, l10 = r10 * L.sx, l11 = r11 * L.sy, l12 = r12 * L.sz, l20 = r20 * L.sx, l21 = r21 * L.sy, l22 = r22 * L.sz;
    const px = m.pivots[b * 3], py = m.pivots[b * 3 + 1], pz = m.pivots[b * 3 + 2];
    // The translation: pivot + shift - linear * pivot.
    const t0 = px + L.tx - (l00 * px + l01 * py + l02 * pz), t1 = py + L.ty - (l10 * px + l11 * py + l12 * pz), t2 = pz + L.tz - (l20 * px + l21 * py + l22 * pz);
    const p = m.parents[b];
    if (p < 0) {
      out[o] = l00; out[o + 1] = l01; out[o + 2] = l02; out[o + 3] = t0;
      out[o + 4] = l10; out[o + 5] = l11; out[o + 6] = l12; out[o + 7] = t1;
      out[o + 8] = l20; out[o + 9] = l21; out[o + 10] = l22; out[o + 11] = t2;
    } else {
      const q = p * 12;
      const a00 = out[q], a01 = out[q + 1], a02 = out[q + 2], a03 = out[q + 3], a10 = out[q + 4], a11 = out[q + 5], a12 = out[q + 6], a13 = out[q + 7], a20 = out[q + 8], a21 = out[q + 9], a22 = out[q + 10], a23 = out[q + 11];
      out[o] = a00 * l00 + a01 * l10 + a02 * l20; out[o + 1] = a00 * l01 + a01 * l11 + a02 * l21; out[o + 2] = a00 * l02 + a01 * l12 + a02 * l22; out[o + 3] = a00 * t0 + a01 * t1 + a02 * t2 + a03;
      out[o + 4] = a10 * l00 + a11 * l10 + a12 * l20; out[o + 5] = a10 * l01 + a11 * l11 + a12 * l21; out[o + 6] = a10 * l02 + a11 * l12 + a12 * l22; out[o + 7] = a10 * t0 + a11 * t1 + a12 * t2 + a13;
      out[o + 8] = a20 * l00 + a21 * l10 + a22 * l20; out[o + 9] = a20 * l01 + a21 * l11 + a22 * l21; out[o + 10] = a20 * l02 + a21 * l12 + a22 * l22; out[o + 11] = a20 * t0 + a21 * t1 + a22 * t2 + a23;
    }
  }
}

/**
 * Where the pose puts rest vertex `i`, in the figure's frame before the yaw: the written spec of the vertex shader. The steps,
 * in this order:
 *  1. the loose piece: a vertex with a bend index `k >= 0` (`skin.z`) is turned about `m.bends[k].origin` around the axis
 *     `pose.bends[k * 4 .. + 2]` by `pose.bends[k * 4 + 3] * skin.w` (the angle at the tip, times how far along the piece the
 *     vertex lies). A robe vertex (`skin.z === -2`) is moved by `skin.w * (robe[0], robe[2], robe[1])` (dx, the dip, dz);
 *  2. the bone: the 3x4 matrix of `skin.x` (`pose.bones`) moves the point;
 *  3. the root: scale by `root.s * m.scale` from the feet, a turn by `root.roll` about the x axis (the figure's length when
 *     it lies; y goes towards z), then the shift `root.x, y, z`.
 * The yaw is NOT applied here: the instance turns the result about the vertical axis, so that +x goes to
 * `(cos yaw, 0, sin yaw)` in world space (yaw 0 = +x, the game's y axis is the world's z axis):
 * `world.x = x * cos(yaw) - z * sin(yaw)`, `world.z = x * sin(yaw) + z * cos(yaw)`, `world.y = y`, then plus the figure's place.
 */
export function skinVertex(m: FigureModel, pose: Pose3d, i: number, out: [number, number, number]): void {
  let x = m.position[i * 3], y = m.position[i * 3 + 1], z = m.position[i * 3 + 2];
  const bone = m.skin[i * 4], bend = m.skin[i * 4 + 2], along = m.skin[i * 4 + 3];
  if (bend >= 0) {
    const B = m.bends[bend], k = bend * 4, ang = pose.bends[k + 3] * along;
    const ax = pose.bends[k], ay = pose.bends[k + 1], az = pose.bends[k + 2];
    const vx = x - B.origin[0], vy = y - B.origin[1], vz = z - B.origin[2];
    const ca = Math.cos(ang), sa = Math.sin(ang), dot = (ax * vx + ay * vy + az * vz) * (1 - ca);
    x = B.origin[0] + vx * ca + (ay * vz - az * vy) * sa + ax * dot;
    y = B.origin[1] + vy * ca + (az * vx - ax * vz) * sa + ay * dot;
    z = B.origin[2] + vz * ca + (ax * vy - ay * vx) * sa + az * dot;
  } else if (bend === -2) {
    x += along * pose.robe[0]; y += along * pose.robe[2]; z += along * pose.robe[1];
  }
  const o = bone * 12, b = pose.bones;
  const bx = b[o] * x + b[o + 1] * y + b[o + 2] * z + b[o + 3], by = b[o + 4] * x + b[o + 5] * y + b[o + 6] * z + b[o + 7], bz = b[o + 8] * x + b[o + 9] * y + b[o + 10] * z + b[o + 11];
  const R = pose.root, sx = R.sx * m.scale, sy = R.sy * m.scale, sz = R.sz * m.scale;
  const px = bx * sx, py = by * sy, pz = bz * sz, cr = Math.cos(R.roll), sr = Math.sin(R.roll);
  out[0] = px + R.x;
  out[1] = py * cr - pz * sr + R.y;
  out[2] = py * sr + pz * cr + R.z;
}

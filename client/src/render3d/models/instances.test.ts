import { describe, expect, it } from 'vitest';
import { BONES, MAX_BENDS, MAX_BONES, buildFigure, type FigureModel } from './model';
import { OWNER_MAX, ROW, ROW_TEXELS, growRows, packInstance, type FigureInst } from './instances';
import { restPose, type Pose3d } from './pose3d';
import { skinVertex } from './rig';
import { DESCS } from './table';

const skelet = buildFigure('skelet', DESCS.skelet);
const near = (a: ArrayLike<number>, b: ArrayLike<number>): void => {
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], 3);
};
const inst = (o: Partial<FigureInst> = {}): FigureInst => ({
  owner: 1, model: 'skelet', x: 0, z: 0, lift: 0, scale: 1, pose: restPose(skelet, 0), bone: -1, boneScale: 1,
  tint: [1, 1, 1], stone: false, alpha: 1, dark: false, cut: false, sight: { hard: 0, soft: 0 }, ...o,
});
const row = (i: FigureInst, slot = 0, ownerNo = 0): Float32Array => { const out = new Float32Array(ROW_TEXELS * 4 * 2); packInstance(out, 1, i, slot, ownerNo); return out.subarray(ROW_TEXELS * 4, ROW_TEXELS * 8); };
/** The 3x4 matrix at a texel column, applied to a point. */
const mat = (r: Float32Array, col: number, v: [number, number, number]): [number, number, number] => {
  const o = col * 4, m = (k: number) => r[o + k];
  // Row-major in texels: three texels, each (a, b, c, d) = one matrix row.
  return [0, 1, 2].map((k) => m(k * 4) * v[0] + m(k * 4 + 1) * v[1] + m(k * 4 + 2) * v[2] + m(k * 4 + 3)) as [number, number, number];
};

describe('packInstance', () => {
  it('maps model (16, 0, 0) to the world by place and heading', () => {
    let r = row(inst({ x: 3, z: 5 }));
    near(mat(r, ROW.root, [16, 0, 0]), [4, 0, 5]);
    r = row(inst({ x: 3, z: 5, pose: restPose(skelet, Math.PI / 2) }));
    near(mat(r, ROW.root, [16, 0, 0]), [3, 0, 6]);
  });

  it('lifts and scales: the lift is in tiles, the scale is in the matrix', () => {
    const r = row(inst({ x: 1, z: 2, lift: 0.5, scale: 2 }));
    near(mat(r, ROW.root, [16, 16, 0]), [3, 2.5, 2]);
  });

  it('matches skinVertex plus the yaw and the place on a real model with a non-trivial pose', () => {
    const m: FigureModel = { ...skelet, scale: 1.3 };
    const pose: Pose3d = restPose(m, 0.8);
    pose.root = { x: 2.5, y: 3, z: -1.5, roll: 0.9, sx: 1.25, sy: 0.9, sz: 0.85 };
    pose.bones[BONES.indexOf('head') * 12 + 3] += 1.5;   // the bones are part of the pose too
    const flat: Pose3d = { ...pose, root: { x: 0, y: 0, z: 0, roll: 0, sx: 1, sy: 1, sz: 1 } };
    const mm: FigureModel = { ...m, scale: 1 };   // the shader's skinning leaves the model's scale to the instance
    const r = row(inst({ x: 7, z: -3, lift: 0.25, scale: m.scale, pose }));
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    const out: [number, number, number] = [0, 0, 0], mid: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < m.position.length / 3; i += 7) {
      skinVertex(m, pose, i, out);
      const want = [(out[0] * c - out[2] * s) / 16 + 7, out[1] / 16 + 0.25, (out[0] * s + out[2] * c) / 16 - 3];
      skinVertex(mm, flat, i, mid);
      near(mat(r, ROW.root, mid), want);
    }
  });

  it('writes the bones, bends, robe, tint, stone, alpha, sight, slot, dark and cut', () => {
    const pose = restPose(skelet, 0);
    pose.bones[5 * 12 + 3] = 4; pose.bends[MAX_BENDS * 4 - 1] = 0.5; pose.robe = [1, 2, 3];
    const r = row(inst({ pose, tint: [0.1, 0.2, 0.3], stone: true, alpha: 0.4, sight: { hard: 0.7, soft: 0.9 }, dark: true, cut: true }), 3);
    near(r.subarray(ROW.bones * 4, ROW.bones * 4 + MAX_BONES * 12), pose.bones);
    near(r.subarray(ROW.bends * 4, ROW.bends * 4 + MAX_BENDS * 4), pose.bends);
    near(r.subarray(ROW.robe * 4, ROW.robe * 4 + 3), [1, 2, 3]);
    near(r.subarray(ROW.tint * 4, ROW.tint * 4 + 4), [0.1, 0.2, 0.3, 1]);
    near(r.subarray(ROW.seen * 4, ROW.seen * 4 + 4), [0.4, 0.7, 0.9, 3]);
    near(r.subarray(ROW.flags * 4, ROW.flags * 4 + 2), [1, 1]);
  });

  it('writes the owner number in the third float of the flags texel', () => {
    const r = row(inst({ dark: true, cut: false }), -1, 300);
    near(r.subarray(ROW.flags * 4, ROW.flags * 4 + 3), [1, 0, 300]);
    expect(OWNER_MAX).toBe(65536);
  });

  it('writes a weapon: the wielder bone times boneScale about its pivot, in bone 0', () => {
    const pose = restPose(skelet, 0);
    const b = BONES.indexOf('weaponR');
    const M = [0, -1, 0, 5, 1, 0, 0, 7, 0, 0, 1, 9];   // a turn about z and a shift
    pose.bones.set(M, b * 12);
    const piv: [number, number, number] = [2, 3, 4];
    const r = row(inst({ pose, bone: b, boneScale: 0.5, pivot: piv }));
    // A grip vertex v goes to M * (pivot + boneScale * v).
    for (const v of [[0, 0, 0], [4, 0, 0], [1, 2, 3]] as [number, number, number][]) {
      const p = [piv[0] + 0.5 * v[0], piv[1] + 0.5 * v[1], piv[2] + 0.5 * v[2]];
      const want = [0, 1, 2].map((k) => M[k * 4] * p[0] + M[k * 4 + 1] * p[1] + M[k * 4 + 2] * p[2] + M[k * 4 + 3]);
      near(mat(r, ROW.bones, v), want);
    }
  });

  it('a weapon without a pivot is the bone matrix times boneScale', () => {
    const pose = restPose(skelet, 0);
    const b = BONES.indexOf('weaponR');
    pose.bones.set([1, 0, 0, 5, 0, 1, 0, 7, 0, 0, 1, 9], b * 12);
    near(mat(row(inst({ pose, bone: b, boneScale: 2 })), ROW.bones, [1, 1, 1]), [7, 9, 11]);
  });
});

describe('growRows', () => {
  it('keeps the content and is long enough', () => {
    const a = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const g = growRows(a, 3 * 256);
    expect(g.length).toBeGreaterThanOrEqual(768);
    expect([...g.subarray(0, 8)]).toEqual([...a]);
  });
  it('at least doubles, and returns the same array when it fits', () => {
    const a = new Float32Array(8);
    expect(growRows(a, 9).length).toBeGreaterThanOrEqual(16);
    expect(growRows(a, 8)).toBe(a);
  });
});

import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three/webgpu';
import { ART, facesLeft, groundAt, keysToWorld, project, snapGround, viewRay } from './camera';

const rad = (d: number) => (d * Math.PI) / 180;

describe('project', () => {
  const cam = { x: 3, z: 4, pitch: rad(45), yaw: 0 };

  it('maps tiles to screen offsets', () => {
    const a = project(cam, 5, 0, 2);
    expect(a.sx).toBeCloseTo(2, 12);
    expect(a.sy).toBeCloseTo(2 * Math.sin(rad(45)), 12);
    expect(project(cam, 3, 1, 4).sy).toBeCloseTo(Math.cos(rad(45)), 12);
    expect(project({ ...cam, yaw: rad(90) }, 3, 0, 5).sx).toBeCloseTo(1, 12);
  });

  it('depth is larger for a point further north at yaw 0', () => {
    expect(project(cam, 3, 0, 0).depth).toBeGreaterThan(project(cam, 3, 0, 8).depth);
  });

  it('groundAt inverts project on y = 0', () => {
    for (const p of [30, 45, 48.6, 80]) {
      for (const y of [0, 45, 90, -135]) {
        const c = { x: 3, z: 4, pitch: rad(p), yaw: rad(y) };
        const r = project(c, 7.5, 0, -2.25);
        const g = groundAt(c, r.sx, r.sy);
        expect(g.x).toBeCloseTo(7.5, 9);
        expect(g.z).toBeCloseTo(-2.25, 9);
      }
    }
  });
});

describe('snapGround', () => {
  it('is idempotent', () => {
    const a = snapGround(rad(48.6), rad(37), 3.37, -8.91);
    const b = snapGround(rad(48.6), rad(37), a.x, a.z);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
  });

  it('keeps screen distances whole art pixels', () => {
    for (const [p, y] of [[30, 0], [48.6, 37]]) {
      const pitch = rad(p);
      const yaw = rad(y);
      const a = snapGround(pitch, yaw, 5.31, 2.77);
      const b = snapGround(pitch, yaw, -3.62, 9.18);
      const c = { x: 0, z: 0, pitch, yaw };
      const pa = project(c, a.x, 0, a.z);
      const pb = project(c, b.x, 0, b.z);
      for (const d of [(pa.sx - pb.sx) * ART, (pa.sy - pb.sy) * ART]) {
        expect(Math.abs(d - Math.round(d))).toBeLessThan(1e-6);
      }
    }
  });
});

describe('keys, facing and view ray', () => {
  it('keysToWorld turns the keys with the yaw', () => {
    const k = keysToWorld(rad(90), 1, 0);
    expect(k.x).toBeCloseTo(0, 12);
    expect(k.z).toBeCloseTo(1, 12);
  });

  it('facesLeft has a dead zone', () => {
    expect(facesLeft(0, -1, 0, false)).toBe(true);
    expect(facesLeft(0, 0.01, 1, true)).toBe(true);
    expect(facesLeft(0, 1, 0, true)).toBe(false);
  });

  it('viewRay points toward the camera', () => {
    const v = viewRay(rad(45), 0);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(Math.sin(rad(45)), 12);
    expect(v[2]).toBeCloseTo(Math.cos(rad(45)), 12);
  });
});

describe('agreement with the three.js camera', () => {
  it('Vector3.project matches project()', () => {
    const pitch = rad(48.6);
    const yaw = rad(37);
    const cam = { x: 3, z: 4, pitch, yaw };
    const halfW = 10;
    const halfH = 5;
    const oc = new OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200);
    const ray = viewRay(pitch, yaw);
    oc.position.set(3 + ray[0] * 50, ray[1] * 50, 4 + ray[2] * 50);
    oc.up.set(0, 1, 0);
    oc.lookAt(3, 0, 4);
    oc.updateMatrixWorld(true);
    oc.updateProjectionMatrix();
    for (const [x, y, z] of [[5, 0, 2], [1.5, 1, 7], [-2, 0.5, 3]]) {
      const n = new Vector3(x, y, z).project(oc);
      const r = project(cam, x, y, z);
      expect(n.x * halfW).toBeCloseTo(r.sx, 6);
      expect(n.y * halfH).toBeCloseTo(r.sy, 6);
    }
  });
});

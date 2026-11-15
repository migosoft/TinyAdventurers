import { describe, expect, it } from 'vitest';
import { viewRay } from '../camera';
import { newFxBuf } from '../models/fx';
import { rng } from './rand';
import { FxTris } from './tris';

const cam = { x: 0, z: 0, pitch: 0.9, yaw: 0.3 };

describe('rng', () => {
  it('is deterministic', () => {
    const a = rng(7), b = rng(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('FxTris', () => {
  it('flush sorts far to near', () => {
    const ray = viewRay(cam.pitch, cam.yaw);
    const T = new FxTris(10), out = newFxBuf();
    // near first, far second: depth along the view ray 5 (near the camera) and 1
    const at = (d: number): [number, number, number] => [ray[0] * d, ray[1] * d, ray[2] * d];
    const near = at(5), far = at(1);
    T.tri(near[0], near[1], near[2], near[0], near[1], near[2], near[0], near[1], near[2], 1, 0, 0, 1);
    T.tri(far[0], far[1], far[2], far[0], far[1], far[2], far[0], far[1], far[2], 0, 1, 0, 1);
    T.flush(out, cam, true);
    expect(out.n).toBe(2);
    expect(out.position.length).toBe(18);
    expect(out.rgba.length).toBe(24);
    expect(out.rgba[1]).toBe(1); // the far (green) one first
  });
  it('cap drops and counts', () => {
    const T = new FxTris(3);
    for (let i = 0; i < 5; i++) T.tri(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1);
    expect(T.n).toBe(3);
    expect(T.dropped).toBe(2);
  });
  it('invisible triangles are skipped', () => {
    const T = new FxTris(3);
    T.tri(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0.004);
    expect(T.n).toBe(0);
  });
  it('grows past its first size up to the cap', () => {
    const T = new FxTris(2000), out = newFxBuf();
    for (let i = 0; i < 1000; i++) T.tri(i, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1);
    T.flush(out, cam, true);
    expect(out.n).toBe(1000);
  });
  it('no allocation per triangle', () => {
    const T = new FxTris(5000) as unknown as { pos: Float32Array; col: Float32Array; clear(): void; tri(...a: number[]): void };
    for (let i = 0; i < 1000; i++) T.tri(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1);
    const pos = T.pos, col = T.col;
    T.clear();
    for (let i = 0; i < 1000; i++) T.tri(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1);
    expect(T.pos).toBe(pos);
    expect(T.col).toBe(col);
  });
});

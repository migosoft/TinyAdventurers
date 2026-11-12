import { describe, expect, it } from 'vitest';
import { SHOT_LIFT_PX } from '../run/aim';
import { ART, snapGround, type Cam } from './camera';
import { renderPlan } from './quality';
import { aimGround, drawnCam, screenCentre, toCanvas } from './screen';

const rad = (d: number): number => (d * Math.PI) / 180;
const plans = [
  { name: 'direct', zoom: 4, plan: renderPlan('high', 4, 1920, 1080) },
  { name: 'off-screen', zoom: 5, plan: renderPlan('fast', 5, 1917, 1081) },
];
const cams: Cam[] = [];
for (const p of [30, 45, 48.6, 80]) for (const y of [0, 90, 135]) cams.push({ x: 20.37, z: 11.81, pitch: rad(p), yaw: rad(y) });
const label = (c: Cam): string => `pitch ${(c.pitch * 180 / Math.PI).toFixed(1)} yaw ${Math.round(c.yaw * 180 / Math.PI)}`;

describe('canvas and world', () => {
  for (const { name, zoom, plan } of plans) {
    for (const cam of cams) {
      const tag = `${name}, ${label(cam)}`;
      it(`toCanvas puts the camera target at the screen centre (${tag})`, () => {
        const c = screenCentre(plan);
        const p = toCanvas(cam, plan, zoom, cam.x, 0, cam.z);
        expect(Math.abs(p.px - c.px)).toBeLessThan(0.5 * zoom);
        expect(Math.abs(p.py - c.py)).toBeLessThan(0.5 * zoom);
        const g = snapGround(cam.pitch, cam.yaw, cam.x, cam.z);
        const q = toCanvas(cam, plan, zoom, g.x, 0, g.z);
        expect(q.px).toBeCloseTo(c.px, 6);
        expect(q.py).toBeCloseTo(c.py, 6);
      });
      it(`aimGround inverts toCanvas at shot height (${tag})`, () => {
        const fx = cam.x + 1.3, fz = cam.z - 1.5;
        const p = toCanvas(cam, plan, zoom, fx, 0, fz);
        const g = aimGround(cam, plan, zoom, p.px, p.py - SHOT_LIFT_PX * zoom);
        expect(g.x).toBeCloseTo(fx, 6);
        expect(g.z).toBeCloseTo(fz, 6);
      });
    }
  }
  it('a point one tile east at yaw 0 lies 16 * zoom px right', () => {
    for (const { zoom, plan } of plans) {
      const cam: Cam = { x: 10, z: 10, pitch: rad(45), yaw: 0 };
      const a = toCanvas(cam, plan, zoom, 10, 0, 10);
      const b = toCanvas(cam, plan, zoom, 11, 0, 10);
      expect(b.px - a.px).toBeCloseTo(ART * zoom, 6);
      expect(b.py).toBeCloseTo(a.py, 6);
    }
  });
  it('drawnCam snaps the target as View.draw does', () => {
    const cam: Cam = { x: 3.3, z: 4.4, pitch: rad(48.6), yaw: rad(30) };
    const g = snapGround(cam.pitch, cam.yaw, cam.x, cam.z);
    expect(drawnCam(cam)).toEqual({ ...cam, x: g.x, z: g.z });
  });
  it('a resized canvas moves the centre', () => {
    const cam: Cam = { x: 12, z: 9, pitch: rad(48.6), yaw: rad(135) };
    const a = renderPlan('high', 4, 1920, 1080);
    const b = renderPlan('high', 4, 1280, 720);
    const pa = toCanvas(cam, a, 4, 13, 0, 8);
    const pb = toCanvas(cam, b, 4, 13, 0, 8);
    const ca = screenCentre(a), cb = screenCentre(b);
    expect(pa.px - pb.px).toBeCloseTo(ca.px - cb.px, 6);
    expect(pa.py - pb.py).toBeCloseTo(ca.py - cb.py, 6);
  });
});

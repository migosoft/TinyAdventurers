import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOUR_RATE, HourClock, SUN_TOP, cardSunGain, fitSunMap, hourLabel, mistLightOf, sky, startHour, sunBasis, sunCoord, sunView, type Vec3 } from './sun';
import { footprint, type Footprint } from './lights';
import { groundAt } from './camera';

const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

describe('sky', () => {
  it('follows the elevation curve', () => {
    expect(sky(13).elevation).toBeCloseTo(62, 6);
    expect(sky(6).elevation).toBeCloseTo(0, 6);
    expect(Math.abs(sky(9.5).elevation - 43.84)).toBeLessThan(0.01);
    expect(Math.abs(sky(18.5).elevation - 20.477)).toBeLessThan(0.01);
  });
  it('switches to the moon at -1.5 degrees', () => {
    const m = sky(0);
    expect(m.moon).toBe(true);
    const n = Math.hypot(0.35, 0.85, 0.45);
    expect(m.dir[0]).toBeCloseTo(0.35 / n, 9);
    expect(m.dir[1]).toBeCloseTo(0.85 / n, 9);
    expect(m.dir[2]).toBeCloseTo(-0.45 / n, 9);
    expect(sky(5.5).moon).toBe(false);
    expect(sky(5.4).moon).toBe(true);
  });
  it('puts the morning sun in the west and unit directions', () => {
    expect(sky(9.5).dir[0]).toBeLessThan(0);
    expect(sky(16).dir[0]).toBeGreaterThan(0);
    for (let h = 0; h <= 24; h += 0.25) expect(Math.abs(len(sky(h).dir) - 1)).toBeLessThan(1e-9);
  });
  it('has night and ambient values', () => {
    expect(sky(13).night).toBe(0);
    expect(sky(0).night).toBe(1);
    const a = sky(0).ambient;
    expect(a[0]).toBeCloseTo(0.035, 9);
    expect(a[1]).toBeCloseTo(0.045, 9);
    expect(a[2]).toBeCloseTo(0.09, 9);
  });
  it('wraps any hour', () => {
    expect(sky(37).elevation).toBeCloseTo(sky(13).elevation, 9);
  });
});

describe('mistLightOf', () => {
  it('is full at noon, dim at night, and within 0..1', () => {
    expect(mistLightOf(sky(13))).toEqual([1, 1, 1]);
    expect(mistLightOf(sky(0))[0]).toBeLessThan(0.3);
    for (let h = 0; h <= 24; h += 0.25) for (const v of mistLightOf(sky(h))) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe('startHour', () => {
  it('reaches the sun elevation on the right side', () => {
    for (const side of [-1, 1]) for (const el of [35, 50, 62, 70]) {
      const h = startHour({ side, elevation: el });
      expect(Math.abs(sky(h).elevation - Math.min(el, 62))).toBeLessThan(1e-6);
      if (el >= 62) expect(h).toBeCloseTo(13, 9);
      else if (side === -1) expect(h).toBeLessThan(13);
      else expect(h).toBeGreaterThan(13);
    }
  });
});

describe('HourClock', () => {
  it('runs from its anchor', () => {
    expect(HOUR_RATE).toBeCloseTo(1 / 720, 12);
    const c = new HourClock(9);
    expect(c.hourAt(null, 1)).toBe(9);
    expect(c.hourAt(720, 1)).toBeCloseTo(10, 9);
    expect(c.hourAt(720, 0)).toBe(9);
    expect(c.hourAt(720 * 16, 1)).toBeCloseTo(1, 9);
    c.anchor(20, 100);
    expect(c.hourAt(100, 1)).toBe(20);
    expect(c.hourAt(100 + 720, 1)).toBeCloseTo(21, 9);
  });
});

describe('helpers', () => {
  it('card sun gain and labels', () => {
    expect(cardSunGain([0, 1, 0])).toBeCloseTo(0.86, 9);
    expect(cardSunGain([0, 0, -1])).toBeCloseTo(0.62, 9); // dir.z + 0.3 < 0: clamped
    expect(cardSunGain([0.3, 0.5, 0.8])).toBeCloseTo(0.62 + 0.3 + 0.075, 6); // z + 0.3 > 1: clamped
    expect(cardSunGain([0, 0.6, -0.1])).toBeCloseTo(0.62 + 0.3 * 0.2 + 0.09, 9);
    expect(hourLabel(9.5)).toBe('09:30');
    expect(hourLabel(24.25)).toBe('00:15');
  });
});

describe("the shader's card gain", () => {
  it('is built from the same constants as cardSunGain (no second copy of the numbers)', () => {
    const src = readFileSync(new URL('./materials.ts', import.meta.url), 'utf8');
    expect(src).toContain('CARD_GAIN.base');
    expect(src).not.toMatch(/0\.62/);
  });
});

describe('the sun map fit', () => {
  const low = (): Vec3 => {
    const e = (5 * Math.PI) / 180;
    return [Math.cos(e) * 0.6, Math.sin(e), Math.cos(e) * -0.8];
  };
  const dirs: [string, Vec3][] = [
    ['06:00', sky(6).dir],
    ['06:30', sky(6.5).dir],
    ['09:30', sky(9.5).dir],
    ['13:00', sky(13).dir],
    ['18:30', sky(18.5).dir],
    ['moon', sky(0).dir],
    ['5 degrees', low()],
  ];
  const fp: Footprint = { x0: 20, z0: 30, x1: 38, z1: 42 };
  const map = { w: 64, h: 48 };
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const box = (x0: number, x1: number, y1: number, z0: number, z1: number): Vec3[] => {
    const out: Vec3[] = [];
    for (const x of [x0, x1]) for (const y of [0, y1]) for (const z of [z0, z1]) out.push([x, y, z]);
    return out;
  };

  it.each(dirs)('covers the footprint at %s', (_n, dir) => {
    const fit = fitSunMap(dir, fp, map, 2048);
    for (const P of box(fp.x0, fp.x1, SUN_TOP, fp.z0, fp.z1)) {
      const c = sunCoord(fit, P);
      expect(c.u).toBeGreaterThanOrEqual(0);
      expect(c.u).toBeLessThanOrEqual(1);
      expect(c.v).toBeGreaterThanOrEqual(0);
      expect(c.v).toBeLessThanOrEqual(1);
    }
  });
  it.each(dirs)('depth covers the map at %s', (_n, dir) => {
    const fit = fitSunMap(dir, fp, map, 2048);
    for (const P of box(0, map.w, SUN_TOP, 0, map.h)) {
      const c = sunCoord(fit, P);
      expect(c.depth).toBeGreaterThanOrEqual(0);
      expect(c.depth).toBeLessThanOrEqual(1);
    }
  });
  it('puts depth 0 at the near plane and 1 at the far plane', () => {
    const fit = fitSunMap(sky(9.5).dir, fp, map, 1024);
    const at = (k: number): Vec3 => [fit.C[0] + fit.F[0] * fit.ext[2] * k, fit.C[1] + fit.F[1] * fit.ext[2] * k, fit.C[2] + fit.F[2] * fit.ext[2] * k];
    expect(sunCoord(fit, at(-1)).depth).toBeCloseTo(0, 9);
    expect(sunCoord(fit, at(1)).depth).toBeCloseTo(1, 9);
    expect(sunCoord(fit, at(0))).toMatchObject({ u: 0.5, v: 0.5 });
  });
  it.each(dirs)('snaps the centre to texels at %s', (_n, dir) => {
    const fit = fitSunMap(dir, fp, map, 2048);
    expect(fit.texel).toBeCloseTo((2 * fit.ext[0]) / 2048, 12);
    const nearWhole = (x: number) => Math.abs(x - Math.round(x));
    expect(nearWhole(dot(fit.C, fit.R) / fit.texel)).toBeLessThan(1e-6);
    expect(nearWhole(dot(fit.C, fit.U) / fit.texel)).toBeLessThan(1e-6);
    const s = 0.3 * fit.texel;
    const shifts: Footprint[] = [
      { x0: fp.x0 + s, x1: fp.x1 + s, z0: fp.z0, z1: fp.z1 },
      { x0: fp.x0, x1: fp.x1, z0: fp.z0 + s, z1: fp.z1 + s },
    ];
    for (const f of shifts) {
      const moved = fitSunMap(dir, f, map, 2048);
      expect(moved.texel).toBeCloseTo(fit.texel, 9);
      const d = [moved.C[0] - fit.C[0], moved.C[1] - fit.C[1], moved.C[2] - fit.C[2]];
      for (const axis of [fit.R, fit.U]) {
        const k = dot(d, axis) / fit.texel;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
      }
    }
  });
  it('leaves a margin of 2 texels at the edge', () => {
    const fit = fitSunMap(sky(9.5).dir, fp, map, 1024);
    for (const P of box(fp.x0, fp.x1, SUN_TOP, fp.z0, fp.z1)) {
      const c = sunCoord(fit, P);
      for (const k of [c.u, c.v]) {
        expect(k).toBeGreaterThanOrEqual(2 / 1024);
        expect(k).toBeLessThanOrEqual(1 - 2 / 1024);
      }
    }
  });
  it.each([0, 45, 135, -90])('covers what stands on the screen bottom edge at yaw %s', (yawDeg) => {
    const cam = { x: 30, z: 36, pitch: (48.6 * Math.PI) / 180, yaw: (yawDeg * Math.PI) / 180 };
    const halfW = 8.5;
    const halfH = 5.25;
    const view = sunView(footprint(cam, halfW, halfH), cam);
    for (const hour of [6, 6.5, 9.5, 13, 18.5, 0]) {
      const fit = fitSunMap(sky(hour).dir, view, map, 2048);
      for (const sx of [-halfW, 0, halfW]) {
        const g = groundAt(cam, sx, -halfH);
        for (const y of [0, 4, SUN_TOP]) {
          // A point at height y standing nearer the camera so that it shows on the bottom edge.
          const k = y / Math.tan(cam.pitch);
          const P: Vec3 = [g.x - Math.sin(cam.yaw) * k, y, g.z + Math.cos(cam.yaw) * k];
          const c = sunCoord(fit, P);
          expect(c.u).toBeGreaterThanOrEqual(0);
          expect(c.u).toBeLessThanOrEqual(1);
          expect(c.v).toBeGreaterThanOrEqual(0);
          expect(c.v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
  it('stays finite at a low sun', () => {
    const fit = fitSunMap(low(), fp, map, 4096);
    for (const n of [...fit.R, ...fit.U, ...fit.F, ...fit.C, ...fit.ext, fit.size, fit.texel]) expect(Number.isFinite(n)).toBe(true);
    expect(fit.ext[0]).toBeLessThan(200);
  });
  it.each(dirs)('has an orthonormal basis at %s', (_n, dir) => {
    const { R, U, F } = sunBasis(dir);
    for (const v of [R, U, F]) expect(len(v)).toBeCloseTo(1, 9);
    expect(dot(R, U)).toBeCloseTo(0, 9);
    expect(dot(R, F)).toBeCloseTo(0, 9);
    expect(dot(U, F)).toBeCloseTo(0, 9);
    expect(F[1]).toBeLessThan(0);
  });
  it('uses R = (1, 0, 0) when the light is vertical', () => {
    const { R, U, F } = sunBasis([0, 1, 0]);
    expect(R).toEqual([1, 0, 0]);
    expect(len(U)).toBeCloseTo(1, 9);
    expect(F).toEqual([-0, -1, -0]);
  });
});

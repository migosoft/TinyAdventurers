import { describe, expect, it } from 'vitest';
import { LIGHT_KIND } from '../../generated/defs';
import { sunLook } from '../../game/sunmath';
import { viewRay } from '../camera';
import { renderPlan } from '../quality';
import { crackOf, type Crack } from './cracks';
import { BLUR_CENTRE, BLUR_DIAG, SHAFT_STEPS, ignOffset, marchPoints, shaftPlan } from './shafts';

describe('ignOffset', () => {
  it('is the same for the same pixel on every call and lies in 0..1', () => {
    for (const [x, y] of [[0, 0], [5, 9], [319, 199], [1000, 3]]) {
      const a = ignOffset(x, y);
      expect(ignOffset(x, y)).toBe(a);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('spreads evenly: the mean of a 64 x 64 block is 0.5', () => {
    let sum = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) sum += ignOffset(x + 100, y + 37);
    expect(Math.abs(sum / 4096 - 0.5)).toBeLessThan(0.02);
  });

  it('has no band: every eighth of 0..1 holds close to its share of a 64 x 64 block', () => {
    const bins = new Array<number>(8).fill(0);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) bins[Math.floor(ignOffset(x, y) * 8)]++;
    for (const b of bins) expect(Math.abs(b / 4096 - 1 / 8)).toBeLessThan(0.03);
  });
});

describe('marchPoints', () => {
  const P: [number, number, number] = [3, 0.4, 7];
  for (const pitch of [20, 80]) {
    it(`pitch ${pitch}, yaw 45: ${SHAFT_STEPS} points on the ray toward the camera, the first j * dt up, the last below the top`, () => {
      const toward = viewRay((pitch * Math.PI) / 180, Math.PI / 4);
      const top = 5;
      const j = 0.3;
      const pts = marchPoints(P, toward, top, j);
      expect(pts).toHaveLength(SHAFT_STEPS);
      const dt = (top - P[1]) / toward[1] / SHAFT_STEPS;
      const first = pts[0];
      expect(Math.hypot(first[0] - P[0], first[1] - P[1], first[2] - P[2])).toBeCloseTo(j * dt, 6);
      for (const q of pts) {
        const s = ((q[1] - P[1]) / toward[1]);
        expect(q[0]).toBeCloseTo(P[0] + toward[0] * s, 6);
        expect(q[2]).toBeCloseTo(P[2] + toward[2] * s, 6);
        expect(q[1]).toBeGreaterThan(P[1]);
      }
      expect(pts[pts.length - 1][1]).toBeLessThan(top);
    });
  }
});

describe('marchPoints above the top', () => {
  it('a surface above the ceiling gets steps of length 0 (the shader clamps top - P.y at 0): every point is P', () => {
    const toward = viewRay((48 * Math.PI) / 180, 0);
    const P: [number, number, number] = [1, 6, 2];
    for (const q of marchPoints(P, toward, 3, 0.7)) expect(q).toEqual(P);
  });
});

describe('the blur', () => {
  it('keeps the light: the centre and four diagonal taps sum to 1', () => {
    expect(BLUR_CENTRE + 4 * BLUR_DIAG).toBeCloseTo(1, 12);
  });
});

describe('shaftPlan', () => {
  const crack = (ceil: number): Crack => ({ ...crackOf({ id: 1, kind: LIGHT_KIND.Daylight, colour: 0xffffff, x: 5, y: 6, on: true }, sunLook, 0), ceil });

  it('does not run without shafts or without cracks', () => {
    const plan = renderPlan('balanced', 4, 1280, 720);
    expect(shaftPlan({ plan, cracks: [crack(3)] })).toBeNull();
    expect(shaftPlan({ plan, shafts: false, cracks: [crack(3)] })).toBeNull();
    expect(shaftPlan({ plan, shafts: true })).toBeNull();
    expect(shaftPlan({ plan, shafts: true, cracks: [] })).toBeNull();
  });

  it('works at the art size of the plan, which follows the canvas and the zoom', () => {
    const a = shaftPlan({ plan: renderPlan('balanced', 4, 1280, 720), shafts: true, cracks: [crack(3)] })!;
    expect([a.artW, a.artH]).toEqual([320, 180]);
    const b = shaftPlan({ plan: renderPlan('balanced', 3, 1280, 720), shafts: true, cracks: [crack(3)] })!;
    expect([b.artW, b.artH]).toEqual([428, 240]);
    expect(b.texel).toEqual([1 / 428, 1 / 240]);
  });

  it('top is the highest ceiling of the frame', () => {
    expect(shaftPlan({ plan: renderPlan('fast', 4, 1280, 720), shafts: true, cracks: [crack(3), crack(5.5), crack(4)] })!.top).toBe(5.5);
  });

  it('uvScale is 1 when the art grid is the picture (off-screen target), and canvas / zoom / art when drawing straight to the canvas', () => {
    const off = shaftPlan({ plan: renderPlan('balanced', 4, 1283, 721), shafts: true, cracks: [crack(3)] })!;
    expect(off.uvScale).toEqual([1, 1]);
    const plan = renderPlan('high', 4, 1283, 721);
    expect(plan.direct).toBe(true);
    const direct = shaftPlan({ plan, shafts: true, cracks: [crack(3)] })!;
    // The art grid is even: 2 * ceil(1283 / 8) = 322 and 2 * ceil(721 / 8) = 182.
    expect([direct.artW, direct.artH]).toEqual([322, 182]);
    expect(direct.uvScale[0]).toBeCloseTo(1283 / 4 / 322, 12);
    expect(direct.uvScale[1]).toBeCloseTo(721 / 4 / 182, 12);
    expect(direct.uvScale[0]).toBeLessThan(1);
  });
});

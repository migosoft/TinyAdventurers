import { describe, expect, it } from 'vitest';
import { restPose } from './pose';
import { BONE, BONES, FOOT, J, RIG, placeBones } from './skeleton';
import { WING, WING_PT, beatTarget, chainStep, newWing, newWingFrame, wingBones, wingStep, type WingState, type WingTarget } from './wings';

const at = (f: Float64Array, i: number): number[] => [f[i * 3], f[i * 3 + 1], f[i * 3 + 2]];
const tip = (f: Float64Array, finger: number): number[] => at(f, WING_PT.finger + finger * 6 + 5);
const near = (a: number[], b: number[], eps: number): void => { for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(eps); };
const PARTS = ['arm', 'hand', 'tips'] as const, KEYS = ['fold', 'raise', 'sweep', 'pitch'] as const;

/** A wing beating in place from the top of the stroke for `seconds` at `fps`; `each` sees every frame. */
function beatFor(seconds: number, fps: number, each?: (w: WingState, phase: number, frame: number) => void): WingState {
  const T: WingTarget = { fold: 0, raise: 0, sweep: 0, pitch: 0 }, w = newWing(beatTarget(0, T)), n = Math.round(seconds * fps);
  for (let i = 1; i <= n; i++) {
    const phase = (i / fps / WING.beat) % 1;
    wingStep(w, beatTarget(phase, T), 1 / fps);
    each?.(w, phase, i);
  }
  return w;
}

describe('the wing\'s bones', () => {
  it('are the approved rest at fold 0.42: the spike\'s elbow, wrist and finger tips, mirrored on the left', () => {
    const f = newWingFrame();
    wingBones(newWing(WING.rest), 1, f);
    near(at(f, WING_PT.shoulder), [-3, 4, 2.8], 0.05);
    near(at(f, WING_PT.elbow), [-7.529, 8.736, 7.125], 0.05);
    near(at(f, WING_PT.wrist), [-9.27, 16.959, 7.181], 0.05);
    near(at(f, WING_PT.back), [-0.705, -10.208, 3.573], 0.05);
    const tips = [[-27.476, 7.949, 31.61], [-18.793, -7.658, 24.956], [-10.961, -16.721, 17.695], [-4.351, -19.299, 10.294]];
    tips.forEach((t, i) => near(tip(f, i), t, 0.05));
    for (let i = 0; i < 4; i++) near(at(f, WING_PT.finger + i * 6), at(f, WING_PT.wrist), 1e-9);
    const n = at(f, WING_PT.normal);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
    expect(n[0]).toBeLessThan(-0.5);   // behind the wing
    const l = newWingFrame();
    wingBones(newWing(WING.rest), -1, l);
    for (let i = 0; i < 29; i++) near(at(l, i), [f[i * 3], f[i * 3 + 1], -f[i * 3 + 2]], 1e-9);
  });

  it('open wide at fold 0 and close to a narrow bundle at fold 1', () => {
    const f = newWingFrame(), reach = (fold: number): number => { wingBones(newWing({ ...WING.rest, fold }), 1, f); return Math.max(...[0, 1, 2, 3].map((i) => Math.hypot(...tip(f, i).map((v, k) => v - f[k])))); };
    const spread = (fold: number): number => { wingBones(newWing({ ...WING.rest, fold }), 1, f); return Math.hypot(...tip(f, 0).map((v, k) => v - tip(f, 3)[k])); };
    expect(reach(0)).toBeGreaterThan(reach(0.42) * 1.1);
    expect(spread(1)).toBeLessThan(spread(0) / 2.5);
    expect(spread(0)).toBeGreaterThan(spread(0.42));
  });
});

describe('wingStep', () => {
  const raised: WingTarget = { fold: 0.1, raise: 0.9, sweep: 0.2, pitch: -0.3 };

  it('moves the arm first, then the hand, then the tips, and all arrive', () => {
    const w = newWing(WING.rest);
    for (let i = 0; i < 6; i++) wingStep(w, raised, 1 / 60);
    expect(w.arm.raise).toBeGreaterThan(w.hand.raise);
    expect(w.hand.raise).toBeGreaterThan(w.tips.raise);
    expect(w.tips.raise).toBeGreaterThan(WING.rest.raise);
    for (let i = 0; i < 120; i++) wingStep(w, raised, 1 / 60);
    for (const p of PARTS) for (const k of KEYS) expect(Math.abs(w[p][k] - raised[k])).toBeLessThan(0.01);
    expect(Math.abs(w.billow)).toBeLessThan(0.01);
  });

  it('changes nothing at dt 0', () => {
    const w = newWing(WING.rest);
    for (let i = 0; i < 6; i++) wingStep(w, raised, 1 / 60);
    const before = JSON.stringify(w);
    wingStep(w, WING.rest, 0);
    expect(JSON.stringify(w)).toBe(before);
  });

  it('snaps every part to the target on a long frame (Review focus 1)', () => {
    const w = newWing(WING.rest);
    for (let i = 0; i < 6; i++) wingStep(w, raised, 1 / 60);
    wingStep(w, raised, 5);
    for (const p of PARTS) for (const k of KEYS) { expect(w[p][k]).toBe(raised[k]); expect(w[`${p}V`][k]).toBe(0); }
    expect(w.billow).toBe(0);
    const f = newWingFrame();
    wingBones(w, 1, f);
    expect(f.every(Number.isFinite)).toBe(true);
    // just under the bound it still steps, and stays finite
    wingStep(w, WING.rest, WING.maxDt);
    expect(w.arm.raise).not.toBe(raised.raise);
    expect(Object.values(w.tips).every(Number.isFinite)).toBe(true);
  });
});

describe('the beat', () => {
  const T: WingTarget = { fold: 0, raise: 0, sweep: 0, pitch: 0 };
  const mid = { down: WING.down / 2, up: (1 + WING.down) / 2 };

  it('is a hard down stroke at full stretch and a folded up stroke, the same at phase 0 and 1', () => {
    const top = beatTarget(0, { ...T }).raise, bottom = beatTarget(WING.down, { ...T }).raise;
    expect(top).toBeGreaterThan(bottom + 1);
    for (let p = 0; p <= WING.down; p += 0.02) expect(beatTarget(p, T).fold).toBe(0);
    expect(beatTarget(0.7, T).fold).toBeGreaterThan(0.2);
    expect(beatTarget(0.93, T).fold).toBeCloseTo(0, 6);
    const a = { ...beatTarget(0, T) }, b = { ...beatTarget(1, T) }, c = { ...beatTarget(0.9999, T) };
    for (const k of KEYS) { expect(b[k]).toBeCloseTo(a[k], 9); expect(c[k]).toBeCloseTo(a[k], 2); }
    // the down stroke is the faster one
    const speed = (p: number): number => Math.abs(beatTarget(p + 0.01, { ...T }).raise - beatTarget(p - 0.01, { ...T }).raise);
    expect(speed(mid.down)).toBeGreaterThan(speed(mid.up) * 1.2);
  });

  it('is narrower going up than coming down, the tips late, the webbing bellied against the stroke', () => {
    // the middles of the strokes as the wing really makes them: where the hand passes the middle of its way, going down and going up
    const f = newWingFrame(), seen: Record<string, { span: number; tipOff: number; billow: number }> = {};
    const frames = Math.round(3 * WING.beat * 60), half = (WING.stroke.raise[0] + WING.stroke.raise[1]) / 2;
    let last = 0;
    beatFor(3 * WING.beat, 60, (w, _phase, i) => {
      const was = last;
      last = w.hand.raise;
      if (i < frames - Math.round(WING.beat * 60)) return;   // the third beat
      for (const name of ['down', 'up']) {
        if (name === 'down' ? !(was > half && last <= half) : !(was < half && last >= half)) continue;
        wingBones(w, 1, f);
        const n = at(f, WING_PT.normal), wr = at(f, WING_PT.wrist), up = Math.sign(n[1]);
        // how far the long fingers' tips stand above the hand's plane
        const off = [0, 1].map((k) => tip(f, k).reduce((s, v, a) => s + (v - wr[a]) * n[a], 0) * up);
        seen[name] = { span: 2 * Math.max(...[0, 1, 2, 3].map((k) => tip(f, k)[2])), tipOff: Math.min(...off), billow: w.billow };
      }
    });
    expect(seen.up.span).toBeLessThan(seen.down.span * 0.85);
    expect(seen.down.tipOff).toBeGreaterThan(0.5);
    expect(seen.down.billow * seen.up.billow).toBeLessThan(0);
    expect(seen.down.billow).toBeGreaterThan(0);   // towards the wing's back, which looks up in the down stroke
  });

  it('never pops: no finger tip jumps between two frames, across the phase\'s wrap too', () => {
    const f = newWingFrame(), last = new Float64Array(12);
    let worst = 0, worstAtWrap = 0, prev = 0;
    beatFor(3 * WING.beat + 0.3, 60, (w, phase, i) => {
      wingBones(w, 1, f);
      for (let k = 0; k < 4; k++) {
        const t = tip(f, k), d = Math.hypot(t[0] - last[k * 3], t[1] - last[k * 3 + 1], t[2] - last[k * 3 + 2]);
        if (i > 1) { worst = Math.max(worst, d); if (phase < prev) worstAtWrap = Math.max(worstAtWrap, d); }
        last.set(t, k * 3);
      }
      prev = phase;
    });
    expect(worst).toBeLessThan(5);
    expect(worstAtWrap).toBeLessThan(worst);
    expect(worstAtWrap).toBeGreaterThan(0);
  });

  it('is the same wing at 30 and at 144 frames a second', () => {
    const a = newWingFrame(), b = newWingFrame();
    wingBones(beatFor(3, 30), 1, a); wingBones(beatFor(3, 144), 1, b);
    for (let k = 0; k < 4; k++) expect(Math.hypot(...tip(a, k).map((v, i) => v - tip(b, k)[i]))).toBeLessThan(0.5);
  });
});

describe('chainStep', () => {
  const rates = [9, 8, 7, 6, 5, 4];

  it('a swing travels down the links, and it settles', () => {
    const links = new Float32Array(12), vel = new Float32Array(12);
    for (let i = 0; i < 9; i++) chainStep(links, vel, 1, -0.5, rates, 1 / 60);
    for (let i = 1; i < 6; i++) { expect(links[i * 2]).toBeLessThan(links[i * 2 - 2]); expect(links[i * 2 + 1]).toBeGreaterThan(links[i * 2 - 1]); }
    expect(links[2]).toBeGreaterThan(links[10] + 0.05);
    expect(links[10]).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 600; i++) chainStep(links, vel, 1, -0.5, rates, 1 / 60);
    for (let i = 0; i < 6; i++) { expect(links[i * 2]).toBeCloseTo(1, 2); expect(links[i * 2 + 1]).toBeCloseTo(-0.5, 2); expect(Math.abs(vel[i * 2])).toBeLessThan(0.01); }
  });

  it('holds at dt 0 and snaps to the root on a long frame', () => {
    const links = new Float32Array(12), vel = new Float32Array(12);
    for (let i = 0; i < 9; i++) chainStep(links, vel, 1, 0.3, rates, 1 / 60);
    const before = Array.from(links);
    chainStep(links, vel, -2, 0, rates, 0);
    expect(Array.from(links)).toEqual(before);
    chainStep(links, vel, -2, 0.25, rates, 5);
    for (let i = 0; i < 6; i++) { expect(links[i * 2]).toBe(-2); expect(links[i * 2 + 1]).toBe(0.25); }
    expect(Array.from(vel)).toEqual(new Array(12).fill(0));
  });
});

describe('the legs', () => {
  const M = new Float32Array(BONES * 12);
  /** Where the foot bone puts the sole: the foot point. */
  const sole = (foot: number): number[] => {
    const o = foot * 12, x = RIG.sole[0] - RIG.hock[0], y = RIG.sole[1] - RIG.hock[1];
    return [M[o] + M[o + 3] * x + M[o + 6] * y, M[o + 1] + M[o + 4] * x + M[o + 7] * y, M[o + 2] + M[o + 5] * x + M[o + 8] * y];
  };

  it('stand flat on a planted foot point and hang the toes 35 degrees on a lifted one and in the air', () => {
    const pose = restPose(), j = pose.joints;
    placeBones(pose, M);
    near(sole(BONE.footR), [RIG.sole[0], 0, RIG.legZ], 1e-4);
    expect(M[BONE.footR * 12 + 4]).toBeCloseTo(0, 6);
    // the swing: the right foot lifted and forward
    j[J.footR + FOOT.x] += 3; j[J.footR + FOOT.y] = RIG.toesClear;
    placeBones(pose, M);
    near(sole(BONE.footR), [RIG.sole[0] + 3, RIG.toesClear, RIG.legZ], 1e-4);
    expect(M[BONE.footR * 12 + 4]).toBeCloseTo(-Math.sin(RIG.toesHang), 5);
    expect(RIG.toesHang).toBeCloseTo((35 * Math.PI) / 180, 9);
    expect(M[BONE.footL * 12 + 4]).toBeCloseTo(0, 6);   // the planted one stays flat
    // half way up the toes hang less
    j[J.footR + FOOT.y] = RIG.toesClear / 2;
    placeBones(pose, M);
    expect(-M[BONE.footR * 12 + 4]).toBeGreaterThan(0.1);
    expect(-M[BONE.footR * 12 + 4]).toBeLessThan(Math.sin(RIG.toesHang) - 0.1);
    // in the air both hang, the foot points still under the hips
    const air = restPose();
    air.lift = 10;
    placeBones(air, M);
    for (const [b, sd] of [[BONE.footR, 1], [BONE.footL, -1]]) { expect(M[b * 12 + 4]).toBeCloseTo(-Math.sin(RIG.toesHang), 5); near(sole(b), [RIG.sole[0], 0, sd * RIG.legZ], 1e-4); }
  });

  it('are straight, not broken, when the foot point is out of reach', () => {
    const pose = restPose();
    pose.joints[J.footL + FOOT.y] = -30; pose.joints[J.footL + FOOT.x] = 12;
    placeBones(pose, M);
    expect(M.every(Number.isFinite)).toBe(true);
    const t = BONE.thighL * 12, s = BONE.shinL * 12, f = BONE.footL * 12;
    const a = [M[s] - M[t], M[s + 1] - M[t + 1], M[s + 2] - M[t + 2]], b = [M[f] - M[s], M[f + 1] - M[s + 1], M[f + 2] - M[s + 2]];
    const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
    expect(cos).toBeGreaterThan(0.999);
  });
});

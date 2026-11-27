import { describe, expect, it } from 'vitest';
import { ANIM, FLAG } from '../../generated/defs';
import { DEMON_ACTS, actPeriod, demonAct } from '../demonScript';
import { B, BONES, BONE_DEFS, buildDemonSkin } from './body';
import { ARM, FOOT, J, RIG, SKEL, onBone, placeBones } from './skeleton';
import { newDemonMem, demonPose, restPose, type DemonMem } from './pose';
import type { BuiltIn } from '../built';
// every bone's pivot on the spike's own page (its `animate`, #441), builder frame, the flying ones without the spike's 1.0 of lift:
// `stand` (wings folded), `half` and `open` (the fold at 0.5 and 0), all at its clock 0; `fly`, `fly1..3` a quarter beat apart from 1/6 s on
import SPIKE from './spikeStances.fixture.json';

const M = new Float32Array(BONES * 16);
type P3 = [number, number, number];
const at = (n: string): P3 => BONE_DEFS[B[n]][2];
const inp = (o: Partial<BuiltIn> = {}): BuiltIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, x: 3, z: 4, ...o });
const LEG = /^(thigh|shin|foot|toes)[LR]$/;
/** The furthest any bone's pivot lies from where the spike has it (builder units), and which bone. */
function off(m: DemonMem, spike: Record<string, number[]>, skip?: RegExp): [number, string] {
  placeBones(m.pose, M);
  let worst = 0, name = '';
  for (const n in spike) {
    if (skip?.test(n)) continue;
    const p = onBone(M, B[n], at(n), [0, 0, 0]), s = spike[n], d = Math.hypot(p[0] - s[2], p[1] - s[1], p[2] + s[0]);   // model (x, y, z) = builder (z, y, -x)
    if (d > worst) { worst = d; name = n; }
  }
  return [worst, name];
}

describe('placeBones: the spike\'s stances', () => {
  it('first seen standing it is the spike\'s stance to the bone: trunk, arms, fingers, the legs on the floor, the folded wings, the tail', () => {
    const m = newDemonMem();
    demonPose(inp(), 0, m);
    expect(Object.keys(SPIKE.stand).length).toBe(BONES - 6);   // all but the chain's links, which the spike hung as loose parts
    const [d, n] = off(m, SPIKE.stand);
    expect(d, n).toBeLessThan(0.004);
    for (const f of ['footL', 'footR']) expect(onBone(M, B[f], at(f), [0, 0, 0])[1]).toBeCloseTo(0.28, 3);
  });

  it('the wings fold at their joints as the spike\'s do: half folded and open they lie where the spike has them', () => {
    for (const [fold, spike] of [[0.5, SPIKE.half], [0, SPIKE.open]] as const) {
      const m = newDemonMem();
      demonPose(inp(), 0, m);
      for (const w of [m.pose.wingL, m.pose.wingR]) w.arm.fold = w.hand.fold = w.tips.fold = fold;
      const [d, n] = off(m, spike);
      expect(d, `${fold} ${n}`).toBeLessThan(0.004);
    }
  });

  it('first seen in the air it is the spike\'s flying stance, and a beat on it stays the spike\'s: the wings\' joints, the bob, the streaming tail', () => {
    const m = newDemonMem();
    demonPose(inp({ flags: FLAG.AIRBORNE }), 1 / 6, m);   // the spike's clock at the top of its stroke
    const [d, n] = off(m, SPIKE.fly, LEG);
    expect(d, n).toBeLessThan(0.004);
    // the legs hang as the spike's, but for their own swing with the beat (#379's)
    expect(off(m, SPIKE.fly)[0]).toBeLessThan(0.1);
    for (const spike of [SPIKE.fly1, SPIKE.fly2, SPIKE.fly3]) {
      for (let i = 0; i < 10; i++) demonPose(inp({ flags: FLAG.AIRBORNE, animT: 1 }), 1 / 60, m);
      const [e, k] = off(m, spike, LEG);
      expect(e, k).toBeLessThan(0.01);
    }
  });
});

describe('placeBones', () => {
  it('skinning the coarse skin by hand with placeBones(restPose()) keeps the head\'s top near SKEL.crown and both ankles at 0.28 ± 0.01', () => {
    placeBones(restPose(), M);
    const part = buildDemonSkin(0.05).body, q: P3 = [0, 0, 0], p: P3 = [0, 0, 0];
    let top = -9, low = 9;
    for (let k = 0; k < part.position.length / 3; k++) {
      let y = 0, z = 0;
      for (let j = 0; j < 4; j++) {
        const w = part.skinWeight[k * 4 + j] / (part.skinWeight[k * 4] + part.skinWeight[k * 4 + 1] + part.skinWeight[k * 4 + 2] + part.skinWeight[k * 4 + 3]);
        if (!w) continue;
        p[0] = part.position[k * 3]; p[1] = part.position[k * 3 + 1]; p[2] = part.position[k * 3 + 2];
        onBone(M, part.skinIndex[k * 4 + j], p, q);
        y += q[1] * w; z += q[2] * w;
      }
      // the midline's highest point is the crest; the horns reach higher
      if (Math.abs(z) < 0.06) top = Math.max(top, y);
      low = Math.min(low, y);
    }
    // the stance stands with bent knees and a bowed head: lower than the bind pose
    expect(top).toBeGreaterThan(SKEL.crown - 0.4);
    expect(top).toBeLessThan(SKEL.crown + 0.1);
    expect(Math.abs(low)).toBeLessThan(0.05);
    for (const n of ['footL', 'footR']) expect(onBone(M, B[n], at(n), [0, 0, 0])[1]).toBeCloseTo(0.28, 2);
    expect(SKEL.perPose).toBeCloseTo(2.68 / 31.7, 12);
  });

  it('the controls add to the stance: the head turns right, the jaw opens, the arm swings forward, the hips take the pose\'s place, the foot point moves the foot', () => {
    const base = new Float32Array(BONES * 16), pose = restPose(), j = pose.joints;
    placeBones(pose, base);
    const where = (n: string, p: P3 = at(n)): P3 => onBone(M, B[n], p, [0, 0, 0]);
    const was = (n: string, p: P3 = at(n)): P3 => onBone(base, B[n], p, [0, 0, 0]);
    // a point 0.3 in front of the head's pivot goes to the demon's right (+z) for a positive TURN
    const ahead = (p: P3): P3 => [p[0], p[1], p[2] + 0.3];
    j[J.head] = 0.5;
    placeBones(pose, M);
    expect(where('head', ahead(at('head')))[2]).toBeGreaterThan(was('head', ahead(at('head')))[2] + 0.05);
    j[J.head] = 0; j[J.jaw] = 1;
    placeBones(pose, M);
    expect(where('jaw', at('jaw'))[1]).toBeCloseTo(was('jaw', at('jaw'))[1], 6);
    expect(where('jaw', ahead(at('jaw')))[1]).toBeLessThan(was('jaw', ahead(at('jaw')))[1] - 0.05);
    j[J.jaw] = 0; j[J.armR + ARM.swing] = 0.8;
    placeBones(pose, M);
    const hand = at('handR');
    expect(where('upperArmR', hand)[0]).toBeGreaterThan(was('upperArmR', hand)[0] + 0.1);   // model x is the front
    j[J.armR + ARM.swing] = 0; j[J.hipsY] = 2; j[J.hipsX] = 3;
    placeBones(pose, M);
    expect(where('hips')[1] - was('hips')[1]).toBeCloseTo(2 * SKEL.perPose, 6);
    expect(where('hips')[0] - was('hips')[0]).toBeCloseTo(3 * SKEL.perPose, 6);
    j[J.hipsY] = 0; j[J.hipsX] = 0; j[J.footR + FOOT.x] += 3;
    placeBones(pose, M);
    expect(where('footR')[0] - was('footR')[0]).toBeCloseTo(3 * SKEL.perPose, 4);
    expect(where('footL')[0]).toBeCloseTo(was('footL')[0], 6);
    // the foot flat when planted, the toes hanging 35 degrees when the foot point is lifted
    j[J.footR + FOOT.y] = RIG.toesClear;
    placeBones(pose, M);
    const toe = at('toesR'), drop = where('footR', toe)[1] - where('footR', at('footR'))[1];
    expect(drop).toBeLessThan(was('footR', toe)[1] - was('footR', at('footR'))[1] - 0.02);
    // the shoulders shrug: both rise
    j[J.footR + FOOT.y] = 0; j[J.footR + FOOT.x] -= 3; j[J.shrug] = 0.2;
    placeBones(pose, M);
    for (const n of ['upperArmL', 'upperArmR']) expect(where(n)[1]).toBeGreaterThan(was(n)[1] + 0.03);
  });

  it('the hands: the free left hand closes with its curl and its thumb with its own; the sword hand keeps its grip whatever the pose says', () => {
    const base = new Float32Array(BONES * 16), pose = restPose(), j = pose.joints;
    placeBones(pose, base);
    const tip = (m: Float32Array, n: string): P3 => onBone(m, B[n], [at(n)[0], at(n)[1] - 0.1, at(n)[2]], [0, 0, 0]);
    const moved = (n: string): number => { const a = tip(M, n), b = tip(base, n); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
    j[J.armL + ARM.curl] = 0.8; j[J.armL + ARM.thumb] = 0.8;
    placeBones(pose, M);
    for (let i = 0; i < 4; i++) expect(moved(`f${i}cL`)).toBeGreaterThan(0.05);
    expect(moved('th1L')).toBeGreaterThan(0.02);
    // the three joints share it: the tip's bone turns more than its root's
    expect(moved('f1cL')).toBeGreaterThan(moved('f1aL') * 1.5);
    j[J.armL + ARM.curl] = 0; j[J.armL + ARM.thumb] = 0; j[J.armR + ARM.curl] = -1; j[J.armR + ARM.thumb] = -1;
    placeBones(pose, M);
    for (const n of ['f0cR', 'f3cR', 'th1R']) expect(moved(n)).toBe(0);
    // the fingers flex in their own time, on the pose's clock
    j[J.armR + ARM.curl] = 0; j[J.armR + ARM.thumb] = 0; pose.clock = 2;
    placeBones(pose, M);
    expect(moved('f2cL')).toBeGreaterThan(0.002);
    expect(moved('f2cR')).toBeGreaterThan(0);   // the grip tightens a little
    expect(moved('f2cR')).toBeLessThan(0.01);
  });

  it('the chain hangs straight down from the wrist whatever the arm does, and swings by the pose\'s turns', () => {
    const pose = restPose(), j = pose.joints;
    const link = (i: number): P3 => onBone(M, B[`chain${i}`], at(`chain${i}`), [0, 0, 0]);
    for (const swing of [0, 1.2]) {
      j[J.armL + ARM.swing] = swing; j[J.armL + ARM.out] = swing / 2;
      placeBones(pose, M);
      const hang = onBone(M, B.foreArmL, [at('chain0')[0], at('chain0')[1] + 0.03, at('chain0')[2]], [0, 0, 0]);
      const a = link(0), z = link(5);
      // the first link 0.03 under the point it hangs from, the last straight below it
      expect(Math.hypot(a[0] - hang[0], a[2] - hang[2])).toBeLessThan(1e-6);
      expect(hang[1] - a[1]).toBeCloseTo(0.03, 6);
      expect(Math.hypot(z[0] - a[0], z[2] - a[2])).toBeLessThan(1e-6);
      expect(a[1] - z[1]).toBeCloseTo(5 * 0.075, 6);
    }
    for (let i = 0; i < 6; i++) pose.chain[i * 2 + 1] = 0.2;
    placeBones(pose, M);
    expect(Math.abs(link(5)[0] - link(0)[0])).toBeGreaterThan(0.1);   // about the left axis: it swings front to back
    expect(Math.abs(link(5)[2] - link(0)[2])).toBeLessThan(1e-6);
  });

  it('keeps the leg straight, not broken, when the foot point is out of reach', () => {
    const pose = restPose();
    pose.joints[J.footL + FOOT.y] = -30; pose.joints[J.footL + FOOT.x] = 12;
    placeBones(pose, M);
    expect(M.every(Number.isFinite)).toBe(true);
    const p = (n: string): P3 => onBone(M, B[n], at(n), [0, 0, 0]);
    const t = p('thighL'), s = p('shinL'), f = p('footL');
    const a = [s[0] - t[0], s[1] - t[1], s[2] - t[2]], b = [f[0] - s[0], f[1] - s[1], f[2] - s[2]];
    expect((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b))).toBeGreaterThan(0.999);
  });

  it('gives the same bytes when it places the same pose twice into one array (no state is kept between calls)', () => {
    const pose = restPose();
    pose.joints[J.head] = 0.4; pose.joints[J.armL + ARM.swing] = 0.7; pose.joints[J.footR + FOOT.x] += 2; pose.fly = 0.4; pose.beat = 0.3; pose.clock = 5;
    placeBones(pose, M);
    const first = Array.from(M);
    placeBones(restPose(), M);   // something else in between
    placeBones(pose, M);
    expect(Array.from(M)).toEqual(first);
  });

  it('writes no NaN for any act of the page\'s script', () => {
    for (const act of DEMON_ACTS) {
      const m = newDemonMem();
      for (let i = 0, n = Math.ceil(actPeriod(act) * 30); i <= n; i++) {
        const a = demonAct(act, i / 30);
        demonPose(inp({ anim: a.anim, animT: a.animMs / 1000, flags: a.flags }), 1 / 30, m);
        placeBones(m.pose, M);
        expect(M.every(Number.isFinite), `${act} ${i}`).toBe(true);
      }
    }
  });
});

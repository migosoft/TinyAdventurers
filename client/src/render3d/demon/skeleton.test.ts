import { describe, expect, it } from 'vitest';
import { Bone, Euler, Vector3 } from 'three/webgpu';
import { ANIM } from '../../generated/defs';
import { DEMON_ACTS, actPeriod, demonAct } from '../demonScript';
import { B, BONES, BONE_DEFS, buildDemonSkin } from './body';
import { ARM, FOOT, J, RIG, SKEL, STANCE, onBone, placeBones } from './skeleton';
import { newDemonMem, demonPose, restPose } from './pose';
import type { BuiltIn } from '../built';

const M = new Float32Array(BONES * 16);
type P3 = [number, number, number];
const at = (n: string): P3 => BONE_DEFS[B[n]][2];
/** Builder frame -> model frame. */
const turn = (v: P3): P3 => [v[2], v[1], -v[0]];
const near = (a: ArrayLike<number>, b: ArrayLike<number>, d = 1e-5): void => { for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], -Math.log10(d)); };

/** The stance on three's own bones, as the spike built it: YXZ turns, each bone hung on its parent at the difference of the rest places. */
function spike(): Map<string, Bone> {
  const by = new Map<string, Bone>();
  for (const [name, parent, p] of BONE_DEFS) {
    const b = new Bone(), pp = parent ? at(parent) : ([0, 0, 0] as P3);
    b.rotation.order = 'YXZ';
    const s = STANCE[name] ?? [0, 0, 0];
    b.rotation.set(s[0], s[1], s[2]);
    b.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (parent) by.get(parent)!.add(b);
    by.set(name, b);
  }
  by.get('hips')!.updateMatrixWorld(true);
  return by;
}

describe('placeBones', () => {
  it('with every joint at rest a bone matrix moves its rest point to the stance\'s place, turned into the model frame', () => {
    placeBones(restPose(), M);
    const bones = spike(), probe = new Vector3(), o: P3 = [0, 0, 0];
    let checked = 0;
    for (const [name] of BONE_DEFS) {
      // the legs are solved to the foot points, not turned by the stance
      if (/^(thigh|shin|foot|toes)[LR]$/.test(name)) continue;
      const a = at(name), p: P3 = [a[0] + 0.1, a[1] + 0.2, a[2] + 0.3];
      probe.set(p[0] - a[0], p[1] - a[1], p[2] - a[2]).applyMatrix4(bones.get(name)!.matrixWorld);
      near(onBone(M, B[name], p, o), turn([probe.x, probe.y, probe.z]));
      checked++;
    }
    expect(checked).toBeGreaterThan(70);
    expect(new Euler().setFromRotationMatrix(bones.get('head')!.matrixWorld).x).not.toBe(0);   // the stance does turn bones
  });

  it('skinning the coarse skin by hand with placeBones(restPose()) keeps the head\'s top at SKEL.crown and both ankles at 0.28 ± 0.01', () => {
    placeBones(restPose(), M);
    const part = buildDemonSkin(0.05).body, q: P3 = [0, 0, 0], p: P3 = [0, 0, 0];
    let top = -9, low = 9;
    for (let k = 0; k < part.position.length / 3; k++) {
      let y = 0, z = 0;
      for (let j = 0; j < 4; j++) {
        const w = part.skinWeight[k * 4 + j];
        if (!w) continue;
        p[0] = part.position[k * 3]; p[1] = part.position[k * 3 + 1]; p[2] = part.position[k * 3 + 2];
        onBone(M, part.skinIndex[k * 4 + j], p, q);
        y += q[1] * w; z += q[2] * w;
      }
      // the midline's highest point is the crest; the horns reach higher
      if (Math.abs(z) < 0.06) top = Math.max(top, y);
      low = Math.min(low, y);
    }
    expect(Math.abs(top - SKEL.crown)).toBeLessThan(0.1);
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

  it('writes no NaN for any act of the page\'s script', () => {
    const inp = (o: Partial<BuiltIn>): BuiltIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, x: 3, z: 4, ...o });
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

import { describe, expect, it } from 'vitest';
import { ANIM, CONST, EFFECT, FLAG } from '../../generated/defs';
import type { BuiltIn } from '../built';
import { actPeriod, DEMON_ACTS, DEMON_SPEED, demonAct, demonDev, FLY_ACT } from '../demonScript';
import { DEMON_POSE as P, demonPose, newDemonMem, restPose, type DemonMem } from './pose';
import { B, BONES, BONE_DEFS, HORN_PATH, TAIL_N } from './body';
import { DEMON, DEMON_FIGURE } from './figure';
import { ARM, FLY_FEET, FOOT, J, JOINTS, LEAN, ROLL, SKEL, TURN, WINGS, onBone, placeBones } from './skeleton';
import { WING } from './wings';

const FPS = 60, AIR = FLAG.AIRBORNE;
const inp = (o: Partial<BuiltIn> = {}): BuiltIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, x: 3, z: 4, ...o });
/** Plays `anim` from `from` to `to` s of its clock at `fps`; `each` sees every frame. A fresh memory is first shown standing. */
function play(m: DemonMem, anim: number, from: number, to: number, o: Partial<BuiltIn> = {}, each?: (t: number) => void, fps = FPS): void {
  if (!m.started) demonPose(inp({ ...o, anim: ANIM.Idle }), 0, m);
  for (let i = 0, n = Math.round((to - from) * fps); i <= n; i++) { const t = i === n ? to : from + i / fps; demonPose(inp({ ...o, anim, animT: t }), 1 / fps, m); each?.(t); }
}
const stand = (m: DemonMem, secs: number, o: Partial<BuiltIn> = {}, each?: (t: number) => void): void => play(m, ANIM.Idle, 0, secs, o, each);
const bones = new Float32Array(BONES * 16);
type P3 = [number, number, number];
/** Pose units: the skeleton's own are builder units, a pose unit is `SKEL.perPose` of them. */
const inPose = (p: P3): P3 => [p[0] / SKEL.perPose, p[1] / SKEL.perPose, p[2] / SKEL.perPose];
const rest = (bone: string): P3 => BONE_DEFS[B[bone]][2];
/** A bone's pivot in the model frame. */
function at(m: DemonMem, bone: string): P3 {
  placeBones(m.pose, bones);
  return inPose(onBone(bones, B[bone], rest(bone), [0, 0, 0]));
}
/** The middle of the head: `headMid` up the head's own axis. */
function head(m: DemonMem): P3 {
  placeBones(m.pose, bones);
  const [x, y, z] = rest('head');
  return inPose(onBone(bones, B.head, [x, y + (P.headMid - 28.2) * SKEL.perPose, z], [0, 0, 0]));
}
const REST = restPose().joints;
const W = { claws: CONST.DEMON_CLAW_WINDUP, blade: CONST.DEMON_SCIMITAR_WINDUP, tail: CONST.DEMON_TAIL_WINDUP, swoop: CONST.DEMON_SWOOP_WINDUP, cast: CONST.DEMON_CAST_WINDUP, breath: CONST.DEMON_BREATH_WINDUP };

describe('demonPose: the rows', () => {
  it('counts lengths in the builder\'s units', () => {
    // the pose's lengths stay in the old skeleton's units (31.7 to the head's top): px per pose unit is the unit's times the skin's
    expect(P.px).toBeCloseTo(1 / (DEMON.unit * SKEL.perPose), 12);
    expect(P.lift).toBeCloseTo(17 * P.px, 12);
  });

  it('standing: it breathes, shifts its weight from foot to foot and works its jaw, slowly; the tail is never still', () => {
    const m = newDemonMem(), tip = (TAIL_N - 1) * 2;
    let cl = 9, ch = -9, rl = 9, rh = -9, tl = 9, th = -9, jaw = 0, fast = 0, last = 0;
    stand(m, 14, {}, (t) => {
      const j = m.pose.joints, c = j[J.chest + LEAN];
      if (t > 0) fast = Math.max(fast, Math.abs(c - last) * FPS);
      last = c; cl = Math.min(cl, c); ch = Math.max(ch, c); rl = Math.min(rl, j[J.hips + ROLL]); rh = Math.max(rh, j[J.hips + ROLL]);
      tl = Math.min(tl, m.pose.tailJ[tip]); th = Math.max(th, m.pose.tailJ[tip]); jaw = Math.max(jaw, j[J.jaw]);
    });
    expect(ch - cl).toBeCloseTo(2 * P.stand.chest, 3);   // the spike's breath
    expect(fast).toBeLessThan(0.05);
    expect(rh - rl).toBeCloseTo(2 * P.stand.shift[0], 2);
    expect(th - tl).toBeGreaterThan(0.02);
    expect(jaw).toBeGreaterThan(0.08);
    expect(m.pose.lift).toBe(0);
    expect(m.pose.fly).toBe(0);
    // the feet stay where they stand
    expect(m.pose.joints[J.footR + FOOT.y]).toBe(0);
  });

  it('standing, the wings are fully folded and now and then open a little (never below fold 0.7) and close again', () => {
    const m = newDemonMem();
    let low = 9, shut = 0, n = 0, stretches = 0, open = false;
    stand(m, 30, {}, () => {
      const f = m.pose.wingR.arm.fold;
      low = Math.min(low, f, m.pose.wingL.tips.fold); n++;
      if (f > 0.995) shut++;
      if (!open && f < 0.9) { open = true; stretches++; } else if (open && f > 0.99) open = false;
      expect(m.pose.wingR.tips.fold).toBeLessThan(1.02);
      expect(m.pose.fold).toBeCloseTo((m.pose.wingR.hand.fold + m.pose.wingL.hand.fold) / 2, 6);
    });
    expect(low).toBeGreaterThan(0.7);
    expect(low).toBeLessThan(0.8);
    expect(stretches).toBeGreaterThanOrEqual(3);
    expect(shut / n).toBeGreaterThan(0.75);
    expect(open).toBe(false);
    expect(WING.rest.fold).toBe(1);
  });

  it('claws: always the left hand now; a cast points with the left', () => {
    const m = newDemonMem(), j = m.pose.joints;
    for (let round = 0; round < 2; round++) {
      play(m, ANIM.Melee, 0, W.claws - 0.06);
      // drawn back and out, the chest wound up to the left; the sword arm does not strike
      expect(j[J.armL + ARM.out]).toBeGreaterThan(0.6);
      expect(j[J.armL + ARM.swing]).toBeLessThan(-0.3);
      expect(j[J.chest + TURN]).toBeLessThan(-0.2);
      expect(Math.abs(j[J.armR + ARM.out])).toBeLessThan(0.05);
      expect(m.wl.fold).toBeLessThan(WING.rest.fold - 0.08);
      play(m, ANIM.Melee, W.claws - 0.06 + 1 / FPS, W.claws + P.claws.strike / 2);
      expect(j[J.armL + ARM.swing]).toBeGreaterThan(0.8);
      expect(j[J.armL + ARM.curl]).toBeLessThan(-0.3);
      expect(Math.abs(j[J.armR + ARM.swing])).toBeLessThan(0.4);
      play(m, ANIM.Melee, W.claws + P.claws.strike / 2, W.claws + CONST.DEMON_CLAW_RECOVER);
      stand(m, 1);
      expect(j[J.armL + ARM.swing]).toBeCloseTo(0, 1);
    }
    for (let round = 0; round < 2; round++) {
      play(m, ANIM.Cast, 0, W.cast);
      expect(m.pose.caster).toBe(-1);
      expect(j[J.armL + ARM.swing]).toBeGreaterThan(0.9);
      expect(j[J.armR + ARM.swing]).toBeCloseTo(0, 1);
      stand(m, 0.6);
    }
  });

  it('claws throw the weight: the hips go back before they go forward, and the trunk swings past its rest', () => {
    const m = newDemonMem();
    let back = 0, backAt = 0, fwd = 0, fwdAt = 0;
    play(m, ANIM.Melee, 0, W.claws + CONST.DEMON_CLAW_RECOVER, {}, (t) => {
      const x = m.pose.joints[J.hipsX];
      if (x < back) { back = x; backAt = t; }
      if (x > fwd) { fwd = x; fwdAt = t; }
    });
    expect(back).toBeLessThan(-1.5);
    expect(fwd).toBeGreaterThan(2);
    expect(backAt).toBeLessThan(W.claws);
    expect(fwdAt).toBeGreaterThan(W.claws);
    const n = newDemonMem();
    play(n, ANIM.Melee, 0, W.claws + P.claws.strike);
    expect(n.pose.joints[J.chest + TURN] + n.pose.joints[J.hips + TURN]).toBeGreaterThan(0.4);   // wound up to the left (-), swung past to the right
  });

  it('scimitar: the right arm is drawn back within the wind-up and thrown across at its end; the left arm does not strike', () => {
    const m = newDemonMem(), j = m.pose.joints, S = P.scimitar;
    let fast = 0, fastAt = 0, last = 0;
    play(m, ANIM.Cleave, 0, W.blade - 0.1, {}, () => { expect(j[J.armR + ARM.swing]).toBeLessThan(0.01); });
    // the spike's WIND on the sword arm: back, out, the elbow bent; the chest turned after it
    expect(j[J.armR + ARM.swing]).toBeCloseTo(S.back.arm[0], 1);
    expect(j[J.armR + ARM.out]).toBeCloseTo(S.back.arm[1], 1);
    expect(j[J.armR + ARM.elbow]).toBeCloseTo(S.back.arm[2], 1);
    expect(j[J.chest + TURN]).toBeGreaterThan(0.35);
    expect(Math.abs(j[J.armL + ARM.swing])).toBeLessThan(0.02);
    expect(m.pose.gaze[2]).toBeGreaterThan(0.9);   // the eyes narrowed
    last = j[J.armR + ARM.swing];
    play(m, ANIM.Cleave, W.blade - 0.1 + 1 / FPS, W.blade + 0.25, {}, (t) => { const v = j[J.armR + ARM.swing] - last; last = j[J.armR + ARM.swing]; if (v > fast) { fast = v; fastAt = t; } });
    // thrown across (the spike's STRIKE) and held; the arm is fastest as the server's blow lands
    expect(Math.abs(fastAt - W.blade)).toBeLessThan(S.strike / 2 + 1 / FPS);
    expect(j[J.armR + ARM.swing]).toBeCloseTo(S.across.arm[0], 1);
    expect(j[J.armR + ARM.out]).toBeCloseTo(S.across.arm[1], 1);
    expect(j[J.chest + TURN]).toBeLessThan(-0.4);
    // the left arm only goes back with the turn; its hand stays the loose claw; the sword hand is not told to open
    expect(j[J.armL + ARM.swing]).toBeCloseTo(S.across.other[0], 1);
    expect(j[J.armL + ARM.curl]).toBe(0);
    expect(j[J.armR + ARM.curl]).toBe(0);
    expect(m.pose.rune).toBeGreaterThan(0.9);
    play(m, ANIM.Cleave, W.blade + 0.25, W.blade + CONST.DEMON_SCIMITAR_RECOVER);
    stand(m, 1.5);
    expect(j[J.armR + ARM.swing]).toBeCloseTo(0, 1);
    expect(j[J.chest + TURN]).toBeCloseTo(0, 1);
    expect(m.pose.gaze[2]).toBeLessThan(0.05);
  });

  it('first seen in the middle of a scimitar blow it shows that moment\'s pose, without a fade', () => {
    const t = W.blade + 0.03, seen = newDemonMem(), played = newDemonMem();
    const p = demonPose(inp({ anim: ANIM.Cleave, animT: t }), 1 / FPS, seen);
    expect(p.joints[J.armR + ARM.swing]).toBeGreaterThan(0.5);
    expect(seen.fromT).toBe(99);
    for (let k = 0; k < JOINTS; k++) expect(seen.base[k]).toBe(seen.target.joints[k]);
    // the wings and the tail are on their targets too, and the paint's levels are the moment's
    expect(p.wingR.tips.raise).toBe(seen.wr.raise);
    expect(p.rune).toBe(1);
    expect(p.gaze[2]).toBe(1);
    // it is the pose a demon watched from the blow's start shows (the breath and the head's wandering run on their own clock)
    play(played, ANIM.Cleave, 0, t);
    for (const k of [J.armR + ARM.swing, J.armR + ARM.out, J.armR + ARM.elbow, J.hips + TURN, J.chest + TURN, J.hipsX]) expect(Math.abs(p.joints[k] - played.pose.joints[k])).toBeLessThan(k === J.hipsX ? 0.3 : 0.02);
  });

  it('a lost snapshot at the blow: the estimate still releases the strike (the lich\'s rule)', () => {
    const m = newDemonMem(), j = m.pose.joints, seen = W.blade - 4 * CONST.DT;
    play(m, ANIM.Cleave, 0, seen);
    expect(j[J.armR + ARM.swing]).toBeLessThan(0);
    // no new animT for eight frames: the row's clock runs on by the client's
    for (let i = 0; i < 8; i++) demonPose(inp({ anim: ANIM.Cleave, animT: seen }), 1 / FPS, m);
    expect(m.seen).toBeCloseTo(8 / FPS, 6);
    expect(j[J.armR + ARM.swing]).toBeGreaterThan(1.2);
    // the snapshots are back: their clock again, and no step in the arm
    const was = j[J.armR + ARM.swing];
    demonPose(inp({ anim: ANIM.Cleave, animT: seen + 9 / FPS }), 1 / FPS, m);
    expect(m.seen).toBe(0);
    expect(Math.abs(j[J.armR + ARM.swing] - was)).toBeLessThan(0.1);
    // it does not run on for ever: a wind-up whose snapshots stop holds after `seen`
    const n = newDemonMem(), fresh = newDemonMem();
    play(n, ANIM.Cleave, 0, 0.2);
    for (let i = 0; i < 90; i++) demonPose(inp({ anim: ANIM.Cleave, animT: 0.2 }), 1 / FPS, n);
    expect(n.seen).toBe(P.seen);
    expect(n.pose.joints[J.armR + ARM.swing]).toBeCloseTo(demonPose(inp({ anim: ANIM.Cleave, animT: 0.2 + P.seen }), 1 / FPS, fresh).joints[J.armR + ARM.swing], 5);
    expect(n.pose.joints[J.armR + ARM.swing]).toBeLessThan(0);
  });

  it('tail: it coils to one side with the hips turned against it, whips round to the other, the tip after the root; the wings lift out of its way', () => {
    const m = newDemonMem(), tip = (TAIL_N - 1) * 2;
    play(m, ANIM.Tail, 0, W.tail - 0.07);
    expect(m.pose.tail[0]).toBeGreaterThan(0.5);
    expect(m.pose.tailJ[0]).toBeGreaterThan(0.4);   // the root's own joint carries the coil
    expect(m.pose.joints[J.hips + TURN]).toBeLessThan(-0.1);
    expect(m.wr.raise).toBeGreaterThan(WING.rest.raise + 0.3);
    expect(m.pose.joints[J.footR + FOOT.z] - m.pose.joints[J.footL + FOOT.z]).toBeGreaterThan(REST[J.footR + FOOT.z] * 2 + 2);
    let rootAt = 0, tipAt = 0, root = 9, far = 9;
    play(m, ANIM.Tail, W.tail - 0.07 + 1 / FPS, W.tail + CONST.DEMON_TAIL_RECOVER, {}, (t) => {
      if (m.pose.tail[0] < root) { root = m.pose.tail[0]; rootAt = t; }
      if (m.pose.tail[tip] < far) { far = m.pose.tail[tip]; tipAt = t; }
    });
    expect(root).toBeLessThan(-1);
    expect(far).toBeLessThan(-0.6);
    expect(tipAt).toBeGreaterThan(rootAt + 0.05);
    stand(m, 1.5);
    expect(Math.abs(m.pose.tail[0])).toBeLessThan(0.3);
  });

  it('swoop: a crouch with the wings opening, the glide with the wings wide and still and the legs trailing, the brake into deep knees', () => {
    const m = newDemonMem(), j = m.pose.joints, E = W.swoop + CONST.DEMON_SWOOP_TIME;
    play(m, ANIM.Dash, 0, W.swoop - 0.1);
    expect(j[J.hipsY]).toBeLessThan(-3);
    expect(m.wr.fold).toBeLessThan(0.12);
    expect(m.wr.raise).toBeGreaterThan(0.4);
    play(m, ANIM.Dash, W.swoop - 0.1, W.swoop + 0.3);
    expect(m.wr.fold).toBe(0);
    expect(m.wl.fold).toBe(0);
    const raise = m.wr.raise;
    expect(j[J.hips + LEAN]).toBeGreaterThan(0.6);
    expect(j[J.footR + FOOT.y]).toBeGreaterThan(2);
    expect(j[J.footR + FOOT.x]).toBeLessThan(REST[J.footR + FOOT.x] - 5);
    expect(j[J.armR + ARM.swing]).toBeGreaterThan(1.2);
    play(m, ANIM.Dash, W.swoop + 0.3, W.swoop + 0.4);
    expect(m.wr.raise).toBe(raise);
    play(m, ANIM.Dash, W.swoop + 0.4, E + CONST.DEMON_SWOOP_RECOVER);
    expect(m.wr.raise).toBeGreaterThan(0.8);
    expect(j[J.hipsY]).toBeLessThan(-4);
    expect(j[J.footR + FOOT.y]).toBeCloseTo(0, 1);
    expect(m.pose.lift).toBe(0);
  });

  it('cast: the left arm rises within the wind-up and points down ahead, holds through the release, drops; the hand anchor is the left\'s', () => {
    const m = newDemonMem(), j = m.pose.joints;
    play(m, ANIM.Cast, 0, 0.1);
    expect(j[J.armL + ARM.swing]).toBeLessThan(0.3);
    play(m, ANIM.Cast, 0.1, W.cast);
    expect(m.pose.caster).toBe(-1);
    expect(j[J.armL + ARM.swing]).toBeGreaterThan(0.9);
    expect(j[J.armL + ARM.swing]).toBeLessThan(1.4);   // below the horizontal: at the target's feet
    expect(j[J.armL + ARM.curl]).toBeLessThan(-0.4);
    expect(j[J.armR + ARM.swing]).toBeCloseTo(REST[J.armR + ARM.swing], 1);
    expect(m.wl.fold).toBeLessThan(WING.rest.fold - 0.08);
    play(m, ANIM.Cast, W.cast, W.cast + 0.1);
    expect(j[J.armL + ARM.swing]).toBeGreaterThan(0.9);
    play(m, ANIM.Cast, W.cast + 0.1, W.cast + CONST.DEMON_CAST_RECOVER);
    expect(j[J.armL + ARM.swing]).toBeLessThan(0.75);
  });

  it('breath: the head and the chest go back and the face heats up, then the head is thrust forward with the jaw wide open and trembles; the charge climbs the throat', () => {
    const m = newDemonMem(), j = m.pose.joints, B2 = P.breath;
    play(m, ANIM.Breath, 0, W.breath * 0.3);
    expect(m.pose.charge[1]).toBeGreaterThan(0.5);
    expect(m.pose.charge[0]).toBeLessThan(0.5);
    play(m, ANIM.Breath, W.breath * 0.3, W.breath * 0.9);
    // the spike's INHALE
    expect(j[J.neck + LEAN] + j[J.head + LEAN]).toBeLessThan(-0.25);
    expect(j[J.chest + LEAN]).toBeLessThan(-0.1);
    expect(m.pose.heat).toBeGreaterThan(1.5);
    expect(j[J.jaw]).toBeLessThan(0.4);
    expect(m.pose.charge[0]).toBeGreaterThan(0.8);
    play(m, ANIM.Breath, W.breath * 0.9, W.breath + 0.5);
    // the spike's BREATHE
    expect(j[J.jaw]).toBeGreaterThan(B2.out.jaw / 0.6 - 0.05);
    expect(j[J.neck + LEAN]).toBeGreaterThan(0.05);
    expect(j[J.chest + LEAN]).toBeGreaterThan(0.03);
    expect(m.pose.heat).toBeGreaterThan(1.6);
    expect(m.wr.raise).toBeGreaterThan(0.1);
    expect(m.pose.charge).toEqual([1, 0]);
    expect(m.pose.rune).toBeGreaterThan(0.9);
    let lo = 9, hi = -9;
    play(m, ANIM.Breath, W.breath + 0.5, W.breath + 0.8, {}, () => { lo = Math.min(lo, j[J.head + LEAN]); hi = Math.max(hi, j[J.head + LEAN]); });
    expect(hi - lo).toBeGreaterThan(0.02);
    stand(m, 1);
    expect(j[J.jaw]).toBeLessThan(0.12);
    expect(m.pose.heat).toBeCloseTo(1, 2);
  });
});

describe('demonPose: the flight', () => {
  const full = P.lift;
  /** Takes off and flies for `air` s. */
  function takeOff(m: DemonMem, air: number, each?: (t: number) => void): void {
    play(m, ANIM.TakeOff, 0, CONST.DEMON_TAKEOFF, {}, each ? (t) => each(t - CONST.DEMON_TAKEOFF) : undefined);
    if (air > 0) play(m, ANIM.Idle, 0, air, { flags: AIR }, each);
  }

  it('the take-off crouches first with the wings opening and going up, pushes off slowly, and ends with the first down stroke done', () => {
    const m = newDemonMem();
    play(m, ANIM.TakeOff, 0, 0);
    expect(m.pose.lift).toBe(0);
    play(m, ANIM.TakeOff, 1 / FPS, P.takeoff.gather);
    expect(m.wr.raise).toBeGreaterThan(0.5);   // the wings are up and open before the push
    expect(m.wr.fold).toBeLessThan(0.05);
    expect(m.pose.fly).toBeLessThan(0.02);
    expect(m.pose.lift).toBeLessThan(0.1 * full);
    expect(m.pose.joints[J.hipsY]).toBeLessThan(-3);
    expect(m.pose.joints[J.footR + FOOT.y] + m.pose.lift).toBeCloseTo(0, 5);   // the feet are still on the floor
    play(m, ANIM.TakeOff, P.takeoff.gather, CONST.DEMON_TAKEOFF);
    expect(m.pose.lift).toBeCloseTo(P.liftAtTakeoff * full, 5);
    expect(m.pose.fly).toBeCloseTo(1, 5);
    expect(m.wr.raise).toBeCloseTo(0, 5);   // the beat carries them now
    expect(m.pose.joints[J.footR + FOOT.y] + m.pose.lift).toBeGreaterThan(1);
  });

  it('the take-off ends at the beat\'s phase its down stroke ends at, and the flight\'s phase never jumps', () => {
    const m = newDemonMem();
    play(m, ANIM.TakeOff, 0, CONST.DEMON_TAKEOFF);
    expect(m.beat).toBeCloseTo(WING.down, 6);
    expect(m.pose.beat).toBeCloseTo(WING.down, 6);
    play(m, ANIM.Idle, 0, 0, { flags: AIR });
    expect(Math.abs(m.beat - WING.down)).toBeLessThan(0.02);
    // the page's whole flight: wherever the stance is the flying one at all, the phase only runs on, at most a beat's pace
    const n = newDemonMem();
    let last = 0, worst = 0, back = 0, held = 0;
    for (let i = 0, k = Math.round(actPeriod('fly') * FPS); i <= k; i++) {
      const a = demonAct('fly', i / FPS), p = demonPose(inp({ anim: a.anim, animT: a.animMs / 1000, flags: a.flags }), i === 0 ? 0 : 1 / FPS, n);
      const d = p.beat - last, step = d < -0.5 ? d + 1 : d;
      if (p.fly > 0.02 && i > 0) { worst = Math.max(worst, step); back = Math.min(back, step); }
      if (a.anim === ANIM.Land && p.beat === 0) held++;
      last = p.beat;
    }
    expect(worst).toBeLessThan(1.6 / (FPS * WING.beat));   // the take-off's one hard down stroke is the quickest
    expect(back).toBe(0);
    expect(held).toBeGreaterThan(0);   // landing, the wings stay at the top of their stroke
  });

  it('in the air the wing joints lag the arm: wing2 by 0.7, the finger roots by 1.2, the knuckles by 1.7 of the phase', () => {
    expect(WINGS.beat).toEqual([[0.5, 0], [0.3, 0.7], [0.18, 1.2], [0.25, 1.7]]);
    const m = newDemonMem(), p = demonPose(inp({ flags: AIR }), 1 / FPS, m);
    /** A bone's turn against its parent's: the beat turns it about one fixed axis of that frame. */
    const rel = (bone: string, parent: string, o: number[]): number[] => {
      const a = B[parent] * 16, b = B[bone] * 16;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = bones[a + r * 4] * bones[b + c * 4] + bones[a + r * 4 + 1] * bones[b + c * 4 + 1] + bones[a + r * 4 + 2] * bones[b + c * 4 + 2];
      return o;
    };
    const rows: Array<[string, string, number, number]> = [['wing1L', 'chest', 0.5, 0], ['wing2L', 'wing1L', 0.3, 0.7], ['wf1aL', 'wing2L', 0.18, 1.2], ['wf1bL', 'wf1aL', 0.25, 1.7], ['wf3bR', 'wf3aR', 0.25, 1.7]];
    for (const [bone, parent, size, lag] of rows) {
      p.beat = 0; placeBones(p, bones);
      const top = rel(bone, parent, []), now: number[] = [];
      let most = 0, at = 0;
      for (let i = 0; i < 400; i++) {
        p.beat = i / 400; placeBones(p, bones); rel(bone, parent, now);
        // the angle between this turn and the one at the top of the stroke
        let tr = 0;
        for (let k = 0; k < 9; k++) tr += top[k] * now[k];
        const angle = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
        if (angle > most) { most = angle; at = p.beat; }
      }
      // its own top comes `lag` rad after the arm's; it is furthest from where it was at the arm's top at its own bottom (or, lagging more than a quarter beat, at its own top)
      expect(at, bone).toBeCloseTo((Math.cos(lag) < 0 ? 0 : 0.5) + lag / (2 * Math.PI), 2);
      expect(most, bone).toBeCloseTo(size * (1 + Math.abs(Math.cos(lag))), 2);
    }
  });

  it('the wing arms stay clear of the horns in the air: at least 0.2 units over a whole beat', () => {
    const m = newDemonMem();
    demonPose(inp({ flags: AIR }), 1 / FPS, m);
    const pt = (bone: string, p: P3 = rest(bone)): P3 => onBone(bones, B[bone], p, [0, 0, 0]);
    let gap = 9;
    for (let i = 0; i < Math.round(WING.beat * FPS) + 2; i++) {
      demonPose(inp({ flags: AIR, animT: i / FPS }), 1 / FPS, m);
      placeBones(m.pose, bones);
      for (const side of ['L', 'R']) {
        const segs = [['wing1', 'wing2'], ['wing2', 'wf0a'], ...[0, 1, 2, 3].map((k) => ['wf0a', `wf${k}b`])];
        for (const [a, b] of segs) {
          const A = pt(a + side), Z = pt(b + side), d = [Z[0] - A[0], Z[1] - A[1], Z[2] - A[2]], len = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
          for (const s of [1, -1]) for (const [h] of HORN_PATH.slice(3)) {
            const H = pt('head', [s * h[0], h[1], h[2]]), u = Math.max(0, Math.min(1, ((H[0] - A[0]) * d[0] + (H[1] - A[1]) * d[1] + (H[2] - A[2]) * d[2]) / len));
            gap = Math.min(gap, Math.hypot(A[0] + d[0] * u - H[0], A[1] + d[1] * u - H[1], A[2] + d[2] * u - H[2]));
          }
        }
      }
    }
    expect(gap).toBeGreaterThan(0.2);
    expect(gap).toBeLessThan(0.3);   // the spike measured 0.235
  });

  it('the climb labours: full height within three beats, never falling by more than the bob from frame to frame', () => {
    const m = newDemonMem();
    let last = 0, fall = 0, low = 9, dips = 0, wasUp = true, lastH = 0;
    takeOff(m, 4 * WING.beat, (t) => {
      const h = m.pose.lift + m.pose.joints[J.hipsY];
      fall = Math.max(fall, last - m.pose.lift); last = m.pose.lift;
      // the body sinks between the labouring strokes
      if (t > 0) { const up = h >= lastH; if (wasUp && !up) dips++; wasUp = up; low = Math.min(low, m.pose.lift); }
      lastH = h;
    });
    expect(fall).toBe(0);
    expect(low).toBeGreaterThanOrEqual(P.liftAtTakeoff * full - 1e-6);
    expect(dips).toBeGreaterThanOrEqual(2);
    expect(m.pose.lift).toBeCloseTo(full, 5);
  });

  it('hovering it flies as the spike does: the right leg drawn up and the left trailing, the body rising and sinking with the beat, the skin bellied by it', () => {
    const m = newDemonMem();
    demonPose(inp({ flags: AIR }), 0, m);
    let lo = 9, hi = -9, bl = 9, bh = -9, pl = 9, ph = -9;
    play(m, ANIM.Idle, 0, 2 * WING.beat, { flags: AIR }, () => {
      const j = m.pose.joints;
      lo = Math.min(lo, j[J.hipsY]); hi = Math.max(hi, j[J.hipsY]); bl = Math.min(bl, m.pose.billow); bh = Math.max(bh, m.pose.billow); pl = Math.min(pl, m.pose.beat); ph = Math.max(ph, m.pose.beat);
      expect(j[J.footR + FOOT.y] + m.pose.lift).toBeGreaterThan(4);
      expect(m.pose.fly).toBe(1);
      expect(m.pose.fold).toBe(0);
    });
    // the spike's bob (0.14 units crest to trough) and the breath on top
    expect(hi - lo).toBeGreaterThan(P.bob * 0.95);
    expect(hi - lo).toBeLessThan(P.bob + 2 * P.stand.hips + 0.01);
    expect(P.bob * SKEL.perPose).toBeCloseTo(0.14, 9);
    expect([bl, bh].map((v) => Math.round(v * 10) / 10)).toEqual([-1, 1]);
    expect(ph - pl).toBeGreaterThan(0.95);
    expect(m.pose.joints[J.footR + FOOT.x]).toBeGreaterThan(m.pose.joints[J.footL + FOOT.x] + 3);
    expect(m.pose.lift).toBe(full);
  });

  it('the landing: full at its start, on the floor at its end with both feet level; then the knees give deep and settle twice', () => {
    const m = newDemonMem();
    demonPose(inp({ flags: AIR }), 0, m);
    play(m, ANIM.Idle, 0, 1, { flags: AIR });
    play(m, ANIM.Land, 0, 0, { flags: AIR });
    expect(m.pose.lift).toBeCloseTo(full, 5);
    let last = full, speed = 0, faster = true;
    play(m, ANIM.Land, 1 / FPS, CONST.DEMON_LAND, { flags: AIR }, (t) => {
      const v = last - m.pose.lift;
      if (t > 0.2 && v < speed - 1e-6) faster = false;
      speed = v; last = m.pose.lift;
      // the wings lie broad against the fall: open and up, the stance on its way back to standing
      if (Math.abs(t - 0.3) < 0.5 / FPS) { expect(m.pose.wingR.arm.fold).toBeLessThan(0.05); expect(m.pose.wingR.arm.raise).toBeGreaterThan(0.2); expect(m.pose.fly).toBeGreaterThan(0.5); expect(m.pose.fly).toBeLessThan(1); }
    });
    expect(faster).toBe(true);
    expect(m.pose.lift).toBeCloseTo(0, 5);
    expect(m.pose.fly).toBeCloseTo(0, 5);
    expect(m.pose.joints[J.footR + FOOT.y]).toBeCloseTo(0, 3);
    expect(m.pose.joints[J.footL + FOOT.y]).toBeCloseTo(0, 3);
    // the hips: down deep, up, down again a little, then still
    const ys: number[] = [];
    stand(m, 2.2, {}, () => ys.push(at(m, 'hips')[1] - 1.16 / SKEL.perPose));
    const turns: number[] = [];
    for (let i = 2; i < ys.length; i++) if ((ys[i - 1] - ys[i - 2]) * (ys[i] - ys[i - 1]) < 0 && Math.abs(ys[i - 1]) > 0.5) turns.push(ys[i - 1]);
    expect(turns.length).toBe(2);
    expect(turns[0]).toBeLessThan(-5);
    expect(turns[1]).toBeLessThan(-0.8);
    expect(turns[1]).toBeGreaterThan(turns[0] / 2);
    expect(Math.abs(ys[ys.length - 1])).toBeLessThan(0.4);
    expect(m.pose.wingR.arm.fold).toBeCloseTo(WING.rest.fold, 1);
  });

  it('a landing that goes back up (over a hole): the lift rises again without a jump', () => {
    const m = newDemonMem();
    demonPose(inp({ flags: AIR }), 0, m);
    play(m, ANIM.Idle, 0, 1, { flags: AIR });
    play(m, ANIM.Land, 0, 0.3, { flags: AIR });
    const low = m.pose.lift;
    expect(low).toBeLessThan(full * 0.9);
    let last = low, drop = 0;
    play(m, ANIM.Idle, 0, 1, { flags: AIR }, () => { drop = Math.max(drop, last - m.pose.lift); last = m.pose.lift; });
    expect(drop).toBeLessThan(1);
    expect(m.pose.lift).toBeCloseTo(full, 5);
  });

  it('first seen in the air it hangs at full height at once, in the flying stance', () => {
    const m = newDemonMem(), p = demonPose(inp({ flags: AIR }), 1 / FPS, m);
    expect(p.lift).toBe(full);
    expect(p.fly).toBe(1);
    expect(p.wingR.arm.fold).toBe(0);
    // the legs hang as the flying stance has them, but for their swing with the beat
    for (let i = 0; i < 2; i++) expect(Math.abs(p.joints[(i === 0 ? J.footR : J.footL) + FOOT.x] - REST[J.footR + FOOT.x] - FLY_FEET[i][0])).toBeLessThan(1);
    // and first seen in mid Swoop it glides
    const n = newDemonMem(), q = demonPose(inp({ anim: ANIM.Dash, animT: W.swoop + 0.3 }), 1 / FPS, n);
    expect(q.joints[J.hips + LEAN]).toBeGreaterThan(0.6);
    expect(q.wingR.arm.fold).toBe(0);
  });

  it('in the air a cast and a breath lay their arm, head and jaw over the flying stance: the wings keep beating', () => {
    const m = newDemonMem();
    demonPose(inp({ flags: AIR }), 0, m);
    let lo = 9, hi = -9;
    play(m, ANIM.Breath, 0, W.breath + 1, { flags: AIR }, () => { lo = Math.min(lo, m.pose.beat); hi = Math.max(hi, m.pose.beat); expect(m.pose.fly).toBe(1); });
    expect(hi - lo).toBeGreaterThan(0.95);
    expect(m.pose.joints[J.jaw]).toBeGreaterThan(0.8);
    expect(m.pose.lift).toBe(full);
    play(m, ANIM.Cast, 0, W.cast, { flags: AIR });
    expect(m.pose.joints[J.armL + ARM.swing]).toBeGreaterThan(0.6);
    expect(m.pose.joints[J.jaw]).toBeLessThan(0.2);
  });

  it('the whole of every act at 60 fps and at 30 fps: no joint snaps', () => {
    // a snap is the same step whatever the frame rate; a motion's step halves with the frame's length
    for (const act of DEMON_ACTS) {
      const steps = [60, 30].map((fps) => {
        const m = newDemonMem(), prev = new Float32Array(JOINTS), tail = new Float32Array(TAIL_N * 2);
        let angle = 0, place = 0, fly = 0, lift = 0, tj = 0, lastFly = 0, lastLift = 0, top = 0;
        for (let i = 0, n = Math.round(2 * actPeriod(act) * fps); i <= n; i++) {
          const t = i / fps, a = demonAct(act, t), d = demonDev(act, t);
          const p = demonPose(inp({ anim: a.anim, animT: a.animMs / 1000, flags: a.flags, aim: 0.5 + d.turn, x: 3 + (Math.cos(0.5) * d.along) / CONST.TILE, z: 4 + (Math.sin(0.5) * d.along) / CONST.TILE }), i === 0 ? 0 : 1 / fps, m);
          if (i > 0) {
            for (let k = 0; k < JOINTS; k++) {
              const step = Math.abs(p.joints[k] - prev[k]);
              expect(Number.isFinite(p.joints[k])).toBe(true);
              if (k < 3 || (k >= J.footR && k < J.shrug && (k - J.footR) % 4 < 3)) place = Math.max(place, step); else angle = Math.max(angle, step);
            }
            for (let k = 0; k < tail.length; k++) tj = Math.max(tj, Math.abs(p.tailJ[k] - tail[k]));
            fly = Math.max(fly, Math.abs(p.fly - lastFly)); lift = Math.max(lift, Math.abs(p.lift - lastLift));
          }
          prev.set(p.joints); tail.set(p.tailJ); lastFly = p.fly; lastLift = p.lift; top = Math.max(top, p.lift);
        }
        return { angle, place, fly, lift, tj, top };
      });
      const [a, b] = steps;
      for (const k of ['angle', 'place', 'fly', 'lift', 'tj'] as const) expect(a[k], `${act} ${k}`).toBeLessThan(0.65 * b[k] + 1e-3);
      // rad and units a second: the scimitar's and the claw's strike are the fastest joints, the feet thrown ahead to brake the fastest places
      expect(a.angle * 60, act).toBeLessThan(36);
      expect(a.place * 60, act).toBeLessThan(130);
      expect(a.fly * 60, act).toBeLessThan(11);
      expect(a.lift * 60, act).toBeLessThan(48);
      // the flight: the jaw thrown open for the breath is its fastest joint (0.6 rad to a unit)
      if (act === 'fly') { expect(a.angle * 60).toBeLessThan(11); expect(a.place * 60).toBeLessThan(80); expect(a.top).toBeCloseTo(P.lift, 5); }
    }
    expect(FLY_ACT.down).toBeLessThan(actPeriod('fly'));
  });
});

describe('demonPose: the memory', () => {
  it('frozen and petrified hold everything, on the ground and in the air', () => {
    for (const flags of [0, AIR]) for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) {
      const m = newDemonMem();
      demonPose(inp({ flags }), 0, m);
      play(m, ANIM.Idle, 0, 0.7, { flags });
      const before = JSON.stringify([m.pose, m.t, m.face, m.beat, m.walk]);
      for (let i = 0; i < 60; i++) demonPose(inp({ flags, effects: 1 << fx, aim: 1, x: 4 }), 1 / FPS, m);
      expect(JSON.stringify([m.pose, m.t, m.face, m.beat, m.walk])).toBe(before);
    }
  });

  it('frozen and petrified hold the tail, the chain, the heart and the fingers too', () => {
    for (const fx of [EFFECT.Frozen, EFFECT.Petrified]) {
      const mem = DEMON_FIGURE.newMem() as { mem: DemonMem }, pose = mem.mem.pose;
      const draw = (o: Partial<BuiltIn>): Float32Array => DEMON_FIGURE.draw(inp(o), 1 / FPS, mem).bones!;
      // a cast swings the wrist, and the chain behind it
      for (let i = 0; i < 40; i++) draw({ anim: ANIM.Cast, animT: i / FPS });
      expect(Math.max(...Array.from(pose.chain).map(Math.abs))).toBeGreaterThan(0.01);
      expect(pose.heart).toBeGreaterThan(0.4);
      const tail = Array.from(pose.tailJ), chain = Array.from(pose.chain), heart = pose.heart, clock = pose.clock, placed = Array.from(draw({ anim: ANIM.Cast, animT: 40 / FPS }));
      const held = { tail: Array.from(pose.tailJ), chain: Array.from(pose.chain), heart: pose.heart, clock: pose.clock };
      expect(held.tail).not.toEqual(tail);
      expect(held.chain).not.toEqual(chain);
      expect(held.heart).toBeGreaterThan(heart);
      expect(held.clock).toBeGreaterThan(clock);
      for (let i = 0; i < 60; i++) {
        // every bone stays where it was: the fingers and the wing fingers run on the figure's clock, which stands
        expect(Array.from(draw({ anim: ANIM.Cast, animT: (41 + i) / FPS, effects: 1 << fx }))).toEqual(placed);
        expect({ tail: Array.from(pose.tailJ), chain: Array.from(pose.chain), heart: pose.heart, clock: pose.clock }).toEqual(held);
        expect(pose.gaze[2]).toBe(0);
      }
      // thawed, all of it goes on
      const after = Array.from(draw({}));
      expect(pose.clock).toBeGreaterThan(held.clock);
      expect(pose.heart).toBeGreaterThan(held.heart);
      for (const n of ['f1cL', 'tail9', 'wf2bL']) expect(after.slice(B[n] * 16, B[n] * 16 + 16)).not.toEqual(placed.slice(B[n] * 16, B[n] * 16 + 16));
    }
  });

  it('frozen mid-turn: the thaw starts the facing\'s spring from rest, not at the speed it had', () => {
    const m = newDemonMem();
    stand(m, 0.3);
    for (let i = 0; i < 20; i++) demonPose(inp({ aim: 2 }), 1 / FPS, m);
    expect(Math.abs(m.faceV)).toBeGreaterThan(0.5);
    const fx = 1 << EFFECT.Frozen;
    for (let i = 0; i < 30; i++) demonPose(inp({ effects: fx, aim: 2 }), 1 / FPS, m);
    const err = Math.abs(2 - m.face);
    demonPose(inp({ aim: 2 }), 1 / FPS, m);
    expect(Math.abs(m.faceV)).toBeLessThan(P.faceRate * P.faceRate * err / FPS * 1.1);
  });

  it('thawed after the aim moved by 2 rad: the turn starts from standing; no wing target and no tail root jumps', () => {
    const m = newDemonMem();
    stand(m, 0.5);
    for (let i = 0; i < 60; i++) demonPose(inp({ effects: 1 << EFFECT.Frozen, aim: (2 * i) / 59 }), 1 / FPS, m);
    let sweep = m.wr.sweep, root = m.pose.tail[0], worstSweep = 0, worstRoot = 0, most = 0;
    for (let i = 0; i < 120; i++) {
      demonPose(inp({ aim: 2 }), 1 / FPS, m);
      worstSweep = Math.max(worstSweep, Math.abs(m.wr.sweep - sweep)); worstRoot = Math.max(worstRoot, Math.abs(m.pose.tail[0] - root));
      sweep = m.wr.sweep; root = m.pose.tail[0]; most = Math.max(most, Math.abs(m.wr.sweep - WING.rest.sweep));
      expect(Math.abs(m.faceV)).toBeLessThan(P.faceRate * 2 * 0.4);
    }
    expect(worstSweep).toBeLessThan(0.08);   // the turn gathers speed; the first frame after the thaw reads no speed at all
    expect(worstRoot).toBeLessThan(0.07);    // the ten links' root follows quicker than the six's did
    expect(most).toBeLessThan(P.turnMax * WING.turn.sweep + 0.1);
    // the same for an aim the server snaps on a first-seen demon: the first frame has no turn at all
    const n = newDemonMem();
    demonPose(inp({ aim: 3 }), 1 / FPS, n);
    expect(n.faceV).toBe(0);
    expect(n.pose.wingR.arm.sweep).toBeCloseTo(n.wr.sweep, 6);
  });

  it('a new anim starts from the pose shown last and is on its target after the ease', () => {
    const m = newDemonMem();
    play(m, ANIM.Dash, 0, 0.25);
    const shown = Float32Array.from(m.base);
    expect(Math.abs(shown[J.hipsY])).toBeGreaterThan(1);
    // the wind-up is broken off
    demonPose(inp(), 1 / FPS, m);
    expect(m.easeFor).toBe(P.easeFrom[ANIM.Dash]);
    for (let k = 0; k < JOINTS; k++) expect(Math.abs(m.base[k] - shown[k])).toBeLessThan(0.02);
    stand(m, m.easeFor);
    for (let k = 0; k < JOINTS; k++) expect(m.base[k]).toBeCloseTo(m.target.joints[k], 5);
    // an anim with no ease of its own takes the plain one
    play(m, ANIM.TakeOff, 0, 0.1);
    play(m, ANIM.Idle, 0, 0);
    stand(m, 0.1);
    expect(m.easeFor).toBe(P.easeFrom[ANIM.TakeOff]);
    const o = newDemonMem();
    stand(o, 0.1);
    play(o, ANIM.Melee, 0, 0);
    expect(o.easeFor).toBe(P.ease);
    // off the floor without a take-off: caught slowly, the stance going over with the joints
    const a = newDemonMem();
    stand(a, 0.1);
    demonPose(inp({ flags: AIR }), 1 / FPS, a);
    expect(a.easeFor).toBe(P.easeAir);
    expect(a.pose.fly).toBeLessThan(0.05);
    play(a, ANIM.Idle, 0, P.easeAir, { flags: AIR });
    expect(a.pose.fly).toBe(1);
  });

  it('a long frame snaps to the target: no NaN, no fade, the chains on their targets', () => {
    const m = newDemonMem(), tip = (TAIL_N - 1) * 2;
    stand(m, 0.3);
    const p = demonPose(inp({ anim: ANIM.Dash, animT: W.swoop + 0.3, aim: 2, x: 9 }), 5, m);
    for (let k = 0; k < JOINTS; k++) { expect(Number.isFinite(p.joints[k])).toBe(true); expect(m.base[k]).toBe(m.target.joints[k]); }
    expect(m.face).toBeCloseTo(2, 9);
    expect(m.faceV).toBe(0);
    expect(p.wingR.arm.fold).toBe(m.wr.fold);
    expect(p.wingR.tips.raise).toBe(m.wr.raise);
    expect(p.tail[tip]).toBe(p.tail[0]);
    for (const v of [...p.tail, ...p.tailJ]) expect(Number.isFinite(v)).toBe(true);
    const q = demonPose(inp({ flags: AIR }), 5, m);
    expect(q.lift).toBe(P.lift);
    expect(q.fly).toBe(1);
  });
});

describe('demonPose: the head, the facing and the flinch', () => {
  /** The trunk's and the head's turn, without the head's own small wandering. */
  const turns = (m: DemonMem): number => m.pose.joints[J.chest + TURN] + m.pose.joints[J.neck + TURN] + m.pose.joints[J.head + TURN] + P.stand.head[0] * Math.sin(m.t * P.stand.head[1]);

  it('the head follows the look, eased; the body does not turn for it; the eyes go ahead of the head', () => {
    const m = newDemonMem();
    stand(m, 0.2);
    demonPose(inp({ look: 1 }), 1 / FPS, m);
    expect(turns(m)).toBeLessThan(0.02);   // eased into the turn
    expect(m.pose.gaze[0]).toBe(-1);       // the hero stands to its right: the eyes are there at once
    stand(m, 1.5, { look: 1 });
    expect(turns(m)).toBeCloseTo(1, 1);
    expect(Math.abs(turns(m) - 1)).toBeLessThan(0.02);
    expect(Math.abs(m.pose.gaze[0])).toBeLessThan(0.03);   // the head is on him: the eyes look straight
    expect(m.pose.gaze[1]).toBe(P.life.down[0]);
    expect(m.face).toBe(0);
    expect(m.pose.joints[J.neck + TURN]).toBeCloseTo(0.35, 1);
    stand(m, 2, { look: 3 });
    expect(Math.abs(turns(m) - P.neck)).toBeLessThan(0.02);
    expect(m.pose.gaze[0]).toBe(-1);       // further round than the neck goes
    stand(m, 2, { look: null });
    expect(Math.abs(turns(m))).toBeLessThan(0.02);
    expect(m.pose.gaze[0]).toBe(0);
    // a look where the body already faces turns nothing
    const n = newDemonMem();
    stand(n, 2, { aim: 1, look: 1 });
    expect(Math.abs(turns(n))).toBeLessThan(1e-6);
  });

  it('a sudden new aim: the facing starts slowly, never passes the aim, and the turn is stepped round', () => {
    const m = newDemonMem();
    stand(m, 0.3);
    const walk = m.walk;
    demonPose(inp({ aim: Math.PI / 2 }), 1 / FPS, m);
    expect(m.face).toBeLessThan(0.01 * Math.PI / 2);   // an ease without a spring would have gone 6 % of the way
    let most = 0, lifted = 0;
    stand(m, 3, { aim: Math.PI / 2 }, () => { most = Math.max(most, m.face); lifted = Math.max(lifted, m.pose.joints[J.footR + FOOT.y], m.pose.joints[J.footL + FOOT.y]); });
    expect(most).toBeLessThanOrEqual(Math.PI / 2);
    expect(m.face).toBeCloseTo(Math.PI / 2, 2);
    expect(m.walk - walk).toBeCloseTo(0.5, 1);   // a quarter turn is one footfall
    expect(lifted).toBeGreaterThan(1);
    expect(m.pose.joints[J.footR + FOOT.y]).toBeCloseTo(0, 1);
  });

  it('the flinch goes the way the blow travelled: the head clearly, the chest hardly; none without a direction', () => {
    const push = (hurtDir: number | null | undefined): { head: number[]; chest: number[]; fold: number } => {
      // against a demon that is not hit (it breathes and shifts its weight meanwhile)
      const m = newDemonMem(), calm = newDemonMem();
      stand(m, 0.2); stand(calm, 0.2);
      let best = [0, 0, 0], chest = [0, 0, 0], far = 0, fold = 9;
      for (let i = 0; i < 20; i++) {
        demonPose(inp({ flags: i < 6 ? FLAG.HURT : 0, hurtDir }), 1 / FPS, m); demonPose(inp(), 1 / FPS, calm);
        const h0 = head(calm), c0 = at(calm, 'upperArmR');
        const h = head(m), c = at(m, 'upperArmR'), d = Math.hypot(h[0] - h0[0], h[2] - h0[2]);
        if (d > far) { far = d; best = [h[0] - h0[0], h[1] - h0[1], h[2] - h0[2]]; chest = [c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]]; }
        fold = Math.min(fold, m.wr.fold);
      }
      return { head: best, chest, fold };
    };
    const behind = push(0), left = push(Math.PI / 2), none = push(null), plain = push(undefined);
    expect(behind.head[0]).toBeGreaterThan(0.9);
    expect(behind.head[0]).toBeLessThan(1.4);
    expect(Math.abs(behind.head[2])).toBeLessThan(0.1);
    expect(left.head[2]).toBeGreaterThan(0.9);
    expect(Math.hypot(behind.chest[0], behind.chest[2])).toBeLessThan(Math.hypot(behind.head[0], behind.head[2]) / 2);
    expect(Math.hypot(behind.chest[0], behind.chest[2])).toBeGreaterThan(0.2);
    expect(behind.fold).toBeLessThan(WING.rest.fold - 0.05);
    expect(Math.hypot(none.head[0], none.head[2])).toBeLessThan(0.02);
    expect(plain.head[0]).toBeLessThan(-0.9);   // not told: from the front
    // over after its time
    const m = newDemonMem();
    stand(m, 0.2);
    demonPose(inp({ flags: FLAG.HURT, hurtDir: 0 }), 1 / FPS, m);
    stand(m, P.hurt + 0.05);
    expect(m.hurtT).toBe(-1);
  });
});

describe('demonPose: the walk', () => {
  /** Walks along +x at `speed` px/s for `secs`. */
  function walk(m: DemonMem, secs: number, fps: number, speed = DEMON_SPEED, each?: (t: number) => void): void {
    if (!m.started) demonPose(inp({ x: 0 }), 0, m);
    const x0 = m.lastX;
    for (let i = 1, n = Math.round(secs * fps); i <= n; i++) { demonPose(inp({ anim: ANIM.Move, animT: i / fps, x: x0 + (speed * i) / fps / CONST.TILE }), 1 / fps, m); each?.(i / fps); }
  }

  it('the phase moves with the way travelled, the same at 60 and at 30 fps', () => {
    const a = newDemonMem(), b = newDemonMem();
    walk(a, 0.6, 60); walk(b, 0.6, 30);
    expect(a.walk).toBeCloseTo((30 * P.px) / (2 * P.stride), 6);
    expect(b.walk).toBeCloseTo(a.walk, 6);
    // standing still it does not move
    const was = a.walk;
    demonPose(inp({ x: a.lastX }), 1 / FPS, a);
    expect(a.walk).toBe(was);
  });

  it('steps are slow and long: at most 1.5 footfalls a second at the server\'s speed, and the foot on the floor does not slide', () => {
    const m = newDemonMem();
    walk(m, 2, FPS);
    const w0 = m.walk;
    let slid = 0, lastX = NaN, lastWorld = NaN;
    walk(m, 2, FPS, DEMON_SPEED, () => {
      // the right foot while it stands, in the middle of its stance (clear of the roll onto the toes): its place on the floor
      const u = m.walk - Math.floor(m.walk), world = m.lastX * CONST.TILE * P.px + m.pose.joints[J.footR + FOOT.x];
      if (u > 0.05 && u < 0.3 && lastX === lastX) slid = Math.max(slid, Math.abs(world - lastWorld));
      lastX = u > 0.04 && u < 0.3 ? u : NaN; lastWorld = world;
    });
    expect((m.walk - w0) * 2 / 2).toBeLessThanOrEqual(1.5);
    expect((m.walk - w0) * 2 / 2).toBeGreaterThan(1.2);
    expect(slid).toBeLessThan(0.05);
  });

  it('the body drops onto each footfall and is lowest just after it; the trunk leans into the walk, the arms swing against the legs', () => {
    const m = newDemonMem();
    walk(m, 2, FPS);
    let low = 9, lowAt = 0, high = -9, armLo = 9, armHi = -9, nod = 0;
    walk(m, 2, FPS, DEMON_SPEED, () => {
      const y = m.pose.joints[J.hipsY], w = (2 * m.walk) % 1;
      if (y < low) { low = y; lowAt = w; }
      high = Math.max(high, y);
      armLo = Math.min(armLo, m.pose.joints[J.armR + ARM.swing]); armHi = Math.max(armHi, m.pose.joints[J.armR + ARM.swing]); nod = Math.max(nod, m.pose.joints[J.neck + LEAN]);
    });
    expect(lowAt).toBeLessThan(0.1);
    expect(high - low).toBeGreaterThan(1);
    expect(m.pose.joints[J.spine + LEAN]).toBeGreaterThan(0.08);
    expect(armHi - armLo).toBeGreaterThan(0.4);
    // the right foot lands at whole cycles: the right arm is back then
    const n = newDemonMem();
    walk(n, 4, FPS);
    while (n.walk % 1 > 0.03) walk(n, 1 / FPS, FPS);
    expect(n.pose.joints[J.armR + ARM.swing]).toBeLessThan(n.pose.joints[J.armL + ARM.swing]);
    expect(n.pose.joints[J.footR + FOOT.x]).toBeGreaterThan(n.pose.joints[J.footL + FOOT.x] + 8);
    // it stops: the feet come home
    stand(n, 1.5, { x: n.lastX });
    expect(n.pose.joints[J.footR + FOOT.x]).toBeCloseTo(REST[J.footR + FOOT.x], 1);
    expect(n.pose.joints[J.footL + FOOT.y]).toBeCloseTo(0, 1);
  });

  it('the page\'s walk goes at the server\'s speed', () => {
    const a = demonDev('walk', 1).along, b = demonDev('walk', 2).along;
    expect(b - a).toBeCloseTo(DEMON_SPEED, 6);
  });
});

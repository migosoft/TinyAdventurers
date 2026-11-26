import { describe, expect, it } from 'vitest';
import { ANIM, CONST, EFFECT, FLAG } from '../../generated/defs';
import type { BuiltIn } from '../built';
import { actPeriod, DEMON_SPEED, demonAct, demonDev, FLY_ACT } from '../demonScript';
import { DEMON_POSE as P, demonPose, newDemonMem, restPose, type DemonMem } from './pose';
import { DEMON } from './shape';
import { ARM, BONE, BONES, FOOT, J, JOINTS, LEAN, TURN, placeBones } from './skeleton';
import { WING } from './wings';

const FPS = 60, AIR = FLAG.AIRBORNE;
const inp = (o: Partial<BuiltIn> = {}): BuiltIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, x: 3, z: 4, ...o });
/** Plays `anim` from `from` to `to` s of its clock at `fps`; `each` sees every frame. A fresh memory is first shown standing. */
function play(m: DemonMem, anim: number, from: number, to: number, o: Partial<BuiltIn> = {}, each?: (t: number) => void, fps = FPS): void {
  if (!m.started) demonPose(inp({ ...o, anim: ANIM.Idle }), 0, m);
  for (let i = 0, n = Math.round((to - from) * fps); i <= n; i++) { const t = i === n ? to : from + i / fps; demonPose(inp({ ...o, anim, animT: t }), 1 / fps, m); each?.(t); }
}
const stand = (m: DemonMem, secs: number, o: Partial<BuiltIn> = {}, each?: (t: number) => void): void => play(m, ANIM.Idle, 0, secs, o, each);
const bones = new Float32Array(BONES * 12);
/** A bone's pivot in the model frame. */
function at(m: DemonMem, bone: number): [number, number, number] {
  placeBones(m.pose, bones);
  return [bones[bone * 12], bones[bone * 12 + 1], bones[bone * 12 + 2]];
}
/** The middle of the head: `headMid` up the head's own axis. */
function head(m: DemonMem): [number, number, number] {
  placeBones(m.pose, bones);
  const o = BONE.head * 12, up = P.headMid - 27.2;
  return [bones[o] + bones[o + 6] * up, bones[o + 1] + bones[o + 7] * up, bones[o + 2] + bones[o + 8] * up];
}
const REST = restPose().joints;
const W = { claws: CONST.DEMON_CLEAVE_WINDUP, tail: CONST.DEMON_TAIL_WINDUP, swoop: CONST.DEMON_SWOOP_WINDUP, cast: CONST.DEMON_CAST_WINDUP, breath: CONST.DEMON_BREATH_WINDUP };

describe('demonPose: the rows', () => {
  it('counts lengths in the builder\'s units', () => {
    expect(P.px).toBeCloseTo(1 / DEMON.unit, 12);
    expect(P.lift).toBeCloseTo(17 / DEMON.unit, 12);
  });

  it('standing: it breathes, shifts its weight and sways its tail, slowly; the wings are never still', () => {
    const m = newDemonMem();
    let lo = 9, hi = -9, zl = 9, zh = -9, tl = 9, th = -9, wl = 9, wh = -9, fast = 0, last = 0;
    stand(m, 12, {}, (t) => {
      const y = m.pose.joints[J.hipsY], z = m.pose.joints[J.hipsZ];
      if (t > 0) fast = Math.max(fast, Math.abs(y - last) * FPS);
      last = y; lo = Math.min(lo, y); hi = Math.max(hi, y); zl = Math.min(zl, z); zh = Math.max(zh, z);
      tl = Math.min(tl, m.pose.tail[10]); th = Math.max(th, m.pose.tail[10]); wl = Math.min(wl, m.pose.wingR.arm.raise); wh = Math.max(wh, m.pose.wingR.arm.raise);
    });
    expect(hi - lo).toBeGreaterThan(0.3);
    expect(fast).toBeLessThan(1);
    expect(zh - zl).toBeGreaterThan(1);
    expect(th - tl).toBeGreaterThan(0.2);
    expect(wh - wl).toBeGreaterThan(0.05);
    expect(m.pose.lift).toBe(0);
    // the feet stay where they stand
    expect(m.pose.joints[J.footR + FOOT.y]).toBe(0);
  });

  it('claws: the arm is drawn back and up in the wind-up, sweeps across the front in the strike, and the arms take turns', () => {
    const m = newDemonMem();
    play(m, ANIM.Melee, 0, 0);
    expect(m.pose.joints[J.armR + ARM.out]).toBeCloseTo(REST[J.armR + ARM.out], 1);
    play(m, ANIM.Melee, 1 / FPS, W.claws - 0.06);
    const j = m.pose.joints;
    expect(m.side).toBe(1);
    expect(j[J.armR + ARM.out]).toBeGreaterThan(REST[J.armR + ARM.out] + 0.6);
    expect(j[J.armR + ARM.swing]).toBeLessThan(-0.3);
    expect(j[J.chest + TURN]).toBeGreaterThan(0.2);
    expect(j[J.armL + ARM.out]).toBeCloseTo(REST[J.armL + ARM.out], 1);
    expect(m.wr.fold).toBeLessThan(WING.rest.fold - 0.08);
    play(m, ANIM.Melee, W.claws - 0.06 + 1 / FPS, W.claws + P.claws.strike / 2);
    expect(j[J.armR + ARM.swing]).toBeGreaterThan(0.8);
    expect(j[J.armR + ARM.curl]).toBeLessThan(-0.3);
    play(m, ANIM.Melee, W.claws + P.claws.strike / 2, W.claws + CONST.DEMON_CLEAVE_RECOVER);
    stand(m, 1);
    expect(j[J.armR + ARM.swing]).toBeCloseTo(REST[J.armR + ARM.swing], 1);
    // the next one is the left arm's, mirrored
    play(m, ANIM.Melee, 0, W.claws - 0.06);
    expect(m.side).toBe(-1);
    expect(j[J.armL + ARM.out]).toBeGreaterThan(REST[J.armL + ARM.out] + 0.6);
    expect(j[J.chest + TURN]).toBeLessThan(-0.2);
    // and a third begun right after the second (no standing frame seen between) is the right arm's again
    play(m, ANIM.Melee, W.claws, W.claws + 0.3);
    play(m, ANIM.Melee, 0, 0.1);
    expect(m.side).toBe(1);
  });

  it('claws throw the weight: the hips go back before they go forward, and the trunk swings past its rest', () => {
    const m = newDemonMem();
    let back = 0, backAt = 0, fwd = 0, fwdAt = 0;
    play(m, ANIM.Melee, 0, W.claws + CONST.DEMON_CLEAVE_RECOVER, {}, (t) => {
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
    expect(n.pose.joints[J.chest + TURN] + n.pose.joints[J.hips + TURN]).toBeLessThan(-0.4);   // wound up to the right (+), swung past to the left
  });

  it('tail: it coils to one side with the hips turned against it, whips round to the other, the tip after the root; the wings lift out of its way', () => {
    const m = newDemonMem();
    play(m, ANIM.Tail, 0, W.tail - 0.07);
    expect(m.pose.tail[0]).toBeGreaterThan(0.5);
    expect(m.pose.joints[J.hips + TURN]).toBeLessThan(-0.1);
    expect(m.wr.raise).toBeGreaterThan(WING.rest.raise + 0.3);
    expect(m.pose.joints[J.footR + FOOT.z] - m.pose.joints[J.footL + FOOT.z]).toBeGreaterThan(REST[J.footR + FOOT.z] * 2 + 2);
    let rootAt = 0, tipAt = 0, root = 9, tip = 9;
    play(m, ANIM.Tail, W.tail - 0.07 + 1 / FPS, W.tail + CONST.DEMON_TAIL_RECOVER, {}, (t) => {
      if (m.pose.tail[0] < root) { root = m.pose.tail[0]; rootAt = t; }
      if (m.pose.tail[10] < tip) { tip = m.pose.tail[10]; tipAt = t; }
    });
    expect(root).toBeLessThan(-1);
    expect(tip).toBeLessThan(-0.6);
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
    expect(m.wr.raise).toBeGreaterThan(0.9);
    expect(j[J.hipsY]).toBeLessThan(-4);
    expect(j[J.footR + FOOT.y]).toBeCloseTo(0, 1);
    expect(m.pose.lift).toBe(0);
  });

  it('cast: one arm rises within the wind-up and points down ahead, holds through the release, drops; the hands take turns and the hand anchor goes with them', () => {
    const m = newDemonMem(), j = m.pose.joints;
    play(m, ANIM.Cast, 0, 0.1);
    expect(j[J.armR + ARM.swing]).toBeLessThan(0.3);
    play(m, ANIM.Cast, 0.1, W.cast);
    expect(m.pose.caster).toBe(1);
    expect(j[J.armR + ARM.swing]).toBeGreaterThan(0.9);
    expect(j[J.armR + ARM.swing]).toBeLessThan(1.4);   // below the horizontal: at the target's feet
    expect(j[J.armR + ARM.curl]).toBeLessThan(-0.5);
    expect(j[J.armL + ARM.swing]).toBeCloseTo(REST[J.armL + ARM.swing], 1);
    expect(m.wr.fold).toBeLessThan(0.36);
    play(m, ANIM.Cast, W.cast, W.cast + 0.1);
    expect(j[J.armR + ARM.swing]).toBeGreaterThan(0.9);
    play(m, ANIM.Cast, W.cast + 0.1, W.cast + CONST.DEMON_CAST_RECOVER);
    expect(j[J.armR + ARM.swing]).toBeLessThan(0.75);
    stand(m, 0.5);
    play(m, ANIM.Cast, 0, W.cast);
    expect(m.pose.caster).toBe(-1);
    expect(j[J.armL + ARM.swing]).toBeGreaterThan(0.9);
  });

  it('breath: the head goes back and the face heats up, then it leans in with the jaw wide open and trembles', () => {
    const m = newDemonMem(), j = m.pose.joints;
    play(m, ANIM.Breath, 0, W.breath * 0.75);
    expect(j[J.neck + LEAN] + j[J.head + LEAN]).toBeLessThan(-0.3);
    expect(m.pose.heat).toBeGreaterThan(1.5);
    expect(j[J.jaw]).toBeLessThan(0.4);
    play(m, ANIM.Breath, W.breath * 0.75, W.breath + 0.5);
    expect(j[J.jaw]).toBeGreaterThan(0.8);
    expect(j[J.spine + LEAN]).toBeGreaterThan(0.1);
    expect(m.pose.heat).toBeGreaterThan(1.6);
    expect(m.wr.raise).toBeGreaterThan(0.3);
    let lo = 9, hi = -9;
    play(m, ANIM.Breath, W.breath + 0.5, W.breath + 0.8, {}, () => { lo = Math.min(lo, j[J.head + LEAN]); hi = Math.max(hi, j[J.head + LEAN]); });
    expect(hi - lo).toBeGreaterThan(0.02);
    stand(m, 1);
    expect(j[J.jaw]).toBeCloseTo(0, 2);
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

  it('the take-off crouches first, pushes off slowly, and ends with the first down stroke done', () => {
    const m = newDemonMem();
    play(m, ANIM.TakeOff, 0, 0);
    expect(m.pose.lift).toBe(0);
    play(m, ANIM.TakeOff, 1 / FPS, P.takeoff.gather - P.takeoff.wing.lead);
    expect(m.wr.raise).toBeGreaterThan(1);   // the wings are up and open before the push
    expect(m.wr.fold).toBeLessThan(0.05);
    play(m, ANIM.TakeOff, P.takeoff.gather - P.takeoff.wing.lead, P.takeoff.gather);
    expect(m.pose.lift).toBeLessThan(0.1 * full);
    expect(m.pose.joints[J.hipsY]).toBeLessThan(-3);
    expect(m.pose.joints[J.footR + FOOT.y] + m.pose.lift).toBeCloseTo(0, 5);   // the feet are still on the floor
    play(m, ANIM.TakeOff, P.takeoff.gather, CONST.DEMON_TAKEOFF);
    expect(m.pose.lift).toBeCloseTo(P.liftAtTakeoff * full, 5);
    expect(m.beat).toBeCloseTo(WING.down, 2);
    expect(m.wr.raise).toBeLessThan(-0.5);
    expect(m.pose.joints[J.footR + FOOT.y] + m.pose.lift).toBeGreaterThan(1);
    play(m, ANIM.Idle, 0, 0, { flags: AIR });
    expect(Math.abs(m.beat - WING.down)).toBeLessThan(0.02);
  });

  it('the climb labours: full height within three beats, never falling by more than the bob from frame to frame', () => {
    const m = newDemonMem();
    let last = 0, fall = 0, low = 9, dips = 0, wasUp = true, lastH = 0;
    takeOff(m, 3 * WING.beat, (t) => {
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

  it('hovering, the left leg is drawn up and the right hangs long; the body rises and sinks with the beat', () => {
    const m = newDemonMem();
    demonPose(inp({ flags: AIR }), 0, m);
    let lo = 9, hi = -9, wl = 9, wh = -9, gap = 0, n = 0;
    play(m, ANIM.Idle, 0, 2 * WING.beat, { flags: AIR }, () => {
      const j = m.pose.joints;
      lo = Math.min(lo, j[J.hipsY]); hi = Math.max(hi, j[J.hipsY]); wl = Math.min(wl, m.pose.wingR.arm.raise); wh = Math.max(wh, m.pose.wingR.arm.raise);
      gap += j[J.footL + FOOT.y] - j[J.footR + FOOT.y]; n++;
      expect(j[J.footR + FOOT.y] + m.pose.lift).toBeGreaterThan(4);
    });
    expect(hi - lo).toBeCloseTo(P.bob, 1);
    expect(wh - wl).toBeGreaterThan(1);
    expect(gap / n).toBeCloseTo(P.air.tuck[1], 5);
    expect(m.pose.joints[J.footL + FOOT.x]).toBeGreaterThan(m.pose.joints[J.footR + FOOT.x] + 1);
    expect(m.pose.lift).toBe(full);
    expect(m.pose.joints[J.neck + LEAN] + m.pose.joints[J.head + LEAN]).toBeGreaterThan(0.25);   // it looks down
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
      // the wings lie broad against the fall: open, the face turned down
      if (Math.abs(t - 0.3) < 0.5 / FPS) { expect(m.pose.wingR.arm.fold).toBeLessThan(0.05); expect(m.pose.wingR.arm.pitch).toBeLessThan(-1); expect(m.pose.wingR.arm.raise).toBeGreaterThan(0.2); }
    });
    expect(faster).toBe(true);
    expect(m.pose.lift).toBeCloseTo(0, 5);
    expect(m.pose.joints[J.footR + FOOT.y]).toBeCloseTo(0, 3);
    expect(m.pose.joints[J.footL + FOOT.y]).toBeCloseTo(0, 3);
    // the hips: down deep, up, down again a little, then still
    const ys: number[] = [];
    stand(m, 2.2, {}, () => ys.push(at(m, BONE.hips)[1] - 15.5));
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

  it('first seen in the air it hangs at full height at once, in the hover\'s pose', () => {
    const m = newDemonMem(), p = demonPose(inp({ flags: AIR }), 1 / FPS, m);
    expect(p.lift).toBe(full);
    expect(p.wingR.arm.fold).toBeLessThan(0.1);
    expect(p.joints[J.footL + FOOT.y] - p.joints[J.footR + FOOT.y]).toBeCloseTo(P.air.tuck[1], 5);
    // and first seen in mid Swoop it glides
    const n = newDemonMem(), q = demonPose(inp({ anim: ANIM.Dash, animT: W.swoop + 0.3 }), 1 / FPS, n);
    expect(q.joints[J.hips + LEAN]).toBeGreaterThan(0.6);
    expect(q.wingR.arm.fold).toBe(0);
  });

  it('in the air a cast and a breath lay their arm, head and jaw over the hover: the wings keep beating', () => {
    const m = newDemonMem();
    demonPose(inp({ flags: AIR }), 0, m);
    let wl = 9, wh = -9;
    play(m, ANIM.Breath, 0, W.breath + 1, { flags: AIR }, () => { wl = Math.min(wl, m.pose.wingR.arm.raise); wh = Math.max(wh, m.pose.wingR.arm.raise); });
    expect(wh - wl).toBeGreaterThan(1);
    expect(m.pose.joints[J.jaw]).toBeGreaterThan(0.8);
    expect(m.pose.lift).toBe(full);
    play(m, ANIM.Cast, 0, W.cast, { flags: AIR });
    expect(m.pose.joints[J.armR + ARM.swing]).toBeGreaterThan(0.6);
    expect(m.pose.joints[J.jaw]).toBeLessThan(0.2);
  });

  it('the whole flight of the page\'s script at 60 fps: no joint snaps, the lift never jumps', () => {
    const m = newDemonMem(), prev = new Float32Array(JOINTS);
    let worst = 0, worstFoot = 0, liftStep = 0, lastLift = 0, top = 0;
    for (let i = 0, n = Math.round(actPeriod('fly') * FPS); i <= n; i++) {
      const t = i / FPS, a = demonAct('fly', t), p = demonPose(inp({ anim: a.anim, animT: a.animMs / 1000, flags: a.flags }), i === 0 ? 0 : 1 / FPS, m);
      if (i > 0) for (let k = 0; k < JOINTS; k++) {
        const d = Math.abs(p.joints[k] - prev[k]), place = k < 3 || (k >= J.footR && (k - J.footR) % 4 < 3);
        if (place) worstFoot = Math.max(worstFoot, d); else worst = Math.max(worst, d);
        expect(Number.isFinite(p.joints[k])).toBe(true);
      }
      liftStep = Math.max(liftStep, Math.abs(p.lift - lastLift)); lastLift = p.lift; top = Math.max(top, p.lift);
      prev.set(p.joints);
    }
    expect(worst).toBeLessThan(0.15);       // rad a frame: the arms thrown down in the take-off's push are the fastest
    expect(worstFoot).toBeLessThan(1.2);    // units a frame: the push of the take-off and the fall onto the floor
    expect(liftStep).toBeLessThan(0.8);
    expect(top).toBeCloseTo(P.lift, 5);
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
    expect(worstRoot).toBeLessThan(0.06);
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
  });

  it('a long frame snaps to the target: no NaN, no fade, the chains on their targets', () => {
    const m = newDemonMem();
    stand(m, 0.3);
    const p = demonPose(inp({ anim: ANIM.Dash, animT: W.swoop + 0.3, aim: 2, x: 9 }), 5, m);
    for (let k = 0; k < JOINTS; k++) { expect(Number.isFinite(p.joints[k])).toBe(true); expect(m.base[k]).toBe(m.target.joints[k]); }
    expect(m.face).toBeCloseTo(2, 9);
    expect(m.faceV).toBe(0);
    expect(p.wingR.arm.fold).toBe(m.wr.fold);
    expect(p.wingR.tips.raise).toBe(m.wr.raise);
    expect(p.tail[10]).toBe(p.tail[0]);
    for (const v of p.tail) expect(Number.isFinite(v)).toBe(true);
    const q = demonPose(inp({ flags: AIR }), 5, m);
    expect(q.lift).toBe(P.lift);
  });
});

describe('demonPose: the head, the facing and the flinch', () => {
  const turns = (m: DemonMem): number => m.pose.joints[J.chest + TURN] + m.pose.joints[J.neck + TURN] + m.pose.joints[J.head + TURN];

  it('the head follows the look, eased; the body does not turn for it', () => {
    const m = newDemonMem();
    stand(m, 0.2);
    demonPose(inp({ look: 1 }), 1 / FPS, m);
    expect(turns(m)).toBeLessThan(0.02);   // eased into the turn
    stand(m, 1.5, { look: 1 });
    expect(turns(m)).toBeCloseTo(1, 1);
    expect(Math.abs(turns(m) - 1)).toBeLessThan(0.02);
    expect(m.face).toBe(0);
    expect(m.pose.joints[J.head + TURN]).toBeCloseTo(0.5, 1);
    expect(m.pose.joints[J.neck + TURN]).toBeCloseTo(0.35, 1);
    stand(m, 2, { look: 3 });
    expect(Math.abs(turns(m) - P.neck)).toBeLessThan(0.02);
    stand(m, 2, { look: null });
    expect(Math.abs(turns(m))).toBeLessThan(0.02);
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
        const h0 = head(calm), c0 = at(calm, BONE.armR);
        const h = head(m), c = at(m, BONE.armR), d = Math.hypot(h[0] - h0[0], h[2] - h0[2]);
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

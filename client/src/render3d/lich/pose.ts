// The lich's pose (#358): what a snapshot says about the lich (anim, animT, effects, flags, aim) turned into the weights the builder reads.
// The curves are the approved spike's (lichSpike.ts lines 570 to 581, 677, 695 to 697) as functions of `a`, the seconds since an action began.
// The server's anims map onto that clock by a wind-up and release rule: during the wind-up `a` runs from 0 to the action's `at`
// (scaled to the server's wind-up length); on the first frame the anim is no longer that wind-up (the release) the second half runs
// from `at` on in real time. A wind-up that was broken off eases its weights to 0.
// Angles (`aim`, `look`, `face`) are world radians in the convention of shape.ts and cloth.ts: the model frame is the world turned by `face`.

import { ANIM, CONST, EFFECT, FLAG } from '../../generated/defs';
import { has } from '../../game/effectBits';
import { CLOTH } from './cloth';

export interface LichIn { anim: number; animT: number; effects: number; flags: number; /** World rad. */ aim: number; /** World rad toward what the head looks at, or null. */ look: number | null; /** 0..1, the cloth's. */ glide: number }

export interface LichPose {
  t: number; face: number; headYaw: number; glide: number;
  novaUp: number; novaHit: number; novaChest: number; novaOut: number;
  raiseUp: number; raiseHit: number; raiseLow: number; raiseLift: number;
  flingBack: number; flingOut: number; gaze: number; hurt: number;
  /** The staff's bounce after a strike (builder units). */ strike: number;
  /** Pages riffle. */ casting: number;
  flare: number; /** Levels the builder, the material and the lights share. */ rune: number; staffRune: number; gem: number; wave: number; eye: number;
}

/** Seconds on the spike's action clock: `at` the release, `after` it the action is done (nova: seconds since the release). */
export const LICH_TIMES = { nova: { at: 1.33, after: 1.87 }, raise: { at: 0.6, after: 1.3 }, fling: { back: 0.29, at: 0.3, after: 0.9 }, gaze: { in: 0.3, out: 0.4 }, broken: 0.25, hurt: 0.15, slack: 2 } as const;

const NOVA = 1, RAISE = 2, FLING = 3;
type Act = 0 | 1 | 2 | 3;
const SECOND = 1 as const, EASE = 2 as const;

export interface LichMem {
  started: boolean;
  t: number;
  face: number;
  headYaw: number;
  lastAnim: number;
  lastAnimT: number;
  /** 0 none, 1 the second half runs, 2 a broken-off wind-up eases back. */ mode: 0 | 1 | 2;
  /** Seconds the current wind-up spent frozen (the server's animT keeps growing meanwhile). */ heldFor: number;
  /** Client seconds since `lastAnimT` last changed (0 on a frame that brought a new animT; does not grow while held). */ seenFor: number;
  act: Act;
  /** The action clock where the wind-up ended or was broken off. */ a: number;
  /** Seconds since the release (mode 1) or since the break (mode 2). */ r: number;
  gazeFrom: number;
  /** Seconds since Gaze ended, -1 when no ease runs. */ gazeE: number;
  hurtT: number;
  lastHurt: boolean;
  pose: LichPose;
}

const S = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The spike's pose with the clock at 0, nothing cast, standing: each level is the spike's expression at t = 0 with no action. */
export function restPose(): LichPose {
  const t = 0;
  const beat = (t / 2.6) % 1, since = (beat - 0.78 + 1) % 1; // lichSpike.ts line 695
  return {
    t, face: 0, headYaw: 0, glide: 0,
    novaUp: 0, novaHit: 0, novaChest: 0, novaOut: 0,
    raiseUp: 0, raiseHit: 0, raiseLow: 0, raiseLift: 0,
    flingBack: 0, flingOut: 0, gaze: 0, hurt: 0,
    strike: 0, casting: 0, flare: 0,
    rune: 0.42 + 0.2 * Math.sin(t * 1.7), // line 581 (mats.rune.value)
    staffRune: 0.28, // line 704 (mats.gem.value) with no weight
    gem: 0.5 + 0.55 * Math.exp(-since * 3.2) * S(0, 0.04, since), // line 697 (gemPulse)
    wave: beat * 1.3 - 0.02, // line 696 (mats.wave.value)
    eye: 0.85 + 0.15 * Math.sin(t * 5.1) * Math.sin(t * 1.3), // line 654 (eyeGlow) with gaze and flare 0
  };
}

export function newLichMem(): LichMem {
  return { started: false, t: 0, face: 0, headYaw: 0, lastAnim: ANIM.Idle, lastAnimT: 0, mode: 0, heldFor: 0, seenFor: 0, act: 0, a: 0, r: 0, gazeFrom: 0, gazeE: -1, hurtT: -1, lastHurt: false, pose: restPose() };
}

/** Which action a wind-up anim belongs to, 0 for any other anim. */
const actOf = (anim: number): Act => (anim === ANIM.Slam ? NOVA : anim === ANIM.Summon ? RAISE : anim === ANIM.Windup ? FLING : 0);
const windupLen = (act: Act): number => (act === NOVA ? CONST.LICH_NOVA_WINDUP : act === RAISE ? CONST.MINION_WINDUP : CONST.LICH_GLOOM_WINDUP);
const releaseAt = (act: Act): number => (act === NOVA ? LICH_TIMES.nova.at : act === RAISE ? LICH_TIMES.raise.at : LICH_TIMES.fling.at);
const doneAfter = (act: Act): number => (act === NOVA ? LICH_TIMES.nova.after : act === RAISE ? LICH_TIMES.raise.after : LICH_TIMES.fling.after);

/** The action clock during a wind-up of `animT` seconds (never past the release point). */
function windupClock(act: Act, animT: number): number {
  // just short of the release point: only the release itself shows the hit
  if (act === NOVA) return Math.min(LICH_TIMES.nova.at - 1e-6, (animT * LICH_TIMES.nova.at) / CONST.LICH_NOVA_WINDUP);
  if (act === RAISE) return Math.min(LICH_TIMES.raise.at - 1e-6, (animT * LICH_TIMES.raise.at) / CONST.MINION_WINDUP);
  return Math.min(animT, LICH_TIMES.fling.back);
}

/** The spike's curves (lines 571 to 579) for action `act` at clock `a`, times `k` (the ease back), written into `p`. */
function setWeights(p: LichPose, act: Act, a: number, k: number): void {
  const n = act === NOVA, r = act === RAISE, f = act === FLING;
  p.novaUp = n ? S(0, 0.5, a) * (1 - S(1.25, 1.33, a)) * k : 0;
  p.novaHit = n && a >= 1.33 ? Math.exp(-(a - 1.33) * 3.2) * k : 0;
  p.novaChest = n ? S(0, 0.4, a) * (1 - S(1.5, 2.2, a)) * k : 0;
  p.novaOut = n ? S(1.3, 1.42, a) * (1 - S(1.9, 2.3, a)) * k : 0;
  p.raiseUp = r ? S(0, 0.32, a) * (1 - S(0.42, 0.5, a)) * k : 0;
  p.raiseHit = r && a > 0.5 ? Math.exp(-(a - 0.5) * 4) * k : 0;
  p.raiseLow = r ? S(0.1, 0.5, a) * (1 - S(0.6, 1.25, a)) * k : 0;
  p.raiseLift = r ? S(0.6, 1.25, a) * (1 - S(1.45, 1.9, a)) * k : 0;
  p.flingBack = f ? S(0, 0.28, a) * (1 - S(0.3, 0.44, a)) * k : 0;
  p.flingOut = f ? S(0.3, 0.46, a) * (1 - S(0.72, 1.2, a)) * k : 0;
}

/** The pose of this frame, written into the memory's own object (no allocation). */
export function lichPose(s: LichIn, dt: number, mem: LichMem): LichPose {
  const held = has(s.effects, EFFECT.Frozen) || has(s.effects, EFFECT.Petrified);
  const first = !mem.started;
  if (held && !first) {
    // the server's wind-up does not end while the lich cannot act: its animT keeps growing, and the cast resumes where it stopped
    if (actOf(mem.lastAnim) !== 0) mem.heldFor += dt;
    return mem.pose;
  }
  const p = mem.pose;
  const cur = actOf(s.anim), prev = first ? 0 : actOf(mem.lastAnim);
  // the same wind-up anim whose animT fell (beyond rounding) is the previous wind-up ending and a new one starting
  const restart = !first && cur !== 0 && cur === prev && s.anim === mem.lastAnim && s.animT - mem.heldFor < mem.lastAnimT - 1e-4;
  const ended = prev !== 0 && (cur !== prev || restart);
  // the server's animT at the switch, estimated: what the last snapshot said plus the client time since it changed, plus this frame
  const estimate = mem.lastAnimT + mem.seenFor + dt;
  if (first || cur !== prev || restart) { mem.heldFor = 0; mem.seenFor = 0; }
  const animT = s.animT - mem.heldFor;

  // the clock and the facing
  if (!first) mem.t += dt;
  const fe = first ? 1 : 1 - Math.exp(-dt * 4);
  mem.face = first ? wrap(s.aim) : wrap(mem.face + wrap(s.aim - mem.face) * fe);
  const want = s.look === null ? 0 : Math.min(0.45, Math.max(-0.45, 0.6 * wrap(s.look - mem.face)));
  mem.headYaw = first ? want : mem.headYaw + (want - mem.headYaw) * (1 - Math.exp(-dt * 3.5));
  const t = mem.t;

  // the cast: a wind-up, its second half after the release, or a broken-off wind-up easing back
  let act: Act = 0, a = 0, k = 1;
  if (dt > CLOTH.maxDt) mem.mode = 0; // a long frame ends a running second half or ease back, as it resets the cloth
  if (ended && dt <= CLOTH.maxDt) {
    if (estimate >= windupLen(prev) - LICH_TIMES.slack * CONST.DT) { mem.mode = SECOND; mem.act = prev; mem.a = releaseAt(prev); mem.r = 0; }
    else { mem.mode = EASE; mem.act = prev; mem.a = windupClock(prev, mem.lastAnimT); mem.r = 0; }
  } else if (mem.mode !== 0 && !first) mem.r += dt;
  if (cur !== 0) {
    mem.mode = 0;
    act = cur; a = windupClock(cur, animT);
  } else if (mem.mode === SECOND) {
    if (mem.r >= doneAfter(mem.act)) mem.mode = 0;
    else { act = mem.act; a = mem.a + mem.r; }
  } else if (mem.mode === EASE) {
    if (mem.r >= LICH_TIMES.broken) mem.mode = 0;
    else { act = mem.act; a = mem.a; k = 1 - S(0, LICH_TIMES.broken, mem.r); }
  }
  setWeights(p, act, a, k);

  // gaze: rises while the anim is Gaze, then the value it had eases out
  if (s.anim === ANIM.Gaze) { mem.gazeFrom = S(0, LICH_TIMES.gaze.in, s.animT); mem.gazeE = -1; p.gaze = mem.gazeFrom; }
  else {
    if (!first && mem.lastAnim === ANIM.Gaze) mem.gazeE = 0; else if (mem.gazeE >= 0 && !first) mem.gazeE += dt;
    if (mem.gazeE >= LICH_TIMES.gaze.out) mem.gazeE = -1;
    p.gaze = mem.gazeE < 0 ? 0 : mem.gazeFrom * (1 - S(0, LICH_TIMES.gaze.out, mem.gazeE));
  }

  // hurt: a rising flag starts a clock
  const hurtNow = (s.flags & FLAG.HURT) !== 0;
  if (hurtNow && !mem.lastHurt) mem.hurtT = 0; else if (mem.hurtT >= 0 && !first) mem.hurtT += dt;
  if (mem.hurtT >= LICH_TIMES.hurt) mem.hurtT = -1;
  p.hurt = mem.hurtT < 0 ? 0 : Math.sin(Math.PI * Math.min(1, mem.hurtT / LICH_TIMES.hurt));
  mem.lastHurt = hurtNow;

  // the levels (spike lines 576 to 581, 654, 677, 695 to 697, 704)
  const hit = Math.max(p.raiseHit, p.novaHit);
  p.casting = Math.max(p.raiseLow, p.raiseLift, p.flingBack, p.flingOut);
  const novaGlow = p.novaUp * S(0, 1.25, a);
  p.flare = Math.max(novaGlow, p.novaHit, p.raiseLift * 0.8, p.raiseHit * 0.7);
  p.rune = 0.42 + 0.2 * Math.sin(t * 1.7) + 1.25 * p.flare + 0.35 * p.gaze;
  p.strike = hit > 0 ? 0.25 * hit * Math.abs(Math.sin((p.raiseHit > 0 ? a - 0.5 : a - 1.33) * 30)) : 0;
  const beat = (t / 2.6) % 1, since = (beat - 0.78 + 1) % 1;
  p.wave = beat * 1.3 - 0.02;
  p.gem = 0.5 + 0.55 * Math.exp(-since * 3.2) * S(0, 0.04, since) + 1.1 * Math.max(novaGlow, p.novaHit, p.raiseHit);
  p.staffRune = 0.28 + 0.9 * Math.max(novaGlow, p.novaHit, p.raiseHit);
  p.eye = 0.85 + 0.15 * Math.sin(t * 5.1) * Math.sin(t * 1.3) + 1.6 * p.gaze + 0.5 * p.flare;

  p.t = t; p.face = mem.face; p.headYaw = mem.headYaw; p.glide = s.glide;

  // snapshots bring a new animT every 2 ticks (or fewer when lost): the client time since it last changed
  mem.seenFor = first || animT !== mem.lastAnimT ? 0 : mem.seenFor + Math.min(dt, CLOTH.maxDt);
  mem.lastAnim = s.anim; mem.lastAnimT = animT; mem.started = true;
  return p;
}

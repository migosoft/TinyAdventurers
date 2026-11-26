// The demon's wings (#379): what a pose asks of a wing, the chain of lagging parts that follows it, the beat, and the wing's bones.
// No pose keys a wing joint: a pose names a target, the arm follows the target, the hand the arm and the finger tips the hand, so
// every change gets its follow-through. The tail (and the legs hanging in the air) lag the same way, link after link (`chainStep`).
// Pure; nothing here allocates per frame.
import { RIG } from './skeleton';

/** What a pose asks of a wing. `fold`: 0 fully open, 0.42 the approved rest, 1 closed against the back; the others rad: `raise` above the horizontal, `sweep` back from straight out, `pitch` the leading edge up, counted from the rest's plane (which stands nearly upright: a wing that pushes air down has its leading edge pitched down, forward). */
export interface WingTarget { fold: number; raise: number; sweep: number; pitch: number }
export interface WingState {
  arm: WingTarget; hand: WingTarget; tips: WingTarget; /** The parts' speeds. */ armV: WingTarget; handV: WingTarget; tipsV: WingTarget; billow: number; billowV: number;
  /** The last step's target: a frame's steps ramp from it to the new one, so the frame rate does not shift the wing in time. */
  aim: WingTarget;
}

const DEG = Math.PI / 180;

/**
 * Every tuning number of the wings' shape and motion.
 * - `beat`: s per beat in the air; `down`: the down stroke's share of it. `rates`: 1/s the arm, the hand and the tips follow at (the
 *   arm and the hand critically damped, the tips with `tipDamping`, so they overshoot and flick). `maxDt`: a longer frame snaps;
 *   `step`: the longest step the springs take (a frame is cut into equal steps).
 * - `rest`: the standing wing, the approved half-folded layout.
 * - `stroke`: the beat's targets. `raise`, `sweep`: at the top and at the bottom of the stroke; `pitch`: at the two turns, in the
 *   middle of the down stroke (the face pushes down) and in the middle of the up stroke (edge on, slicing); `fold`: how far the wing
 *   closes in the up stroke, open again at phase `open`; `ease`: how much of the down stroke's way is eased in and out (the rest linear).
 * - `flat`: the wing laid out flat in its own plane at rest (the spike's): `s` out along the span from the root, `h` up, in units of
 *   `size`; an arm from the root over the elbow to the wrist, four fingers from the wrist (a point each bows through, and its tip),
 *   `backEnd` where the webbing ends on the back. `lean`: the way the plane's up leans; `root`: off the shoulders' middle (right wing).
 * - `open`, `closed`: the layouts at fold 0 and 1, in angles (deg from the span's line): the upper arm, the forearm, the first
 *   finger's tip, and `fan`, the share of the rest's angles between the fingers.
 * - `tips`: per finger, how far its tip goes over from the hand's plane to the tips' (the rear fingers more).
 * - `slack`: the depth of the webbing's curtain fold per unit of `fold` (1: the spike's at rest). `billow`: the air in the webbing, a
 *   spring: `drive` depth per rad/s the hand moves along its normal, at most `max`; `rate` 1/s, `damping`.
 * - `chainDamping`: of `chainStep`'s links; `tailRates`: 1/s the tail's links follow at, root to tip. `turn`: rad per rad/s the body turns, for the wings' sweep and the tail's root;
 *   `ease`: 1/s the turning speed read from the aim is smoothed at.
 */
export const WING = {
  beat: 1.15, down: 0.42, rates: [28, 20, 13], tipDamping: 0.6, maxDt: 0.1, step: 1 / 120,
  rest: { fold: 0.42, raise: -0.1, sweep: 0.6716, pitch: 0 },
  stroke: { raise: [55 * DEG, -30 * DEG], sweep: [20 * DEG, -10 * DEG], pitch: [-25 * DEG, -42 * DEG, 8 * DEG], fold: 0.38, open: 0.92 },
  flat: {
    size: 6, wrist: [1.0, 2.3], elbow: [0.95, 0.9], backEnd: [0.1, -2.4],
    fingers: [[[3.5, 2.95], [6.2, 1.3]], [[3.1, 1.0], [4.7, -1.5]], [[2.3, -0.1], [3.1, -3.2]], [[1.45, -0.5], [1.5, -3.8]]],
    lean: [-0.2, 0.97, 0], root: [-3.8, -0.6, 2.8],
  },
  open: { humerus: 25, forearm: 55, finger: 6, fan: 1.12 },
  closed: { humerus: 60, forearm: 115, finger: -80, fan: 0.37 },
  tips: [0.7, 0.8, 0.9, 1],
  slack: 1, billow: { drive: 0.1, max: 0.4, rate: 16, damping: 0.45 },
  chainDamping: 0.8, tailRates: [10, 9, 8, 7, 6, 5], turn: { sweep: 0.12, tail: 0.25, ease: 8 },
} as const;

/** A wing lying still on `rest`. */
export function newWing(rest: WingTarget): WingState {
  const at = (): WingTarget => ({ ...rest }), still = (): WingTarget => ({ fold: 0, raise: 0, sweep: 0, pitch: 0 });
  return { arm: at(), hand: at(), tips: at(), armV: still(), handV: still(), tipsV: still(), billow: 0, billowV: 0, aim: at() };
}

// ---------------------------------------------------------------- the chain
const KEYS = ['fold', 'raise', 'sweep', 'pitch'] as const;
function snap(w: WingState, target: WingTarget): void {
  for (const k of KEYS) { w.arm[k] = w.hand[k] = w.tips[k] = w.aim[k] = target[k]; w.armV[k] = w.handV[k] = w.tipsV[k] = 0; }
  w.billow = w.billowV = 0;
}

/** Advances the chain and the billow; `dt` 0 changes nothing; `dt` over `WING.maxDt` snaps every part to the target. */
export function wingStep(w: WingState, target: WingTarget, dt: number): void {
  if (!(dt > 0)) return;
  if (dt > WING.maxDt) { snap(w, target); return; }
  const n = Math.ceil(dt / WING.step - 1e-6), h = dt / n, B = WING.billow, ra = WING.rates[0], rh = WING.rates[1], rt = WING.rates[2];
  for (let i = 1; i <= n; i++) {
    {
      const a = w.arm, av = w.armV, hd = w.hand, hv = w.handV, t = w.tips, tv = w.tipsV, f = i / n;
      av.fold += (ra * ra * (w.aim.fold + (target.fold - w.aim.fold) * f - a.fold) - 2 * ra * av.fold) * h; a.fold += av.fold * h;
      hv.fold += (rh * rh * (a.fold - hd.fold) - 2 * rh * hv.fold) * h; hd.fold += hv.fold * h;
      tv.fold += (rt * rt * (hd.fold - t.fold) - 2 * WING.tipDamping * rt * tv.fold) * h; t.fold += tv.fold * h;
    }
    {
      const a = w.arm, av = w.armV, hd = w.hand, hv = w.handV, t = w.tips, tv = w.tipsV, f = i / n;
      av.raise += (ra * ra * (w.aim.raise + (target.raise - w.aim.raise) * f - a.raise) - 2 * ra * av.raise) * h; a.raise += av.raise * h;
      hv.raise += (rh * rh * (a.raise - hd.raise) - 2 * rh * hv.raise) * h; hd.raise += hv.raise * h;
      tv.raise += (rt * rt * (hd.raise - t.raise) - 2 * WING.tipDamping * rt * tv.raise) * h; t.raise += tv.raise * h;
    }
    {
      const a = w.arm, av = w.armV, hd = w.hand, hv = w.handV, t = w.tips, tv = w.tipsV, f = i / n;
      av.sweep += (ra * ra * (w.aim.sweep + (target.sweep - w.aim.sweep) * f - a.sweep) - 2 * ra * av.sweep) * h; a.sweep += av.sweep * h;
      hv.sweep += (rh * rh * (a.sweep - hd.sweep) - 2 * rh * hv.sweep) * h; hd.sweep += hv.sweep * h;
      tv.sweep += (rt * rt * (hd.sweep - t.sweep) - 2 * WING.tipDamping * rt * tv.sweep) * h; t.sweep += tv.sweep * h;
    }
    {
      const a = w.arm, av = w.armV, hd = w.hand, hv = w.handV, t = w.tips, tv = w.tipsV, f = i / n;
      av.pitch += (ra * ra * (w.aim.pitch + (target.pitch - w.aim.pitch) * f - a.pitch) - 2 * ra * av.pitch) * h; a.pitch += av.pitch * h;
      hv.pitch += (rh * rh * (a.pitch - hd.pitch) - 2 * rh * hv.pitch) * h; hd.pitch += hv.pitch * h;
      tv.pitch += (rt * rt * (hd.pitch - t.pitch) - 2 * WING.tipDamping * rt * tv.pitch) * h; t.pitch += tv.pitch * h;
    }
    // the air pushes the webbing against the way the hand travels along its normal
    const p = w.hand.pitch + PLANE, along = -w.handV.raise * Math.sin(p) + w.handV.sweep * Math.cos(w.hand.raise) * Math.cos(p);
    const to = Math.max(-B.max, Math.min(B.max, -B.drive * along));
    w.billowV += (B.rate * B.rate * (to - w.billow) - 2 * B.damping * B.rate * w.billowV) * h;
    w.billow += w.billowV * h;
  }
  for (const k of KEYS) w.aim[k] = target[k];
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const bell = (x: number): number => { const s = Math.sin(Math.PI * Math.max(0, Math.min(1, x))); return s * s; };

/** The beat's target at `phase` 0..1 (0: the top, the down stroke begins). */
export function beatTarget(phase: number, out: WingTarget): WingTarget {
  const S = WING.stroke, p = phase - Math.floor(phase), down = p < WING.down, u = down ? p / WING.down : (p - WING.down) / (1 - WING.down);
  // how far down the stroke the wing is: 0 the top, 1 the bottom
  const low = down ? smooth(u) : 1 - smooth(u);
  out.raise = S.raise[0] + (S.raise[1] - S.raise[0]) * low;
  out.sweep = S.sweep[0] + (S.sweep[1] - S.sweep[0]) * low;
  out.pitch = S.pitch[0] + (S.pitch[down ? 1 : 2] - S.pitch[0]) * bell(u);
  out.fold = down ? 0 : S.fold * bell(u * (1 - WING.down) / (S.open - WING.down));
  return out;
}

// ---------------------------------------------------------------- the bones
/** Where a wing's 29 points lie in a `WingFrame` (x 3): the four fingers have 6 points each, wrist to tip; `back`: where the webbing ends on the back; `normal`: the unit normal of the hand's plane, behind the wing. */
export const WING_PT = { shoulder: 0, elbow: 1, wrist: 2, finger: 3, back: 27, normal: 28 } as const;
export type WingFrame = Float64Array;
export const newWingFrame = (): WingFrame => new Float64Array(29 * 3);

/** A part's frame into `o`: the span's direction, the plane's up and its normal (behind the wing). */
function frame(t: WingTarget, sd: number, o: Float64Array): void {
  const cr = Math.cos(t.raise), sr = Math.sin(t.raise), cs = Math.cos(t.sweep), ss = Math.sin(t.sweep), p = t.pitch + PLANE, cp = Math.cos(p), sp = Math.sin(p);
  const sx = -ss * cr, sy = sr, sz = sd * cs * cr, ux = sr * ss, uy = cr, uz = -sd * sr * cs;
  const nx = sd * (sy * uz - sz * uy), ny = sd * (sz * ux - sx * uz), nz = sd * (sx * uy - sy * ux);
  o[0] = sx; o[1] = sy; o[2] = sz;
  o[3] = ux * cp + nx * sp; o[4] = uy * cp + ny * sp; o[5] = uz * cp + nz * sp;
  o[6] = nx * cp - ux * sp; o[7] = ny * cp - uy * sp; o[8] = nz * cp - uz * sp;
}

/** `v` at fold 0, 0.42 and 1 as a parabola through the three: [c0, c1, c2] of `c0 + c1 f + c2 f^2`. */
function keys(open: number, rest: number, closed: number): [number, number, number] {
  const r = WING.rest.fold, c2 = ((closed - open) - (rest - open) / r) / (1 - r);
  return [open, (rest - open) / r - c2 * r, c2];
}
const at = (c: readonly number[], f: number): number => c[0] + f * (c[1] + f * c[2]);

const F = WING.flat;
const HUMERUS = Math.hypot(F.elbow[0], F.elbow[1]) * F.size, FOREARM = Math.hypot(F.wrist[0] - F.elbow[0], F.wrist[1] - F.elbow[1]) * F.size;
const FINGER0 = Math.atan2(F.fingers[0][1][1] - F.wrist[1], F.fingers[0][1][0] - F.wrist[0]);
const K_HUMERUS = keys(WING.open.humerus * DEG, Math.atan2(F.elbow[1], F.elbow[0]), WING.closed.humerus * DEG);
const K_FOREARM = keys(WING.open.forearm * DEG, Math.atan2(F.wrist[1] - F.elbow[1], F.wrist[0] - F.elbow[0]), WING.closed.forearm * DEG);
const K_FINGER = keys(WING.open.finger * DEG, FINGER0, WING.closed.finger * DEG), K_FAN = keys(WING.open.fan, 1, WING.closed.fan);
// each finger point at rest, from the wrist: its distance and its angle off the first finger's tip; and how far it goes over to the tips' plane
const F_LEN = new Float64Array(24), F_ANG = new Float64Array(24), F_TIP = new Float64Array(24);
F.fingers.forEach(([mid, tip], i) => {
  // a bow through `mid` to `tip`
  const cx = 2 * mid[0] - (F.wrist[0] + tip[0]) / 2, cy = 2 * mid[1] - (F.wrist[1] + tip[1]) / 2;
  for (let j = 0; j < 6; j++) {
    const t = j / 5, q = 1 - t, s = 2 * q * t * (cx - F.wrist[0]) + t * t * (tip[0] - F.wrist[0]), h = 2 * q * t * (cy - F.wrist[1]) + t * t * (tip[1] - F.wrist[1]);
    F_LEN[i * 6 + j] = Math.hypot(s, h) * F.size; F_ANG[i * 6 + j] = j === 0 ? 0 : Math.atan2(h, s) - FINGER0; F_TIP[i * 6 + j] = t * t * WING.tips[i];
  }
});
const ROOT = [RIG.shoulder[0] + F.root[0] - RIG.chest[0], RIG.shoulder[1] + F.root[1] - RIG.chest[1], F.root[2]];
const FA = new Float64Array(9), FH = new Float64Array(9), FT = new Float64Array(9);
/** The rest plane's turn about the span, off the plane that `raise` and `sweep` alone give: pitch 0 is the spike's lean. */
let PLANE = 0;
const BACK = new Float64Array(3);
{
  frame({ ...WING.rest, pitch: 0 }, 1, FA);
  const k = F.lean[0] * FA[0] + F.lean[1] * FA[1] + F.lean[2] * FA[2], lx = F.lean[0] - k * FA[0], ly = F.lean[1] - k * FA[1], lz = F.lean[2] - k * FA[2];
  PLANE = Math.atan2(lx * FA[6] + ly * FA[7] + lz * FA[8], lx * FA[3] + ly * FA[4] + lz * FA[5]);
  frame(WING.rest, 1, FA);
  for (let a = 0; a < 3; a++) BACK[a] = ROOT[a] + (FA[a] * F.backEnd[0] + FA[3 + a] * F.backEnd[1]) * F.size;
}

/**
 * The wing's bones in the chest's frame (relative to the chest's pivot, rest pose), by `WING_PT`: shoulder, elbow, wrist, four fingers
 * of 6 points each, the back end, the hand's normal. The arm lies in `w.arm`'s plane, the fingers in `w.hand`'s, and their outer
 * parts go over towards `w.tips`'s: late tips bend the fingers out of the hand's plane.
 */
export function wingBones(w: WingState, side: 1 | -1, out: WingFrame): void {
  frame(w.arm, side, FA); frame(w.hand, side, FH); frame(w.tips, side, FT);
  const ah = at(K_HUMERUS, w.arm.fold), af = at(K_FOREARM, w.arm.fold);
  const es = HUMERUS * Math.cos(ah), eh = HUMERUS * Math.sin(ah), ws = es + FOREARM * Math.cos(af), wh = eh + FOREARM * Math.sin(af);
  out[0] = ROOT[0]; out[1] = ROOT[1]; out[2] = side * ROOT[2];
  for (let a = 0; a < 3; a++) { out[3 + a] = out[a] + FA[a] * es + FA[3 + a] * eh; out[6 + a] = out[a] + FA[a] * ws + FA[3 + a] * wh; }
  const base = at(K_FINGER, w.hand.fold), fan = at(K_FAN, w.tips.fold), wx = out[6], wy = out[7], wz = out[8];
  for (let i = 0, o = WING_PT.finger * 3; i < 24; i++, o += 3) {
    const th = base + F_ANG[i] * fan, s = F_LEN[i] * Math.cos(th), h = F_LEN[i] * Math.sin(th), t = F_TIP[i], q = 1 - t;
    out[o] = wx + (FH[0] * q + FT[0] * t) * s + (FH[3] * q + FT[3] * t) * h;
    out[o + 1] = wy + (FH[1] * q + FT[1] * t) * s + (FH[4] * q + FT[4] * t) * h;
    out[o + 2] = wz + (FH[2] * q + FT[2] * t) * s + (FH[5] * q + FT[5] * t) * h;
  }
  const b = WING_PT.back * 3, n = WING_PT.normal * 3;
  out[b] = BACK[0]; out[b + 1] = BACK[1]; out[b + 2] = side * BACK[2];
  out[n] = FH[6]; out[n + 1] = FH[7]; out[n + 2] = FH[8];
}

// ---------------------------------------------------------------- lagging chains
/**
 * A chain of lagging links (the tail; the legs hanging in the air): `links` holds [yaw, pitch] per link, `vel` their speeds. The first
 * link follows the root, each other the one before, at `rates[i]` 1/s (the last rate for the links beyond). `dt` 0 changes nothing;
 * `dt` over `WING.maxDt` snaps every link to the root.
 */
export function chainStep(links: Float32Array, vel: Float32Array, rootYaw: number, rootPitch: number, rates: readonly number[], dt: number): void {
  if (!(dt > 0)) return;
  const count = links.length;
  if (dt > WING.maxDt) { for (let i = 0; i < count; i += 2) { links[i] = rootYaw; links[i + 1] = rootPitch; } vel.fill(0); return; }
  const n = Math.ceil(dt / WING.step - 1e-6), h = dt / n, damp = 2 * WING.chainDamping;
  for (let s = 0; s < n; s++) for (let i = 0; i < count; i++) {
    const r = rates[Math.min(i >> 1, rates.length - 1)], to = i < 2 ? (i === 0 ? rootYaw : rootPitch) : links[i - 2];
    vel[i] += (r * r * (to - links[i]) - damp * r * vel[i]) * h;
    links[i] += vel[i] * h;
  }
}

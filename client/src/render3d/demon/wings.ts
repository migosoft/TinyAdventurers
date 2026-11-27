// The demon's wings (#379, #442): what a pose asks of a wing and the chain of lagging parts that follows it. No pose keys a wing joint:
// a pose names a target, the arm follows the target, the hand the arm and the finger tips the hand, so every change gets its
// follow-through; `placeBones` (skeleton.ts) lays the three parts onto the wing's bones. The beat in the air is not a target: it turns
// the bones itself, from the pose's `beat` (skeleton.ts). The tail (and the legs hanging in the air) lag the same way, link after link
// (`chainStep`). Pure; nothing here allocates per frame.

/**
 * What a pose asks of a wing. `fold`: 0 fully open, 1 folded shut on the back (the rest). The others are rad on top of the stance's
 * wing: `raise` up about the chest's forward axis, `sweep` back, `pitch` the leading edge up (below 0 it tips forward, the face down).
 */
export interface WingTarget { fold: number; raise: number; sweep: number; pitch: number }
export interface WingState {
  arm: WingTarget; hand: WingTarget; tips: WingTarget; /** The parts' speeds. */ armV: WingTarget; handV: WingTarget; tipsV: WingTarget;
  /** The last step's target: a frame's steps ramp from it to the new one, so the frame rate does not shift the wing in time. */
  aim: WingTarget;
}

/**
 * Every tuning number of the wings' motion.
 * - `beat`: s per beat in the air (the spike's 1.5 beats a second); `down`: the down stroke's share of it. `rates`: 1/s the arm, the
 *   hand and the tips follow at (the arm and the hand critically damped, the tips with `tipDamping`, so they overshoot and flick).
 *   `maxDt`: a longer frame snaps; `step`: the longest step the springs take (a frame is cut into equal steps).
 * - `rest`: the standing wing, fully folded.
 * - `chainDamping`: of `chainStep`'s links; `tailRates`: 1/s the tail's links follow at, root to tip. `turn`: rad per rad/s the body
 *   turns, for the wings' sweep and the tail's root.
 */
export const WING = {
  beat: 1 / 1.5, down: 0.5, rates: [28, 20, 13], tipDamping: 0.6, maxDt: 0.1, step: 1 / 120,
  rest: { fold: 1, raise: 0, sweep: 0, pitch: 0 },
  chainDamping: 0.8, tailRates: [10, 9, 8, 7, 6, 5], turn: { sweep: 0.12, tail: 0.25 },
} as const;

/** A wing lying still on `rest`. */
export function newWing(rest: WingTarget): WingState {
  const at = (): WingTarget => ({ ...rest }), still = (): WingTarget => ({ fold: 0, raise: 0, sweep: 0, pitch: 0 });
  return { arm: at(), hand: at(), tips: at(), armV: still(), handV: still(), tipsV: still(), aim: at() };
}

// ---------------------------------------------------------------- the chain
const KEYS = ['fold', 'raise', 'sweep', 'pitch'] as const;
function snap(w: WingState, target: WingTarget): void {
  for (const k of KEYS) { w.arm[k] = w.hand[k] = w.tips[k] = w.aim[k] = target[k]; w.armV[k] = w.handV[k] = w.tipsV[k] = 0; }
}

/** Advances the chain; `dt` 0 changes nothing; `dt` over `WING.maxDt` snaps every part to the target. */
export function wingStep(w: WingState, target: WingTarget, dt: number): void {
  if (!(dt > 0)) return;
  if (dt > WING.maxDt) { snap(w, target); return; }
  const n = Math.ceil(dt / WING.step - 1e-6), h = dt / n, ra = WING.rates[0], rh = WING.rates[1], rt = WING.rates[2];
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
  }
  for (const k of KEYS) w.aim[k] = target[k];
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

// The lich's cloth (#358): the constants, the state of a cloth and its two steps, `clothMove` (before the pose) and `clothFollow` (after it).
import { ROBE_RINGS } from './rings';

export const CLOTH = { ringRate: [30, 3.4], maxLag: 4.4, lagPow: 1.3, turnRate: [30, 2.6], maxTurn: 0.75, speedRate: 8, glideRate: 5, glideSpeed: 22, tome: { at: [5.6, -0.35], rate: 7, max: 1.6 }, jump: 16, maxDt: 0.1 } as const;

/** Per ring: its centre as an offset from the lich in world directions (builder units) and its turn (world rad). */
export interface Cloth { rx: Float32Array; rz: Float32Array; rt: Float32Array; tomeX: number; tomeZ: number; vx: number; vz: number; glide: number; mx: number; mz: number; lastX: number; lastZ: number; started: boolean }

/** A cloth at rest: every ring at offset 0 with turn 0, nothing moving. */
export function newCloth(): Cloth {
  const n = ROBE_RINGS.length;
  return { rx: new Float32Array(n), rz: new Float32Array(n), rt: new Float32Array(n), tomeX: 0, tomeZ: 0, vx: 0, vz: 0, glide: 0, mx: 0, mz: 0, lastX: 0, lastZ: 0, started: false };
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const mixn = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Step 1, before the pose: the move since the last frame (`x`, `z` in builder units, world directions), the eased speed and `glide` (0..1). The first call, a move of more than `CLOTH.jump` units or a `dt` above `CLOTH.maxDt` marks the cloth for a reset. */
export function clothMove(c: Cloth, x: number, z: number, dt: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(z)) { c.started = false; c.mx = 0; c.mz = 0; c.vx = 0; c.vz = 0; c.glide = 0; return; } // a reset; `lastX` stays finite, the next finite call recovers
  if (c.started && dt <= 0) return; // nothing passes: nothing changes (`clothFollow` returns too)
  let mx = c.started ? x - c.lastX : 0, mz = c.started ? z - c.lastZ : 0;
  if (c.started && (!(Math.hypot(mx, mz) <= CLOTH.jump) || dt > CLOTH.maxDt)) { c.started = false; mx = 0; mz = 0; }
  c.lastX = x; c.lastZ = z; c.mx = mx; c.mz = mz;
  const e = c.started ? 1 : 0, inv = 1 / Math.max(dt, 1e-4);
  // a cloth for a reset takes its target at once (the spike's `ease` with `started` false)
  c.vx = e ? c.vx + (mx * inv - c.vx) * (1 - Math.exp(-dt * CLOTH.speedRate)) : mx * inv;
  c.vz = e ? c.vz + (mz * inv - c.vz) * (1 - Math.exp(-dt * CLOTH.speedRate)) : mz * inv;
  const to = Math.min(1, Math.hypot(c.vx, c.vz) / CLOTH.glideSpeed);
  c.glide = e ? c.glide + (to - c.glide) * (1 - Math.exp(-dt * CLOTH.glideRate)) : to;
}

/** Step 2, after the pose: every ring and the tome follow their place (`lean` from `ringLean`), the lower the slower, never further behind than its limit. A cloth marked for a reset is put at rest instead. */
export function clothFollow(c: Cloth, face: number, dt: number, lean: Float32Array): void {
  if (c.started && dt <= 0) return;
  const cf = Math.cos(face), sf = Math.sin(face), reset = !c.started;
  for (let i = 0; i < c.rx.length; i++) {
    const lag = Math.min(1, Math.max(0, ROBE_RINGS[i][4]));
    const lx = lean[i * 2], lz = lean[i * 2 + 1];
    const tx = lx * cf - lz * sf, tz = lx * sf + lz * cf; // the ring's place, world directions
    if (reset || lag === 0) { c.rx[i] = tx; c.rz[i] = tz; c.rt[i] = face; continue; }
    // the lich moved by (mx, mz): the offset from it changes the other way, which is what makes the hem trail
    let rx = c.rx[i] - c.mx, rz = c.rz[i] - c.mz;
    const f = 1 - Math.exp(-dt * mixn(CLOTH.ringRate[0], CLOTH.ringRate[1], lag)), maxLag = CLOTH.maxLag * lag ** CLOTH.lagPow;
    rx += (tx - rx) * f; rz += (tz - rz) * f;
    const ox = rx - tx, oz = rz - tz, ol = Math.hypot(ox, oz);
    if (ol > maxLag) { rx = tx + (ox / ol) * maxLag; rz = tz + (oz / ol) * maxLag; }
    c.rx[i] = rx; c.rz[i] = rz;
    let d = wrap(face - c.rt[i]);
    d -= d * (1 - Math.exp(-dt * mixn(CLOTH.turnRate[0], CLOTH.turnRate[1], lag)));
    d = Math.min(CLOTH.maxTurn * lag, Math.max(-CLOTH.maxTurn * lag, d));
    c.rt[i] = face - d;
  }
  const px = CLOTH.tome.at[0] * cf - CLOTH.tome.at[1] * sf, pz = CLOTH.tome.at[0] * sf + CLOTH.tome.at[1] * cf;
  if (reset) { c.tomeX = px; c.tomeZ = pz; } else {
    let x = c.tomeX - c.mx, z = c.tomeZ - c.mz;
    const f = 1 - Math.exp(-dt * CLOTH.tome.rate);
    x += (px - x) * f; z += (pz - z) * f;
    const ox = x - px, oz = z - pz, ol = Math.hypot(ox, oz);
    if (ol > CLOTH.tome.max) { x = px + (ox / ol) * CLOTH.tome.max; z = pz + (oz / ol) * CLOTH.tome.max; }
    c.tomeX = x; c.tomeZ = z;
  }
  c.started = true;
}

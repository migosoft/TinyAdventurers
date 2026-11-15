// The fireball explosion and the frost burst (#308, design §3), ported from the try-out (`magicStage.ts`, `fireBurst`/`frostBurst`) to the
// scalar form: a fireball (a Boom of k 0, 4 and 7) and the frost nova (k 10). A picture is a pure function of (age, seed, place, radius).
// The scorch and the frost star are floor marks and go to `out.lit` (they darken the lit floor); the rest is blended. The server's Blast
// and Magic flashes light these, so the client adds no light.
import { pushGlow } from '../cards';
import { hash3 } from './rand';
import { FX_KIND, registerFx, type FxFrame, type FxRec } from './effects3d';
import { BALL1, BALL2, clamp01, crystal, dot, easeOut, fireBall, fireColour, groundRing, PX, streak, thrown, type MV3, type V3 } from './shapes';
import type { FxTris } from './tris';
import type { FxCtx, FxOut } from './types';

const col: MV3 = [0, 0, 0], p0: MV3 = [0, 0, 0], vel: MV3 = [0, 0, 0], pa: MV3 = [0, 0, 0], pb: MV3 = [0, 0, 0];
const base: MV3 = [0, 0, 0], dir: MV3 = [0, 0, 0], grgb: MV3 = [0, 0, 0];
const SCORCH: V3 = [0.02, 0.015, 0.015], FLASH: V3 = [1, 0.8, 0.45], NOVA_RING: V3 = [0.9, 0.97, 1];
const SPARKS = 30, DUST = 44, MIST = 6, SHARDS = 18, STAR = 28;

/** The fireball at (x, z) tiles, `r` tiles across, `age` seconds old. */
export function fireBurst(out: FxOut, ctx: FxCtx, x: number, z: number, r: number, a: number, seed: number): void {
  const T = out.tris, sd = seed | 0;
  if (a >= 4) return;
  // the scorch stays a while
  groundRing(out.lit, x, z, 0.022, 0, r * 0.9, SCORCH, 0.5 * clamp01(a / 0.15) * clamp01((4 - a) / 2), 0);
  if (a < 1.7) {
    const grow = easeOut(a / 0.2), rr = r * (0.3 + 0.62 * grow) + 0.18 * a, fs = (sd & 1023) * 0.0137;
    fireBall(T, ctx.ballDetail === 2 ? BALL2 : BALL1, x, 0.55 + 0.55 * a, z, rr, a, fs * 3.3, 1.2 - a / 0.75, clamp01((a - 0.25) / 1.3), true);
    if (a < 0.4) fireBall(T, BALL1, x, 0.6 + 0.3 * a, z, rr * 0.55, a * 2, fs * 1.9, 1.4 - a / 0.5, clamp01(a / 0.4), true);
  }
  if (a < 0.45) {
    const k = easeOut(a / 0.35), rr = r * (0.25 + 1.05 * k);
    groundRing(T, x, z, 0.035, rr - 0.22, rr, FLASH, 0, 0.85 * (1 - a / 0.45));
  }
  const n = Math.round(SPARKS * ctx.detail);
  p0[0] = x; p0[1] = 0.5; p0[2] = z;
  for (let i = 0; i < n; i++) {
    const life = 0.45 + hash3(sd, i, 3) * 0.75;
    if (a > life) continue;
    const az = hash3(sd, i, 0) * Math.PI * 2, el = 0.15 + hash3(sd, i, 1) * 1.2, sp = 3.5 + hash3(sd, i, 2) * 6;
    vel[0] = Math.cos(az) * Math.cos(el) * sp; vel[1] = Math.sin(el) * sp; vel[2] = Math.sin(az) * Math.cos(el) * sp;
    const k = a / life;
    thrown(p0, vel, 13, a, pa);
    thrown(p0, vel, 13, Math.max(0, a - 0.045), pb);
    fireColour(1 - k * 0.6, col);
    streak(T, ctx.ax, pb, pa, PX, col, 0, (1 - k * k) * 0.95);
    dot(T, ctx.ax, pa[0], pa[1], pa[2], PX, col[0], col[1], col[2], 1 - k * k);
  }
  const I = a < 0.06 ? a / 0.06 : Math.exp(-(a - 0.06) / 0.38);
  if (I > 0.02) {
    grgb[0] = 0.75 * I; grgb[1] = 0.36 * I; grgb[2] = 0.1 * I;
    pushGlow(out.glows, x, 0.7 + 0.4 * a, z, r * 1.7, grgb, ctx.cam);
  }
}

/** The ice shards of the frost burst: they shoot out, stand, then break up one by one (all gone by 1.4 s). */
export function frostShards(T: FxTris, a: number, x: number, z: number, r: number, seed: number): void {
  const sd = seed | 0;
  for (let i = 0; i < SHARDS; i++) {
    const az = (i / SHARDS) * Math.PI * 2 + (hash3(sd, i, 10) - 0.5) * 0.4, tall = i % 3 === 0;
    const el = tall ? 0.9 + hash3(sd, i, 11) * 0.5 : 0.12 + hash3(sd, i, 11) * 0.55;
    const len = (tall ? 0.75 : 1) * r * (0.5 + hash3(sd, i, 12) * 0.42), w = 0.06 + hash3(sd, i, 13) * 0.07;
    const hold = 0.5 + hash3(sd, i, 14) * 0.55, start = hash3(sd, i, 15) * 0.05;
    const t = a - start;
    if (t < 0 || t > hold + 0.3) continue;
    const grow = Math.min(1, easeOut(t / 0.12) * 1.08), dying = clamp01((t - hold) / 0.3);
    dir[0] = Math.cos(az) * Math.cos(el); dir[1] = Math.sin(el); dir[2] = Math.sin(az) * Math.cos(el);
    base[0] = x + dir[0] * 0.12; base[1] = 0.05 - 0.25 * dying * dying; base[2] = z + dir[2] * 0.12;
    crystal(T, base, dir, len * grow * (1 - 0.2 * dying), w * (1 - 0.4 * dying), 0.92 * (1 - dying));
  }
}

const starR = (sd: number, i: number, r: number, k: number): number => r * (i % 2 ? 0.62 + hash3(sd, i, 20) * 0.2 : 0.95 + hash3(sd, i, 20) * 0.25) * k;

/** The frost nova at (x, z) tiles, `r` tiles across, `age` seconds old. */
export function frostBurst(out: FxOut, ctx: FxCtx, x: number, z: number, r: number, a: number, seed: number): void {
  const T = out.tris, sd = seed | 0;
  if (a >= 3.4) return;
  // the frost on the floor: a jagged star that stays a while
  const k = easeOut(a / 0.22), fade = clamp01((3.4 - a) / 1.6);
  for (let i = 0; i < STAR; i++) {
    const j = (i + 1) % STAR, a0 = (i / STAR) * Math.PI * 2, a1 = ((i + 1) / STAR) * Math.PI * 2, r0 = starR(sd, i, r, k), r1 = starR(sd, j, r, k);
    out.lit.tri(x, 0.024, z, x + Math.cos(a0) * r0, 0.024, z + Math.sin(a0) * r0, x + Math.cos(a1) * r1, 0.024, z + Math.sin(a1) * r1, 0.72, 0.9, 1, 0.5 * fade, 0.16 * fade, 0.16 * fade);
  }
  frostShards(T, a, x, z, r, sd);
  if (a < 0.4) {
    const kk = easeOut(a / 0.3), rr = r * (0.3 + 1.1 * kk);
    groundRing(T, x, z, 0.035, rr - 0.18, rr, NOVA_RING, 0, 0.8 * (1 - a / 0.4));
  }
  // ice dust: thrown out, slowed by the air, sinking, twinkling
  const n = Math.round(DUST * ctx.detail);
  for (let i = 0; i < n; i++) {
    const life = 0.9 + hash3(sd, i, 33) * 1.2;
    if (a > life) continue;
    const az = hash3(sd, i, 30) * Math.PI * 2, el = hash3(sd, i, 31) * 1.3, sp = 2.5 + hash3(sd, i, 32) * 5.5, ph = hash3(sd, i, 34) * 6.28;
    const d = (1 - Math.exp(-3.2 * a)) / 3.2;
    const tw = 0.45 + 0.55 * Math.sin(a * 17 + ph) ** 2, al = (1 - (a / life) ** 2) * tw;
    const cs = Math.cos(el) * sp * d;
    if (tw > 0.8) dot(T, ctx.ax, x + Math.cos(az) * cs, Math.max(0.03, 0.4 + Math.sin(el) * sp * d - 0.55 * a * a), z + Math.sin(az) * cs, PX, 1, 1, 1, al);
    else dot(T, ctx.ax, x + Math.cos(az) * cs, Math.max(0.03, 0.4 + Math.sin(el) * sp * d - 0.55 * a * a), z + Math.sin(az) * cs, PX, 0.7, 0.88, 1, al);
  }
  // cold mist low over the floor
  for (let i = 0; i < MIST; i++) {
    const life = 1.2 + hash3(sd, i, 41) * 0.8;
    if (a > life) continue;
    const az = hash3(sd, i, 40) * Math.PI * 2, kk = clamp01(a / life), f = Math.sin(Math.PI * Math.sqrt(kk)) * 0.16, d = r * (0.3 + 0.6 * easeOut(a / 0.8));
    grgb[0] = 0.4 * f; grgb[1] = 0.62 * f; grgb[2] = 0.9 * f;
    pushGlow(out.glows, x + Math.cos(az) * d, 0.25 + 0.2 * kk, z + Math.sin(az) * d, 0.7 + 0.5 * kk, grgb, ctx.cam);
  }
  const I = a < 0.05 ? a / 0.05 : Math.exp(-(a - 0.05) / 0.5);
  if (I > 0.02) {
    grgb[0] = 0.2 * I; grgb[1] = 0.38 * I; grgb[2] = 0.7 * I;
    pushGlow(out.glows, x, 0.6, z, r * 1.5, grgb, ctx.cam);
  }
}

/** Registers the drawers of the fireball (k 0, 4, 7) and the frost nova (k 10); `rec.b` is the radius in tiles. */
export function registerBursts(): void {
  registerFx(FX_KIND.FireBlast, (out: FxOut, f: FxFrame, rec: FxRec, age: number) => { fireBurst(out, f.ctx, rec.x, rec.z, rec.b, age, rec.seed); });
  registerFx(FX_KIND.FrostNova, (out: FxOut, f: FxFrame, rec: FxRec, age: number) => { frostBurst(out, f.ctx, rec.x, rec.z, rec.b, age, rec.seed); });
}

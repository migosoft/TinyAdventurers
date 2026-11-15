// The other booms, the chain spark, deaths, raised minions, immune marks and hit sparks in 3D (#308, design §6 "Events"). The 2D
// originals are in `game/effects.ts` and `game/PhaserRunView.ts`; the trigger, place and life are theirs, the looks are the plan's table.
// Every picture is a pure function of (age, seed, the record's numbers). The fireball and the frost nova are in `bursts.ts`.
// Glow by themselves: rings, sparks, motes, bolts. Lit (they take the light of the room): stone chunks, dust, wood chips, blood and bone.
import { LIGHT_KIND } from '../../generated/defs';
import { FX_KIND, registerFx, type FxFrame, type FxRec } from './effects3d';
import { GLOOM, RAISE_LOOKS, SKELETAL } from '../../game/fxLooks';
import type { Cand } from '../lights';
import { pushGlow } from '../cards';
import { hash3, noise3 } from './rand';
import { BALL1, burst, clamp01, dot, easeOut, fireBall, groundRing, lerp, PX, streak, type BurstSpec, type MV3 } from './shapes';
import type { FxTris } from './tris';
import { FX_LIGHT_CAP, type DrawnFig, type FxCtx, type FxOut } from './types';

const rgbIn = (c: number, out: MV3): MV3 => { out[0] = ((c >> 16) & 255) / 255; out[1] = ((c >> 8) & 255) / 255; out[2] = (c & 255) / 255; return out; };
const c0: MV3 = [0, 0, 0], c1: MV3 = [0, 0, 0], gl: MV3 = [0, 0, 0];
const pa: MV3 = [0, 0, 0], pb: MV3 = [0, 0, 0];

/** A burst spec made once; the drawer sets its place and count (`n` scaled by the detail) before each use. */
function spec(n: number, speed: readonly [number, number], up: readonly [number, number], life: readonly [number, number], g: number, drag: number, size: number, colours: readonly number[], streakOn: boolean): BurstSpec {
  return { x: 0, y: 0, z: 0, n, speed, up, life, g, drag, size, colours, streak: streakOn };
}
function run(T: FxTris, ctx: FxCtx, s: BurstSpec, base: number, x: number, y: number, z: number, age: number, seed: number): void {
  s.x = x; s.y = y; s.z = z; s.n = Math.max(1, Math.round(base * ctx.detail));
  burst(T, ctx.ax, s, age, seed);
}

/** Adds a client light unless the frame's cap is reached (a light of an unseen event would give it away; `event` drops those). */
export function addLight(out: FxOut, id: string, x: number, y: number, z: number, radius: number, r: number, g: number, b: number, kind: number): void {
  if (out.lights.length >= FX_LIGHT_CAP) return;
  const lc: Cand = { id, kind, x, y, z, radius, r, g, b, shadow: false, skip: -1, base: Math.max(r, g, b) };
  out.lights.push(lc);
}

const figNear = (figs: readonly DrawnFig[], x: number, z: number, lim: number): DrawnFig | null => {
  let best: DrawnFig | null = null, bd = lim * lim;
  for (let i = 0; i < figs.length; i++) {
    const f = figs[i], d = (f.x - x) ** 2 + (f.z - z) ** 2;
    if (d < bd) { bd = d; best = f; }
  }
  return best;
};

// ---- Dmg ----
const DMG_WHITE = spec(5, [2, 4], [-0.4, 1.2], [0.15, 0.25], 0, 0, PX, [0xffffff], true);
const DMG_RED = spec(5, [2, 4], [-0.4, 1.2], [0.15, 0.25], 0, 0, PX, [0xff4040], true);
function drawDmg(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const fig = figNear(f.figs, rec.x, rec.z, 1);
  run(out.tris, f.ctx, rec.a ? DMG_RED : DMG_WHITE, 5, rec.x, fig ? fig.top / 2 : 0.5, rec.z, age, rec.seed);
}

// ---- Boom k 1 and 13: the healing ring ----
const GOLD_MOTES = [0xffe070, 0xfff0b0];
const HOLY_A: V = [1, 0.88, 0.44], HOLY_B: V = [1, 0.94, 0.69];
type V = readonly [number, number, number];
function drawHoly(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const T = out.tris, r = rec.b, sd = rec.seed | 0;
  const rr = r * easeOut(age / 0.35);
  groundRing(T, rec.x, rec.z, 0.04, Math.max(0, rr - 0.22), rr, rec.a === 13 ? HOLY_B : HOLY_A, 0, 0.85 * (1 - age / 0.8));
  for (let i = 0; i < 16; i++) {
    const born = hash3(sd, i, 0) * 0.3, t = age - born;
    if (t < 0 || t > 0.5) continue;
    const az = hash3(sd, i, 1) * Math.PI * 2, d = 0.3 * r * Math.sqrt(hash3(sd, i, 2));
    rgbIn(GOLD_MOTES[i & 1], c0);
    dot(T, f.ctx.ax, rec.x + Math.cos(az) * d, 0.1 + t * (0.9 + hash3(sd, i, 3) * 0.8), rec.z + Math.sin(az) * d, PX * 1.2, c0[0], c0[1], c0[2], 1 - (t / 0.5) ** 2);
  }
}

// ---- Boom k 2: flame tongues racing out ----
const FLAME_SPARKS = spec(20, [2, 5], [0.1, 1.2], [0.3, 0.7], 6, 0, PX, [0xff8030, 0xffd040], false);
function drawFlame(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const T = out.tris, r = rec.b, sd = rec.seed | 0, ctx = f.ctx;
  if (age < 0.5) {
    const n = Math.max(4, Math.round(24 * ctx.detail)), k = easeOut(age / 0.5), hole = clamp01((age - 0.15) / 0.35);
    for (let i = 0; i < n; i++) {
      const az = (i / n) * Math.PI * 2 + (hash3(sd, i, 0) - 0.5) * 0.2, d = 2 * r * k * (0.6 + 0.4 * hash3(sd, i, 1));
      fireBall(T, BALL1, rec.x + Math.cos(az) * d, 0.2 + 0.2 * hash3(sd, i, 2) + age * 0.3, rec.z + Math.sin(az) * d, 0.12, age, hash3(sd, i, 3) * 20, 1.1 - age, hole, true);
    }
  }
  run(T, ctx, FLAME_SPARKS, 20, rec.x, 0.3, rec.z, age, rec.seed);
  const I = Math.exp(-age / 0.3);
  addLight(out, `bk${rec.seed}`, rec.x, 0.8, rec.z, 2 * r + 1, 1.3 * I, 0.6 * I, 0.2 * I, LIGHT_KIND.Blast);
}

// ---- Boom k 5: the slam ----
const DUST_COL: V = [0.55, 0.5, 0.41];
const CHUNK_A = spec(14, [1, 2], [0.4, 1.3], [0.6, 0.9], 13, 0, 0.13, [0x8a7a68, 0x6a5a48], false);
const CHUNK_B = spec(14, [1, 2], [0.4, 1.3], [0.6, 0.9], 13, 0, 0.08, [0x4a3a2c], false);
function drawSlam(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const r = rec.b, sd = rec.seed | 0, ctx = f.ctx, L = out.lit;
  const rr = r * easeOut(age / 0.35);
  groundRing(L, rec.x, rec.z, 0.03, Math.max(0, rr - 0.3), rr, DUST_COL, 0, 0.55 * (1 - age / 0.9));
  // the chunks fly with a speed that grows with the radius; the second, smaller dot rides on the first
  for (const s of [CHUNK_A, CHUNK_B]) {
    s.speed = r > 0 ? SLAM_SPEED(r) : s.speed;
    run(L, ctx, s, 14, rec.x, 0.15, rec.z, age, rec.seed);
  }
  for (let i = 0; i < 6; i++) {
    const t = age - hash3(sd, i, 0) * 0.15;
    if (t < 0 || t > 0.7) continue;
    const az = hash3(sd, i, 1) * Math.PI * 2, d = r * (0.3 + 0.6 * hash3(sd, i, 2)) * easeOut(t / 0.4);
    dot(L, ctx.ax, rec.x + Math.cos(az) * d, 0.15 + t * 0.7, rec.z + Math.sin(az) * d, 0.34 + t * 0.3, 0.45, 0.4, 0.33, 0.4 * (1 - t / 0.7));
  }
}
const slamSpeeds = new Map<number, readonly [number, number]>();
function SLAM_SPEED(r: number): readonly [number, number] {
  const key = Math.round(r * 100);
  let v = slamSpeeds.get(key);
  if (!v) { v = [0.7 * r + 0.5, 1.3 * r + 1]; slamSpeeds.set(key, v); }
  return v;
}

// ---- Boom k 6: the gloom nova ----
const GLOOM_SPARKS = spec(24, [2, 4], [0, 0.9], [0.3, 0.6], 0, 0, PX, [GLOOM.spark, GLOOM.light], false);
const gx = new Float32Array(BALL1.n), gy = new Float32Array(BALL1.n), gz = new Float32Array(BALL1.n), gh = new Float32Array(BALL1.n);
/** A lumpy sphere in flat gloom colours (the fireball's geometry without its fire ramp). */
function gloomBall(T: FxTris, cx: number, cy: number, cz: number, r: number, t: number, seed: number, alpha: number): void {
  const v = BALL1.v, n = BALL1.n;
  for (let i = 0; i < n; i++) {
    const dx = v[i * 3], dy = v[i * 3 + 1], dz = v[i * 3 + 2];
    const nz = noise3(dx * 2.1 + seed, dy * 2.1 - t * 1.6, dz * 2.1 + seed * 0.7);
    const rr = r * (0.8 + 0.4 * nz);
    gx[i] = cx + dx * rr; gy[i] = Math.max(0.03, cy + dy * rr); gz[i] = cz + dz * rr; gh[i] = nz;
  }
  rgbIn(GLOOM.dark, c0); rgbIn(GLOOM.mid, c1);
  const f = BALL1.f;
  for (let k = 0; k < f.length; k += 3) {
    const a = f[k], b = f[k + 1], c = f[k + 2], h = (gh[a] + gh[b] + gh[c]) / 3;
    T.tri(gx[a], gy[a], gz[a], gx[b], gy[b], gz[b], gx[c], gy[c], gz[c], lerp(c0[0], c1[0], h), lerp(c0[1], c1[1], h), lerp(c0[2], c1[2], h), alpha);
  }
}
function drawGloom(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const T = out.tris, r = rec.b, sd = rec.seed | 0, ctx = f.ctx;
  if (age < 0.8) gloomBall(T, rec.x, 0.45, rec.z, r * (0.2 + 0.8 * easeOut(age / 0.4)), age, (sd & 1023) * 0.0137, 0.35 * (1 - clamp01((age - 0.4) / 0.4)));
  GLOOM_SPARKS.speed = SLAM_SPEED(r);
  run(T, ctx, GLOOM_SPARKS, 24, rec.x, 0.4, rec.z, age, rec.seed);
  rgbIn(GLOOM.dark, c0);
  for (let i = 0; i < 8; i++) {
    const t = age - hash3(sd, i, 0) * 0.2;
    if (t < 0 || t > 0.6) continue;
    const az = hash3(sd, i, 1) * Math.PI * 2, d = r * (0.2 + 0.7 * hash3(sd, i, 2));
    dot(T, ctx.ax, rec.x + Math.cos(az) * d, 0.2 + t * 0.9, rec.z + Math.sin(az) * d, 0.28, c0[0], c0[1], c0[2], 0.5 * (1 - t / 0.6));
  }
  const I = Math.exp(-age / 0.35);
  addLight(out, `bg${rec.seed}`, rec.x, 0.7, rec.z, r + 2, 0.7 * I, 0.3 * I, 1.1 * I, LIGHT_KIND.Magic);
}

// ---- Boom k 8 (and the barrel's k 7): wood chips ----
const CHIPS = spec(16, [2, 4.5], [0.3, 1.3], [0.5, 0.9], 13, 0, 0.07, [0x8a5a2a, 0x6a4020, 0xa0703a, 0x5a3418], false);
function drawSplinters(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  run(out.lit, f.ctx, CHIPS, 16, rec.x, 0.25, rec.z, age, rec.seed);
  if (age < 0.7) dot(out.lit, f.ctx.ax, rec.x, 0.2 + age * 0.5, rec.z, 0.3 + age * 0.3, 0.42, 0.34, 0.24, 0.45 * (1 - age / 0.7));
}

// ---- Boom k 9: nature sparkles ----
const GREENS = [0x60c050, 0x90e070];
function drawNature(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const T = out.tris, sd = rec.seed | 0, R = Math.max(rec.b, 0.4);
  for (let i = 0; i < 18; i++) {
    const t = age - hash3(sd, i, 0) * 0.25;
    if (t < 0 || t > 0.55) continue;
    const az = hash3(sd, i, 1) * Math.PI * 2, d = R * Math.sqrt(hash3(sd, i, 2));
    rgbIn(GREENS[i & 1], c0);
    dot(T, f.ctx.ax, rec.x + Math.cos(az) * d, 0.1 + t * (0.8 + hash3(sd, i, 3)), rec.z + Math.sin(az) * d, PX * 1.4, c0[0], c0[1], c0[2], 1 - (t / 0.55) ** 2);
  }
  const I = 0.18 * (1 - age / 0.8);
  gl[0] = 0.25 * I * 5; gl[1] = 0.7 * I * 3; gl[2] = 0.2 * I * 5;
  pushGlow(out.glows, rec.x, 0.4, rec.z, R * 1.4, gl, f.ctx.cam);
}

// ---- Boom k 11 and 12: the war cry and the sparks ring ----
const SHOCK: V = [1, 0.376, 0.125], YELLOW: V = [1, 0.88, 0.25];
function drawShock(out: FxOut, _f: FxFrame, rec: FxRec, age: number): void {
  const r = rec.b, rr = r * easeOut(age / 0.5), k = 1 - age / 0.5;
  groundRing(out.tris, rec.x, rec.z, 0.04, Math.max(0, rr - 0.2), rr, SHOCK, 0, 0.85 * k);
  groundRing(out.tris, rec.x, rec.z, 0.4 * r, Math.max(0, rr * 0.8 - 0.1), rr * 0.8, SHOCK, 0, 0.3 * k);
}
function drawSparks(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const r = rec.b, rr = r * easeOut(age / 0.5), k = 1 - age / 0.5, sd = rec.seed | 0;
  groundRing(out.tris, rec.x, rec.z, 0.04, Math.max(0, rr - 0.2), rr, YELLOW, 0, 0.85 * k);
  c0[0] = YELLOW[0]; c0[1] = YELLOW[1]; c0[2] = YELLOW[2];
  for (let i = 0; i < 10; i++) {
    const az = (i / 10) * Math.PI * 2 + hash3(sd, i, 0) * 0.5, d = rr * 0.9, y = 0.05 + age * (1 + hash3(sd, i, 1));
    pa[0] = rec.x + Math.cos(az) * d; pa[1] = y; pa[2] = rec.z + Math.sin(az) * d;
    pb[0] = pa[0]; pb[1] = y + 0.25; pb[2] = pa[2];
    streak(out.tris, f.ctx.ax, pa, pb, PX, c0, 0, 0.9 * k);
  }
}

// ---- Zap ----
const VIOLET: V = [0.69, 0.56, 1], WHITE: V = [1, 1, 1];
const ZAP_N = 8;
function zapPoint(rec: FxRec, i: number, step: number, out: MV3): MV3 {
  const k = i / ZAP_N, x2 = rec.a, z2 = rec.b, dx = x2 - rec.x, dz = z2 - rec.z, len = Math.hypot(dx, dz) || 1;
  const edge = i === 0 || i === ZAP_N ? 0 : 1, sd = rec.seed | 0;
  const off = (hash3(sd, i + step * 16, 0) * 2 - 1) * 0.12 * edge, up = (hash3(sd, i + step * 16, 1) * 2 - 1) * 0.1 * edge;
  out[0] = rec.x + dx * k - (dz / len) * off; out[1] = 0.5 + up; out[2] = rec.z + dz * k + (dx / len) * off;
  return out;
}
function drawZap(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const step = age < 0.06 ? 0 : age < 0.12 ? 1 : 2, k = 1 - age / 0.18;
  for (let i = 0; i < ZAP_N; i++) {
    zapPoint(rec, i, step, pa); zapPoint(rec, i + 1, step, pb);
    streak(out.tris, f.ctx.ax, pa, pb, 0.12, VIOLET, 0.9 * k, 0.9 * k);
    streak(out.tris, f.ctx.ax, pa, pb, 0.04, WHITE, k, k);
  }
  addLight(out, `zp${rec.seed}.0`, rec.x, 0.5, rec.z, 3, 0.85 * k, 0.6 * k, 1.4 * k, LIGHT_KIND.Magic);
  addLight(out, `zp${rec.seed}.1`, rec.a, 0.5, rec.b, 3, 0.85 * k, 0.6 * k, 1.4 * k, LIGHT_KIND.Magic);
}

// ---- Died ----
const BLOOD = spec(14, [0.8, 2.5], [0.2, 1.2], [0.3, 0.6], 6, 0, 0.07, [0x9a2020], false);
const BONE = spec(14, [0.8, 2.5], [0.2, 1.2], [0.3, 0.6], 6, 0, 0.07, [0xe8e4d0], false);
const GOLD = spec(24, [1.5, 4], [-0.2, 1.3], [0.4, 0.9], 3, 0, PX, [0xffe060, 0xfff0a0], false);
/** The body's middle height, remembered from the first frame (the figure is gone a moment later). */
function midOf(f: FxFrame, rec: FxRec): number {
  if (rec.c === 0) {
    const fig = rec.follow >= 0 ? f.figs.find((g) => g.id === rec.follow) : undefined;
    rec.b = fig ? fig.top / 2 : 0.5;
    rec.c = 1;
  }
  return rec.b;
}
function drawDied(out: FxOut, f: FxFrame, rec: FxRec, age: number, boss: boolean): boolean {
  if (f.hidden.has(rec.follow)) return false;
  const y = midOf(f, rec), bone = SKELETAL.has(rec.a), s = bone ? BONE : BLOOD;
  run(out.lit, f.ctx, s, 14, rec.x, y, rec.z, age, rec.seed);
  if (!boss) return true;
  run(out.tris, f.ctx, GOLD, 24, rec.x, 0.6, rec.z, age, rec.seed ^ 0x5bd1);
  const I = Math.exp(-age / 0.4);
  gl[0] = 1.4 * 0.6 * I; gl[1] = 1.2 * 0.6 * I; gl[2] = 0.5 * 0.6 * I;
  pushGlow(out.glows, rec.x, 0.6, rec.z, 2, gl, f.ctx.cam);
  addLight(out, `dk${rec.seed}`, rec.x, 0.8, rec.z, 5, 1.4 * I, 1.2 * I, 0.5 * I, LIGHT_KIND.Blast);
  return true;
}
function drawDiedGhost(out: FxOut, f: FxFrame, rec: FxRec, age: number): boolean {
  if (f.hidden.has(rec.follow)) return false;
  const y = midOf(f, rec), sd = rec.seed | 0;
  for (let i = 0; i < 24; i++) {
    const az = hash3(sd, i, 0) * Math.PI * 2, d = 0.2 * hash3(sd, i, 1), vy = 0.9 + 1.6 * hash3(sd, i, 2), life = 0.6 + 0.4 * hash3(sd, i, 3);
    if (age > life) continue;
    const k = age / life;
    dot(out.tris, f.ctx.ax, rec.x + Math.cos(az) * d + (hash3(sd, i, 4) - 0.5) * 0.3 * age, y + vy * age * 0.7, rec.z + Math.sin(az) * d, PX * 1.2, 0.85, 0.93, 1, (1 - k) * (1 - k));
  }
  gl[0] = 0.2 * (1 - age); gl[1] = 0.28 * (1 - age); gl[2] = 0.36 * (1 - age);
  pushGlow(out.glows, rec.x, y, rec.z, 0.9, gl, f.ctx.cam);
  return true;
}

// ---- Raise ----
function drawRaise(out: FxOut, f: FxFrame, rec: FxRec, age: number): void {
  const look = RAISE_LOOKS[rec.a];
  if (!look) return;
  const sd = rec.seed | 0, T = out.tris;
  rgbIn(look.ring, c0);
  const rr = 0.7 * easeOut(age / 0.4);
  groundRing(T, rec.x, rec.z, 0.04, Math.max(0, rr - 0.12), rr, c0, 0, 0.8 * (1 - age / 0.9));
  for (let i = 0; i < 14; i++) {
    const t = age - hash3(sd, i, 0) * 0.2;
    if (t < 0 || t > 0.7) continue;
    const m = look.motes[i % look.motes.length];
    rgbIn(m, c1);
    const az = hash3(sd, i, 1) * Math.PI * 2, d = 0.4 * Math.sqrt(hash3(sd, i, 2)), big = rec.a === 2 && (i % 3 !== 0);
    dot(T, f.ctx.ax, rec.x + Math.cos(az) * d, 0.05 + t * (0.9 + hash3(sd, i, 3) * 1.4), rec.z + Math.sin(az) * d, big ? PX * 1.6 : PX * 1.2, c1[0], c1[1], c1[2], 1 - (t / 0.7) ** 2);
  }
  const I = 0.5 * (1 - age / 0.9);
  gl[0] = c0[0] * I; gl[1] = c0[1] * I; gl[2] = c0[2] * I;
  pushGlow(out.glows, rec.x, 0.3, rec.z, 1.1, gl, f.ctx.cam);
}

// ---- Immune ----
const PALE: V = [0.62, 0.85, 1];
function drawImmune(out: FxOut, _f: FxFrame, rec: FxRec, age: number): void {
  groundRing(out.tris, rec.x, rec.z, 0.5, 0.38, 0.45, PALE, 0.9 * (1 - age / 0.3), 0.9 * (1 - age / 0.3));
}

/** Registers the drawers of the booms other than the fireball and the frost nova, and of Dmg, Zap, Died, Raise and Immune. */
export function registerBooms(): void {
  registerFx(FX_KIND.Dmg, (o, f, r, a) => { drawDmg(o, f, r, a); });
  registerFx(FX_KIND.Holy, (o, f, r, a) => { drawHoly(o, f, r, a); });
  registerFx(FX_KIND.Flame, (o, f, r, a) => { drawFlame(o, f, r, a); });
  registerFx(FX_KIND.Slam, (o, f, r, a) => { drawSlam(o, f, r, a); });
  registerFx(FX_KIND.Gloom, (o, f, r, a) => { drawGloom(o, f, r, a); });
  registerFx(FX_KIND.Splinters, (o, f, r, a) => { drawSplinters(o, f, r, a); });
  registerFx(FX_KIND.Nature, (o, f, r, a) => { drawNature(o, f, r, a); });
  registerFx(FX_KIND.Shock, (o, f, r, a) => { drawShock(o, f, r, a); });
  registerFx(FX_KIND.Sparks, (o, f, r, a) => { drawSparks(o, f, r, a); });
  registerFx(FX_KIND.Zap, (o, f, r, a) => { drawZap(o, f, r, a); });
  registerFx(FX_KIND.Died, (o, f, r, a) => drawDied(o, f, r, a, false));
  registerFx(FX_KIND.DiedBoss, (o, f, r, a) => drawDied(o, f, r, a, true));
  registerFx(FX_KIND.DiedGhost, (o, f, r, a) => drawDiedGhost(o, f, r, a));
  registerFx(FX_KIND.Raise, (o, f, r, a) => { drawRaise(o, f, r, a); });
  registerFx(FX_KIND.Immune, (o, f, r, a) => { drawImmune(o, f, r, a); });
}

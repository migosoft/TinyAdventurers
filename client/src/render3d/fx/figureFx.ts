// The effects tied to the figures of a frame in 3D (#308, design §6 "Figures"): the swoosh and the fangs (cards and models alike), the
// channel's swirl, the release sparks, the lich's nova wind-up, the slam telegraph on the floor, the dragon's breath and bite, the stone
// gaze, the lich's drain and the mimic's wake and landing. The trigger, place and timing come from the figure's state. Each picture is a pure
// function of the figure's `animT` (and the clock for pulses); the one-shot sparks are records, started once per action.
import { ANIM, EFFECT, KIND, LIGHT_KIND } from '../../generated/defs';
import { addLight } from './booms';
import { has } from '../../game/effectBits';
import { GLOOM, gazePulse } from '../../game/fxLooks';
import { MELEE_T } from '../../game/anim/pose';
import { isWindup } from '../../game/anim/defs';
import { TILE } from '../../sim/map';
import { pushGlow } from '../cards';
import { fangTris, FX_WHITE, swirlTris, swooshTris } from '../models/fx';
import { FX_KIND, registerFrameFx, registerFx, type Effects3d, type FxFrame, type FxRec } from './effects3d';
import { hash3 } from './rand';
import { burst, dot, groundDisc, groundRing, PX, streak, type BurstSpec, type MV3 } from './shapes';
import type { FxTris } from './tris';
import type { DrawnFig, FxCtx, FxOut } from './types';

const rgbIn = (c: number, out: MV3): MV3 => { out[0] = ((c >> 16) & 255) / 255; out[1] = ((c >> 8) & 255) / 255; out[2] = (c & 255) / 255; return out; };
const c0: MV3 = [0, 0, 0], c1: MV3 = [0, 0, 0], gl: MV3 = [0, 0, 0];
const pa: MV3 = [0, 0, 0], pb: MV3 = [0, 0, 0], tipAt: MV3 = [0, 0, 0];

/** The camera passes stretch the figure by 1 / cos(pitch): so are the heights of the effects that sit on it. */
export const stretchOf = (ctx: FxCtx): number => 1 / Math.cos(ctx.cam.pitch);

/** A figure that is stone, ice or asleep holds its pose and shows none of these. */
const still = (f: DrawnFig): boolean => has(f.effects, EFFECT.Petrified) || has(f.effects, EFFECT.Frozen) || has(f.effects, EFFECT.Sleep);

/** True the first time an action is seen: a figure's anim and the clock it began at (`now - animT`) make the key. */
function fresh(fx: Effects3d, f: DrawnFig, now: number): boolean {
  const start = now - f.animT, m = fx.actions.get(f.id);
  if (m && m.anim === f.anim && Math.abs(m.start - start) < 0.2) { m.seen = now; return false; }
  if (m) { m.anim = f.anim; m.start = start; m.seen = now; } else fx.actions.set(f.id, { anim: f.anim, start, seen: now });
  return true;
}

/** A release spark shows only at the release: a figure first seen later in its action (it came into view) gets none. */
const RELEASE_WINDOW = 0.1;

// ---- the swoosh ----
/** The swoosh of a melee swing (or the dragon's tail), at the swing's own reach and arc: armed or not, card or model. */
function swoosh(T: FxTris, f: DrawnFig): void {
  const a = f.anim;
  if ((a !== ANIM.Melee && a !== ANIM.Tail) || f.bite >= 0) return;
  const d = f.def, tail = a === ANIM.Tail, sw = tail ? d.tail : d.swing;
  if (!sw) return;
  if (tail && d.weapon) return;
  const wind = d.windups?.[a] ?? 0;
  swooshTris(T, f.x, f.z, f.swingY, tail ? f.yaw + Math.PI : f.yaw, sw.reach, tail ? sw.arc : f.arc, f.spectre?.swoosh.colour ?? sw.color ?? FX_WHITE, (f.animT - wind) / MELEE_T, f.spectre?.swoosh.head);
}

// ---- the halo of a spectre ----
/** The light's height above the foot (px), and the alpha under which a figure shows no halo (the same gate as the other figure effects). */
const HALO = { lightUp: 5, minAlpha: 0.05 } as const;
const glowRgb: MV3 = [0, 0, 0];
/** A soft glow on the body (not lifted toward the camera: it is drawn with the figure) and a light on the floor, both of the figure's alpha over the see-through peak. */
function halo(out: FxOut, frame: FxFrame): void {
  const ctx = frame.ctx, st = stretchOf(ctx);
  for (let i = 0; i < frame.figs.length; i++) {
    const f = frame.figs[i], h = f.spectre?.halo;
    if (!h || frame.hidden.has(f.id) || f.alpha < HALO.minAlpha || has(f.effects, EFFECT.Petrified)) continue;
    const k = f.alpha / (f.spectre?.seeThrough?.peak ?? 1);
    rgbIn(h.glow, glowRgb);
    glowRgb[0] *= h.k * k; glowRgb[1] *= h.k * k; glowRgb[2] *= h.k * k;
    pushGlow(out.glows, f.x, f.foot + h.height * PX * st, f.z, h.size * PX, glowRgb, ctx.cam, undefined, 0);
    rgbIn(h.light, c0);
    addLight(out, `gh${f.id}`, f.x, f.foot + HALO.lightUp * PX, f.z, h.radius, c0[0] * k, c0[1] * k, c0[2] * k, LIGHT_KIND.Magic);
  }
}

// ---- the sparks of a release ----
/** The colour both sparks of a record take (written before each burst). */
const SPARK_COLOUR = [0xffffff];
const SPARK_SHOT: BurstSpec = { x: 0, y: 0, z: 0, n: 5, speed: [3, 4.5], up: [-0.6, 1.2], life: [0.12, 0.2], g: 0, drag: 0, size: PX, colours: SPARK_COLOUR, streak: true };
const SPARK_MOTES: BurstSpec = { x: 0, y: 0, z: 0, n: 6, speed: [1.6, 3.2], up: [-0.4, 1.2], life: [0.15, 0.3], g: 3, drag: 0, size: PX * 1.5, colours: SPARK_COLOUR, streak: false };

/** Starts the spark of a bow, staff or unarmed release, once per action, and of the dragon's bite. */
function releases(fx: Effects3d, f: DrawnFig, now: number, up: number): void {
  const d = f.def, a = f.anim;
  let colour = -1, y = f.hand[1];
  if (a === ANIM.Bite) {
    const wind = d.windups?.[ANIM.Bite] ?? 0;
    if (d.bite && f.animT >= wind && f.animT - wind < RELEASE_WINDOW && fresh(fx, f, now)) {
      fx.emit(FX_KIND.Spark, now, f.x + Math.cos(f.aim) * d.bite.reach / TILE, f.z + Math.sin(f.aim) * d.bite.reach / TILE, -1, d.bite.color, 6, y);
    }
    return;
  }
  if (d.mount === 'bow') { if (a === ANIM.Shoot) colour = 0xfff0c0; }
  else if (d.mount === 'staff') {
    if (a === ANIM.Cast || a === ANIM.Shoot || a === ANIM.Channel) { colour = d.weaponTint ?? 0xc0a0ff; y += 10 / TILE * up; }
  } else if (!d.weapon && a === ANIM.Shoot) colour = d.base;
  if (colour >= 0 && f.animT < RELEASE_WINDOW && fresh(fx, f, now)) fx.emit(FX_KIND.Spark, now, f.hand[0], f.hand[2], -1, colour, 0, y);
}

/** The Spark record: five short streaks (a hit spark), and motes when `b` asks for them. */
function drawSpark(out: FxOut, frame: FxFrame, rec: FxRec, age: number): void {
  SPARK_COLOUR[0] = rec.a & 0xffffff;
  SPARK_SHOT.x = rec.x; SPARK_SHOT.y = rec.c; SPARK_SHOT.z = rec.z;
  burst(out.tris, frame.ctx.ax, SPARK_SHOT, age, rec.seed);
  if (rec.b > 0) {
    SPARK_MOTES.x = rec.x; SPARK_MOTES.y = rec.c; SPARK_MOTES.z = rec.z; SPARK_MOTES.n = rec.b;
    burst(out.tris, frame.ctx.ax, SPARK_MOTES, age, rec.seed ^ 0x5bd1);
  }
}

// ---- the lich's nova wind-up ----
/** Gloom sparks gather at the staff tip (3 per 0.1 s) and a violet glow breathes there. */
function novaWindup(out: FxOut, frame: FxFrame, f: DrawnFig, tipUp: number): void {
  const ctx = frame.ctx, T = out.tris, n = Math.max(3, Math.round(9 * ctx.detail));
  // a built figure names its own gem; a card's sparks gather at the staff tip
  let g = f.gem;
  if (!g) { tipAt[0] = f.hand[0]; tipAt[1] = f.hand[1] + tipUp; tipAt[2] = f.hand[2]; g = tipAt; }
  const ty = g[1];
  for (let i = 0; i < n; i++) {
    const t = f.animT / 0.3 + i / n, cyc = Math.floor(t), ph = t - cyc, sd = f.id * 31 + i;
    const dark = hash3(sd, cyc, 0) < 0.5;
    rgbIn(dark ? GLOOM.dark : GLOOM.spark, c0);
    const dx = (hash3(sd, cyc, 1) - 0.5) * 20 * 0.3 * ph / TILE, dy = (hash3(sd, cyc, 2) - 0.5) * 20 * 0.3 * ph / TILE, dz = (hash3(sd, cyc, 3) - 0.5) * 20 * 0.3 * ph / TILE;
    dot(T, ctx.ax, g[0] + dx, ty + dy, g[2] + dz, dark ? PX * 1.6 : PX, c0[0], c0[1], c0[2], 1 - ph * ph);
  }
  const pulse = 0.75 + 0.25 * Math.sin(frame.ctx.now * 14);
  gl[0] = 0.5 * pulse; gl[1] = 0.2 * pulse; gl[2] = 0.95 * pulse;
  pushGlow(out.glows, g[0], ty, g[2], 0.4, gl, ctx.cam);
}

// ---- the slam telegraph ----
const EDGE: MV3 = [0, 0, 0], FILL: MV3 = [0, 0, 0];
/** The danger zone on the floor at the real hit radius, filling from the middle until the blow lands; the lich's in gloom with wisps drawn in from the edge. */
function telegraph(out: FxOut, frame: FxFrame, f: DrawnFig): void {
  const slam = f.def.slam;
  if (!slam || f.anim !== slam.anim) return;
  const T = out.tris, r = slam.r / TILE, k = Math.min(f.animT / slam.t, 1), now = frame.ctx.now;
  const blink = Math.floor(now * 12) % 2 === 0;
  rgbIn(slam.gloom ? GLOOM.mid : (slam.color ?? 0xff3020), FILL);
  rgbIn(slam.color ?? 0xff5040, EDGE);
  groundDisc(T, f.x, f.z, 0.02, r, FILL, 0.12, 0.12);
  if (k > 0) groundDisc(T, f.x, f.z, 0.02, r * k, FILL, 0.3, 0.3);
  const ea = k > 0.7 && blink ? 1 : 0.7;
  groundRing(T, f.x, f.z, 0.02, Math.max(0, r - PX * 0.8), r, EDGE, ea, ea);
  if (slam.gloom) {
    // wisps drawn in from the edge to the middle (a dark one and a pale one in turn)
    for (let i = 0; i < 6; i++) {
      const t = now * 2.2 + i / 6, cyc = Math.floor(t), ph = t - cyc, sd = f.id * 17 + i;
      const ang = hash3(sd, cyc, 0) * Math.PI * 2, d = r * (1 - ph), dark = hash3(sd, cyc, 1) < 0.6;
      rgbIn(dark ? GLOOM.dark : GLOOM.spark, c0);
      dot(T, frame.ctx.ax, f.x + Math.cos(ang) * d, 0.05 + 0.6 * ph, f.z + Math.sin(ang) * d, dark ? PX * 1.6 : PX, c0[0], c0[1], c0[2], Math.min(1, ph * 4) * (1 - ph * 0.5));
    }
  }
}

// ---- the dragon's breath ----
const FIRE = [0xff7020, 0xffd040];
/** Fire pours from the mouth into the damage cone and falls to the floor; in the wind-up smoke seeps from the nostrils and embers glow at the mouth. */
function breath(out: FxOut, frame: FxFrame, f: DrawnFig): void {
  const d = f.def;
  if (!d.mouth) return;
  const ctx = frame.ctx, T = out.tris, windup = d.windups?.[ANIM.Breath] ?? 0, m = f.mouth;
  if (f.anim === ANIM.Breath && f.animT >= windup) {
    if (!m) return;
    const t0 = f.animT - windup, n = Math.max(4, Math.round(40 * ctx.detail));
    for (let i = 0; i < n; i++) {
      // each mote is born at its own moment within its first life (the breath builds up from the mouth), then repeats
      const sd = f.id * 977 + i, life = 0.45 + hash3(sd, 0, 1) * 0.25, t = t0 - hash3(sd, 0, 2) * life;
      if (t < 0) continue;
      const cyc = Math.floor(t / life), ph = t / life - cyc;
      const spread = (hash3(sd, cyc, 3) * 2 - 1) * 0.38, reach = (40 + hash3(sd, cyc, 4) * 75) / TILE;
      const gx = f.x + Math.cos(f.aim + spread) * reach, gz = f.z + Math.sin(f.aim + spread) * reach;
      const y = m[1] + (0.05 - m[1]) * ph * ph;
      rgbIn(FIRE[hash3(sd, cyc, 5) < 0.5 ? 0 : 1], c0);
      dot(T, ctx.ax, m[0] + (gx - m[0]) * ph, y, m[2] + (gz - m[2]) * ph, PX * (1.5 + hash3(sd, cyc, 6) * 2), c0[0], c0[1], c0[2], 1 - ph * ph * ph);
    }
    return;
  }
  if (!isWindup(f.anim) && f.anim !== ANIM.Breath) return;
  const nos = f.nostril, k = Math.max(3, Math.round(8 * ctx.detail));
  rgbIn(0x706060, c1);
  if (nos) {
    for (let i = 0; i < k; i++) {
      const t = f.animT / 0.9 + i / k, cyc = Math.floor(t), ph = t - cyc, sd = f.id * 53 + i;
      dot(out.lit, ctx.ax, nos[0] + (hash3(sd, cyc, 0) - 0.5) * 10 / TILE * ph, nos[1] + 18 / TILE * 0.9 * ph, nos[2] + (hash3(sd, cyc, 1) - 0.5) * 10 / TILE * ph, PX * 3, c1[0], c1[1], c1[2], 0.55 * (1 - ph));
    }
  }
  if (m) {
    rgbIn(0xff8030, c0);
    const e = Math.max(3, Math.round(9 * ctx.detail));
    for (let i = 0; i < e; i++) {
      const t = f.animT / 0.3 + i / e, cyc = Math.floor(t), ph = t - cyc, sd = f.id * 59 + i;
      dot(T, ctx.ax, m[0] + (hash3(sd, cyc, 0) - 0.5) * 12 / TILE * ph, m[1] + 6 / TILE * 0.3 * ph, m[2] + (hash3(sd, cyc, 1) - 0.5) * 12 / TILE * ph, PX * 1.5, c0[0], c0[1], c0[2], 1 - ph);
    }
  }
}

// ---- the stone gaze ----
const GAZE_GREY: MV3 = [0xb0 / 255, 0xb0 / 255, 0xb0 / 255], GAZE_CORE: MV3 = [1, 1, 1];
const gazeA: MV3 = [0, 0, 0], gazeB: MV3 = [0, 0, 0];
/** A grey beam from the lich's eyes to the middle of the hero it petrifies (the target is in the entity's `extra`; the own hero is the drawn figure). */
function gaze(out: FxOut, frame: FxFrame, f: DrawnFig): void {
  const e = frame.ents.get(f.id);
  if (!e) return;
  let tx = 0, ty = 0.5, tz = 0, found = false;
  for (let i = 0; i < frame.figs.length; i++) {
    const g = frame.figs[i];
    if (g.id === e.extra) { tx = g.x; ty = g.foot + g.top / 2; tz = g.z; found = true; break; }
  }
  if (!found) {
    const t = frame.ents.get(e.extra);
    if (!t) return;
    tx = t.x / TILE; tz = t.y / TILE; ty = 0.5 * stretchOf(frame.ctx);
  }
  if (f.eyes) { gazeA[0] = f.eyes[0]; gazeA[1] = f.eyes[1]; gazeA[2] = f.eyes[2]; }
  else { gazeA[0] = f.x; gazeA[1] = f.foot + f.top - 0.15; gazeA[2] = f.z; }
  gazeB[0] = tx; gazeB[1] = ty; gazeB[2] = tz;
  const a = gazePulse(frame.ctx.now);
  streak(out.tris, frame.ctx.ax, gazeA, gazeB, 0.05, GAZE_GREY, a, a);
  streak(out.tris, frame.ctx.ax, gazeA, gazeB, 0.02, GAZE_CORE, a * 0.8, a * 0.8);
}

// ---- the lich's drain ----
const DRAIN_RED: MV3 = [0xc0 / 255, 0x20 / 255, 0x20 / 255], DRAIN_PINK: MV3 = [1, 0x60 / 255, 0x60 / 255];
const MOTE_A: MV3 = [1, 0x40 / 255, 0x50 / 255], MOTE_B: MV3 = [1, 0xa0 / 255, 0xa0 / 255];
/** Wavy red lines (three strands) from every channelling disciple to the lich, with motes travelling along them. The lich is first in the list. */
function drain(out: FxOut, frame: FxFrame): void {
  const dr = frame.snap?.drain;
  if (!dr || dr.length < 2) return;
  const ctx = frame.ctx, T = out.tris, now = ctx.now, st = stretchOf(ctx);
  let lx = dr[0][0] / TILE, lz = dr[0][1] / TILE;
  // the lich in view (the one nearest the list's first point) draws the line's end smoothly
  let best = 4, ly = 12 / TILE * st;
  for (let i = 0; i < frame.figs.length; i++) {
    const g = frame.figs[i], dd = (g.x - lx) ** 2 + (g.z - lz) ** 2;
    if (g.kind === KIND.Lich && dd < best) {
      best = dd;
      // 3D hides the drain beams while the lich is hidden: the sight rule wins
      if (frame.hidden.has(g.id)) return;
      // a built figure's chest is where the lines end
      if (g.chest) { lx = g.chest[0]; ly = g.chest[1]; lz = g.chest[2]; }
      else { lx = g.x; lz = g.z; ly = 12 / TILE * st; }
    }
  }
  const sy = 10 / TILE * st, ty = ly;
  for (let d = 1; d < dr.length; d++) {
    const id = d * 7919, sx = dr[d][0] / TILE, sz = dr[d][1] / TILE;
    const nx = -(lz - sz), nz = lx - sx, nl = Math.hypot(nx, nz) || 1, ux = nx / nl, uz = nz / nl;
    const al = 0.5 + 0.2 * Math.sin(now * 20 + id);
    for (let s = 0; s < 3; s++) {
      const off = (s - 1) * 0.05, col = s === 1 ? DRAIN_PINK : DRAIN_RED;
      for (let i = 0; i < 12; i++) {
        for (let e = 0; e < 2; e++) {
          const k = (i + e) / 12, w = Math.sin(k * 10 - now * 8 + id) * 0.125 + off, o = e === 0 ? pa : pb;
          o[0] = sx + (lx - sx) * k + ux * w; o[1] = sy + (ty - sy) * k; o[2] = sz + (lz - sz) * k + uz * w;
        }
        streak(T, ctx.ax, pa, pb, PX * 0.8, col, al, al);
      }
    }
    for (let i = 0; i < 4; i++) {
      const k = (now * 0.8 + i / 4 + id * 0.13) % 1, w = Math.sin(k * 10 - now * 8 + id) * 0.125;
      const m = i % 2 ? MOTE_A : MOTE_B;
      dot(T, ctx.ax, sx + (lx - sx) * k + ux * w, sy + (ty - sy) * k, sz + (lz - sz) * k + uz * w, PX * 2, m[0], m[1], m[2], 0.9);
    }
  }
}

// ---- the mimic ----
const WAKE: BurstSpec = { x: 0, y: 0, z: 0, n: 10, speed: [1.2, 2.8], up: [0.1, 1.3], life: [0.25, 0.45], g: 4, drag: 0, size: PX * 1.5, colours: [0xffe070], streak: false };
/** The motes of the mimic's landing and of the rim dust (before the detail setting). */
const LAND_N = 5, RIM_N = 12;
const LAND: BurstSpec = { x: 0, y: 0, z: 0, n: LAND_N, speed: [0.6, 1.25], up: [0, 0.5], life: [0.15, 0.3], g: 1, drag: 0, size: PX * 3, colours: [0x9a8a7a], streak: false };

/** The dust where a figure goes over a chasm's edge, made large and light so it reads in dim light: 12 motes of 4 px (the burst has no shrink), two stone colours, up to 40 px/s, thrown 0.5 to 1.4 rad (up into the light above the rim), from 4 px above the rim spot, up to 0.6 s. Lit like all dust: a clearly lighter stone albedo is what makes it read. */
const RIM: BurstSpec = { x: 0, y: 0, z: 0, n: RIM_N, speed: [0.8, 40 * PX], up: [0.5, 1.4], life: [0.35, 0.6], g: 1, drag: 0, size: PX * 4, colours: [0xd9d0c4, 0xb8a898], streak: false };
const RIM_Y = 4 * PX;

/** A puff of dust motes of `spec` (mutated: position and count) at a record's spot, lit; none for a figure the sight hides. */
function dust(o: FxOut, f: FxFrame, r: FxRec, age: number, spec: BurstSpec, y: number, n: number): void {
  if (f.hidden.has(r.follow)) return;
  spec.x = r.x; spec.y = y; spec.z = r.z; spec.n = Math.max(2, Math.round(n * f.ctx.detail));
  burst(o.lit,f.ctx.ax, spec, age, r.seed);
}

// ---- a built figure's lights ----
/** The glow of a built figure's gem (and of its skull's flare) as small magic lights; only a figure with `magic` (the lich today) has them. */
function builtLights(out: FxOut, f: DrawnFig, st: number): void {
  const m = f.magic;
  if (!m) return;
  // the anchors are at the stretched height; lights work in true space (as the halo's does)
  if (f.gem) {
    const k = 0.6 * m.gem * f.alpha;
    addLight(out, 'lg' + f.id, f.gem[0], f.foot + (f.gem[1] - f.foot) / st, f.gem[2], 2.5, 0.45 * k, 0.72 * k, 1.0 * k, LIGHT_KIND.Magic);
  }
  if (f.eyes && m.flare > 0.02) {
    const k = 0.8 * m.flare * f.alpha;
    addLight(out, 'lf' + f.id, f.eyes[0], f.foot + (f.eyes[1] - f.foot) / st, f.eyes[2], 3, 0.69 * k, 0.37 * k, 1.0 * k, LIGHT_KIND.Magic);
  }
}

// ---- all of it ----
/** The figure effects of a frame; registered as a frame drawer. */
export function drawFigureFx(out: FxOut, frame: FxFrame, fx: Effects3d): void {
  const ctx = frame.ctx, now = ctx.now, st = stretchOf(ctx), T = out.tris;
  const cues = frame.cues;
  // a mimic the sight hides shows no cue (the record follows its id; the drawers check it too)
  if (cues) for (let i = 0; i < cues.length; i++) if (!frame.hidden.has(cues[i].id)) fx.emit(cues[i].land ? FX_KIND.MimicLand : FX_KIND.MimicWake, now, cues[i].x, cues[i].z, cues[i].id);
  const falls = frame.falls;
  if (falls) for (let i = 0; i < falls.length; i++) if (!frame.hidden.has(falls[i].id)) fx.emit(FX_KIND.RimDust, now, falls[i].x, falls[i].z, falls[i].id);
  for (let i = 0; i < frame.figs.length; i++) {
    const f = frame.figs[i];
    if (frame.hidden.has(f.id) || f.alpha < 0.05) continue;
    // a frozen figure's gem still shines; a petrified one's does not
    if (f.magic && !has(f.effects, EFFECT.Petrified)) builtLights(out, f, st);
    if (still(f)) continue;
    swoosh(T, f);
    if (f.bite >= 0 && f.mouth) fangTris(T, f.mouth, ctx.cam, f.bite);
    if (f.anim === ANIM.Channel) swirlTris(T, f.x, f.z, f.animT, f.def.base, f.top, 0.6, f.foot);
    releases(fx, f, now, st);
    if (f.anim === ANIM.Slam && f.def.mount === 'staff') novaWindup(out, frame, f, 18 / TILE * st);
    telegraph(out, frame, f);
    if (f.def.mouth) breath(out, frame, f);
    if (f.anim === ANIM.Gaze) gaze(out, frame, f);
  }
  drain(out, frame);
}

/** Registers the figure effects (the frame drawer and the drawers of the Spark and mimic records). */
export function registerFigureFx(): void {
  registerFrameFx(drawFigureFx);
  registerFrameFx(halo);
  registerFx(FX_KIND.Spark, (o, f, r, a) => { drawSpark(o, f, r, a); });
  registerFx(FX_KIND.MimicWake, (o, f, r, a) => {
    if (f.hidden.has(r.follow)) return;
    WAKE.x = r.x; WAKE.y = 8 / TILE; WAKE.z = r.z; WAKE.n = Math.max(3, Math.round(10 * f.ctx.detail));
    burst(o.tris, f.ctx.ax, WAKE, a, r.seed);
  });
  registerFx(FX_KIND.MimicLand, (o, f, r, a) => { dust(o, f, r, a, LAND, 0.05, LAND_N); });
  registerFx(FX_KIND.RimDust, (o, f, r, a) => { dust(o, f, r, a, RIM, RIM_Y, RIM_N); });
}

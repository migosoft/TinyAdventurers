// Status marks round figures in 3D (#308, design §6): the marks of the `effects` bits of every drawn figure, card or model. The Accelerated afterimage is `Figures3d`'s own (dash copies path) and the body tints
// (Frozen's cool one, Poisoned's green) are the figures'. Every picture is a pure function of the clock and the figure's id. Figures in
// `hidden` get no marks and add no light. The Shade's veil (`game/shadeHaze.ts`) is stateful (its strands trail the figure): the state
// is kept per Shade id in `VEILS`, and a dead Shade's veil drifts apart for a second (`FX_KIND.ShadeVeil`). A figure whose model has
// `spectre.fog` (#359) wears the clinging fog of `shadeFog.ts` instead of strands (kept per id in `FOGS`); a dead one's fog spreads and thins.
import { has } from '../../game/effectBits';
import { ENTANGLE_LOOKS, flameSpotAt, GLOOM, snowflakeAlpha } from '../../game/fxLooks';
import { dissolveVeil, restingVeil, VeilStrands, VEIL_DEATH_LIFE, type VeilStrand } from '../../game/shadeHaze';
import { EFFECT, EFFECT_LOOK, LIGHT_KIND } from '../../generated/defs';
import { TILE } from '../../sim/map';
import { addLight } from './booms';
import { FX_KIND, registerFrameFx, registerFx, type Effects3d, type FxFrame, type FxRec } from './effects3d';
import { hash3, rng } from './rand';
import { BALL1, dot, fireBall, groundRing, PX, streak, type Axes, type MV3, type V3 } from './shapes';
import { stretchOf } from './figureFx';
import { FOG, FOG_FRAME, fogTris, ShadeFog, smooth } from './shadeFog';
import type { FxTris } from './tris';
import type { DrawnFig, FxOut } from './types';

const rgbIn = (c: number, out: MV3): MV3 => { out[0] = ((c >> 16) & 255) / 255; out[1] = ((c >> 8) & 255) / 255; out[2] = (c & 255) / 255; return out; };
const c0: MV3 = [0, 0, 0];
const pa: MV3 = [0, 0, 0], pb: MV3 = [0, 0, 0];
const spot: [number, number] = [0, 0];

/** Mote colours. */
const BUBBLE = 0x7fd650, GLINT = 0x7fe060, DRAIN = 0x9a8cb8;
const FLAKE = [0xffffff, 0xd8f0ff], EMBERS = [0xff7a20, 0xffb040];
const BLACK: V3 = [0, 0, 0], ICE: V3 = [0xa8 / 255, 0xd8 / 255, 0xff / 255];
const WARD_RGB: V3 = [1, 0xd2 / 255, 0x4a / 255];
const VINE_LEAF = 0x8fe05a;

// ---- the burning light: the nearest three burning figures to the camera target ----
const NEAR = 3;
const nearIdx = new Int32Array(NEAR);
const nearD = new Float64Array(NEAR);
let nearN = 0;
function offerNear(i: number, d: number): void {
  if (nearN === NEAR && d >= nearD[NEAR - 1]) return;
  let k = nearN < NEAR ? nearN++ : NEAR - 1;
  while (k > 0 && nearD[k - 1] > d) { nearD[k] = nearD[k - 1]; nearIdx[k] = nearIdx[k - 1]; k--; }
  nearD[k] = d; nearIdx[k] = i;
}

/** Time-sliced motes: `n` live at a time (one born every `life / n` s), each at a random spot of the body and drifting `rise` tiles up (down when negative) over its `life`. */
function drift(T: FxTris, frame: FxFrame, f: DrawnFig, w: number, n: number, life: number, yLo: number, yHi: number, rise: number, spread: number, cols: readonly number[], size: number, alpha: number, salt: number): void {
  const ax = frame.ctx.ax, now = frame.ctx.now;
  for (let i = 0; i < n; i++) {
    const t = now / life + i / n + hash3(f.id, i, salt) * 0.5, cyc = Math.floor(t), ph = t - cyc, sd = f.id * 7 + i + salt * 131;
    const ox = (hash3(sd, cyc, 0) - 0.5) * w * spread, y = f.foot + f.top * (yLo + (yHi - yLo) * hash3(sd, cyc, 1)) + rise * ph;
    rgbIn(cols[Math.floor(hash3(sd, cyc, 2) * cols.length) % cols.length], c0);
    dot(T, ax, f.x + ax.right[0] * ox, y, f.z + ax.right[2] * ox, size, c0[0], c0[1], c0[2], alpha * f.alpha * (1 - ph * ph));
  }
}

/** The icy shell: a box of six quads round the body, shaded face by face. */
function shell(T: FxTris, f: DrawnFig, now: number): void {
  const b = f.foot, h = f.foot + f.top, r = (f.top * 0.55) / 2 + PX, x0 = f.x - r, x1 = f.x + r, z0 = f.z - r, z1 = f.z + r;
  const a = (0.25 + 0.07 * Math.sin(now * 3)) * f.alpha;
  const q = (k: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number): void => {
    const s = k;
    T.tri(ax, ay, az, bx, by, bz, cx, cy, cz, ICE[0] * s, ICE[1] * s, ICE[2] * s, a);
    T.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, ICE[0] * s, ICE[1] * s, ICE[2] * s, a);
  };
  q(1.15, x0, h, z0, x1, h, z0, x1, h, z1, x0, h, z1);
  q(0.95, x0, b, z0, x1, b, z0, x1, h, z0, x0, h, z0);
  q(0.8, x1, b, z0, x1, b, z1, x1, h, z1, x1, h, z0);
  q(0.9, x1, b, z1, x0, b, z1, x0, h, z1, x1, h, z1);
  q(0.7, x0, b, z1, x0, b, z0, x0, h, z0, x0, h, z1);
  q(0.6, x0, b + 0.01, z0, x1, b + 0.01, z0, x1, b + 0.01, z1, x0, b + 0.01, z1);
}

function entangleLook(frame: FxFrame, id: number): number {
  const e = frame.ents.get(id);
  if (e) return e.entangled;
  const l = frame.snap?.looks;
  if (l) for (const [i, ef, lk] of l) if (i === id && ef === EFFECT.Entangled) return lk;
  return EFFECT_LOOK.Plain;
}

function marks(out: FxOut, frame: FxFrame, f: DrawnFig, idx: number): void {
  const T = out.tris, ctx = frame.ctx, now = ctx.now, ax = ctx.ax, fx = f.effects, a = f.alpha;
  const w = Math.max(0.3, f.top * 0.55), st = 1 / Math.cos(ctx.cam.pitch), n = ctx.detail;
  if (has(fx, EFFECT.Blind)) {
    // three dark motes circling just above the head
    rgbIn(GLOOM.dark, c0);
    for (let i = 0; i < 3; i++) {
      const ang = now * 4 + (i * Math.PI * 2) / 3;
      dot(T, ax, f.x + Math.cos(ang) * 0.25, f.foot + f.top + 0.2 + Math.sin(ang) * 0.05, f.z + Math.sin(ang) * 0.25, PX * 1.6, c0[0], c0[1], c0[2], 0.85 * a);
    }
  }
  if (has(fx, EFFECT.Burning)) {
    const k = Math.max(2, Math.round(5 * n));
    for (let i = 0; i < k; i++) {
      // each flame hops to a new spot every 0.4 to 1 s
      const cyc = Math.floor(now * 1.4 + i * 0.37);
      flameSpotAt(w, f.top, 0, f.id * 97 + i * 13 + cyc, spot);
      const flick = 1 + 0.2 * Math.sin(now * 63 + i * 2.1);
      fireBall(T, BALL1, f.x + ax.right[0] * spot[0], f.foot - spot[1], f.z + ax.right[2] * spot[0], 0.07 * flick * (a > 0.5 ? 1 : a * 2), now * 1.3 + i, f.id * 5 + i, 0.75, 0, false);
    }
    offerNear(idx, (f.x - ctx.cam.x) ** 2 + (f.z - ctx.cam.z) ** 2);
  }
  if (has(fx, EFFECT.Frozen)) {
    shell(T, f, now);
    for (let i = 0; i < 6; i++) {
      const t = now + i * 0.13, cyc = Math.floor(t / 0.8), age = t - cyc * 0.8, life = 0.6 + 0.2 * hash3(f.id, cyc, i);
      const al = snowflakeAlpha(age, life);
      if (al <= 0) continue;
      const sd = f.id * 11 + i, ox = (hash3(sd, cyc, 0) - 0.5) * (w + 0.75);
      rgbIn(FLAKE[hash3(sd, cyc, 1) < 0.5 ? 0 : 1], c0);
      dot(T, ax, f.x + ax.right[0] * ox, f.foot + f.top * hash3(sd, cyc, 2) + 0.1, f.z + ax.right[2] * ox, PX * 1.5, c0[0], c0[1], c0[2], al * a);
    }
  }
  if (has(fx, EFFECT.Poisoned)) drift(T, frame, f, w, 3, 0.8, 0.3, 0.9, 8 / TILE, 0.8, [BUBBLE], PX * 1.5, 1, 1);
  if (has(fx, EFFECT.Chilled)) drift(T, frame, f, w, 2, 0.9, 0.4, 1.1, -6 / TILE, 1.1, FLAKE, PX * 1.5, 0.8, 2);
  if (has(fx, EFFECT.Singed)) drift(T, frame, f, w, 2, 0.6, 0.2, 0.7, 12 / TILE, 0.8, EMBERS, PX * 1.5, 1, 3);
  if (has(fx, EFFECT.Weakened) || has(fx, EFFECT.Clumsy) || has(fx, EFFECT.Frail)) drift(T, frame, f, w, 2, 0.9, 0.6, 0.6, -8 / TILE, 1, [DRAIN], PX * 1.5, 0.8, 4);
  if (has(fx, EFFECT.Coated)) {
    // a green glint twinkles on the weapon hand every 0.45 s for a quarter second
    const t = now / 0.45, cyc = Math.floor(t), age = (t - cyc) * 0.45;
    if (age < 0.25) {
      rgbIn(GLINT, c0);
      const sd = f.id * 3;
      dot(T, ax, f.hand[0] + (hash3(sd, cyc, 0) - 0.5) * 0.25, f.hand[1] + (hash3(sd, cyc, 1) - 0.5) * 0.35, f.hand[2] + (hash3(sd, cyc, 2) - 0.5) * 0.25, PX * 1.5, c0[0], c0[1], c0[2], a * (1 - age / 0.25));
    }
  }
  if (has(fx, EFFECT.Entangled)) {
    const look = ENTANGLE_LOOKS[entangleLook(frame, f.id) as keyof typeof ENTANGLE_LOOKS] ?? ENTANGLE_LOOKS[EFFECT_LOOK.Plain];
    rgbIn(look.color, c0);
    const rgb: V3 = c0, r = w / 2 + PX;
    groundRing(T, f.x, f.z, 0.06 * st, r - PX * 0.5, r + PX * 0.5, rgb, 0.95 * a, 0.95 * a, 16);
    groundRing(T, f.x, f.z, 0.22 * st, r - PX * 1.5, r - PX * 0.5, rgb, 0.95 * a, 0.95 * a, 16);
    if (look.vines) {
      // short tendrils and leaves sticking out of the bands
      for (let s = -1; s <= 1; s += 2) {
        const bx = f.x + ax.right[0] * s * r, bz = f.z + ax.right[2] * s * r;
        pa[0] = bx; pa[1] = 0.06 * st; pa[2] = bz;
        pb[0] = bx + ax.right[0] * s * 0.12; pb[1] = 0.25 * st; pb[2] = bz + ax.right[2] * s * 0.12;
        streak(T, ax, pa, pb, PX, rgb, 0.95 * a, 0.95 * a);
        rgbIn(VINE_LEAF, c0);
        dot(T, ax, pb[0], pb[1] + 0.03, pb[2], PX * 2, c0[0], c0[1], c0[2], a);
        rgbIn(look.color, c0);
      }
    }
  }
  if (has(fx, EFFECT.Warded)) {
    const k = 0.5 + 0.5 * Math.sin(now * 4), r = w / 2 + 2.5 * PX, al = (0.35 + 0.5 * k) * a;
    groundRing(T, f.x, f.z, f.foot + f.top / 2, r - PX * 0.4, r + PX * 0.4, WARD_RGB, al, al, 20);
  }
}

// ---- the Shade's veil ----
interface VeilMem {
  veil: VeilStrands;
  /** The clock of the last step, and the feet in screen px (x right, y down) and in world tiles. */
  t: number; sx: number; sy: number; wx: number; wz: number; face: 1 | -1;
}
const VEILS = new Map<number, VeilMem>();
/**
 * The clinging fog of the figures with `spectre.fog` (the Shade's model, #359), per id: its patches, the clock and spot of its last frame, its form,
 * the alpha it was drawn with (for the fade) and the clock of its last dying step (-1 while alive).
 */
interface FogMem { fog: ShadeFog; t: number; x: number; z: number; form: number; stretch: number; alpha: number; dying: number }
export const FOGS = new Map<number, FogMem>();
/** True once any fog was drawn since the last `clearVeils()`: a Shade then dies as fog even when its own was not seen. */
let fogSeen = false;
/** Forgets every veil and fog (tests). */
export function clearVeils(): void { VEILS.clear(); FOGS.clear(); fogSeen = false; }

/** Draws strands in the plane of the screen round the world spot (`wx`, `wz`), whose screen position is (`sx`, `sy`) px. Alpha follows the dither steps: solid, then two see-through ones. */
function drawStrands(T: FxTris, ax: Axes, lines: readonly VeilStrand[], wx: number, wz: number, sx: number, sy: number, alpha: number): void {
  for (const l of lines) {
    const n = l.pts.length - 1, k = alpha * (l.front ? 0.8 : 1);
    for (let i = 0; i < n; i++) {
      const fr = (i + 0.5) / n, al = (fr < 0.45 ? 1 : fr < 0.75 ? 0.6 : 0.3) * k;
      for (let e = 0; e < 2; e++) {
        const p = l.pts[i + e], o = e === 0 ? pa : pb, dx = (p.x - sx) / TILE, dy = -(p.y - sy) / TILE;
        o[0] = wx + ax.right[0] * dx + ax.up[0] * dy; o[1] = ax.up[1] * dy; o[2] = wz + ax.right[2] * dx + ax.up[2] * dy;
      }
      streak(T, ax, pa, pb, PX * (1.6 - fr), BLACK, al, al);
    }
  }
}

const drawnFogs = new Set<number>();

/** Steps (or restarts) and draws the fog of a figure with `spectre.fog`. */
function drawFog(out: FxOut, frame: FxFrame, f: DrawnFig): void {
  const ctx = frame.ctx, now = ctx.now, st = stretchOf(ctx);
  let m = FOGS.get(f.id);
  if (!m) {
    m = { fog: new ShadeFog(rng(f.id * 7919 + 1), ctx.detail), t: now, x: f.x, z: f.z, form: f.form, stretch: st, alpha: 0, dying: -1 };
    FOGS.set(f.id, m);
    m.fog.settle(now, f.x, f.z, f.form, st);
  } else if (now - m.t > FOG_FRAME.gap || now < m.t - FOG_FRAME.rewind || Math.hypot(f.x - m.x, f.z - m.z) > FOG_FRAME.jump) {
    // out of sight for long, or moved far in one frame: the fog starts at the new spot, with no streak across the room
    m.fog.settle(now, f.x, f.z, f.form, st);
  } else {
    // a frozen clock repeats the picture
    m.fog.step(Math.max(0, Math.min(FOG_FRAME.maxStep, now - m.t)), now, f.x, f.z, f.form, st);
  }
  m.t = now; m.x = f.x; m.z = f.z; m.form = f.form; m.stretch = st; m.dying = -1;
  m.alpha = smooth(0, FOG_FRAME.formAlpha, f.form) * f.alpha;
  fogSeen = true;
  fogTris(out.tris, ctx.ax, m.fog, now, m.alpha, 1);
}

/** The fogs of the frame: those of the visible figures with fog, and the fading ones of figures that left the frame. */
function fogs(out: FxOut, frame: FxFrame, fx: Effects3d): void {
  const ctx = frame.ctx, now = ctx.now;
  drawnFogs.clear();
  for (let i = 0; i < frame.figs.length; i++) {
    const f = frame.figs[i];
    if (!f.spectre?.fog || frame.hidden.has(f.id) || f.alpha < FOG_FRAME.minAlpha || fx.following(FX_KIND.ShadeVeil, f.id)) continue;
    drawFog(out, frame, f);
    drawnFogs.add(f.id);
  }
  for (const [id, m] of FOGS) {
    if (now - m.t > FOG_FRAME.gap || now < m.t - FOG_FRAME.rewind) { FOGS.delete(id); continue; }
    // gone from the frame (out of view, faint): it fades where it was; a dying one belongs to its record, a hidden one shows nothing
    if (drawnFogs.has(id) || frame.hidden.has(id) || fx.following(FX_KIND.ShadeVeil, id)) continue;
    const age = now - m.t;
    if (age >= 0 && age < FOG.fade) fogTris(out.tris, ctx.ax, m.fog, now, m.alpha * (1 - age / FOG.fade), 1);
  }
}

function veils(out: FxOut, frame: FxFrame): void {
  const ctx = frame.ctx, now = ctx.now, ax = ctx.ax;
  for (let i = 0; i < frame.figs.length; i++) {
    const f = frame.figs[i];
    if (!f.def.veil || f.spectre?.fog || frame.hidden.has(f.id) || f.alpha < 0.05) continue;
    const sx = (f.x * ax.right[0] + f.z * ax.right[2]) * TILE, sy = -(f.x * ax.up[0] + f.z * ax.up[2]) * TILE;
    let m = VEILS.get(f.id);
    if (!m) { m = { veil: new VeilStrands(rng(f.id * 7919 + 1)), t: now, sx, sy, wx: f.x, wz: f.z, face: 1 }; VEILS.set(f.id, m); }
    const dot_ = Math.cos(f.yaw) * ax.right[0] + Math.sin(f.yaw) * ax.right[2];
    if (Math.abs(dot_) > 0.1) m.face = dot_ >= 0 ? 1 : -1;
    const dt = Math.min(0.1, now - m.t);
    // a frozen clock repeats the picture; a long gap (out of sight) restarts the veil at the new spot
    if (dt > 0 || m.veil.lines.length === 0) m.veil.step({ x: sx, y: sy }, m.face, Math.max(dt, 1 / 60));
    m.t = now; m.sx = sx; m.sy = sy; m.wx = f.x; m.wz = f.z;
    drawStrands(out.tris, ax, m.veil.lines, f.x, f.z, sx, sy, f.alpha);
  }
  // a veil nobody has drawn for a few seconds is forgotten
  for (const [id, m] of VEILS) if (now - m.t > 3 || now < m.t - 1) VEILS.delete(id);
}

/** A veil last updated less than this (s) before the Died event is the one that was drawn. */
const FRESH = 0.15;
const RESTING = new WeakMap<FxRec, VeilStrand[]>();

/** A dying fog out of sight just before it died: the fog is made at the record's spot once and spreads from there. */
const RESTING_FOG = new WeakMap<FxRec, { fog: ShadeFog; dying: number }>();

/** A dying fog: it spreads outward from (x, z), thins over `VEIL_DEATH_LIFE` and swells. `s.dying` is the clock of its last step. */
function dissolveFog(out: FxOut, frame: FxFrame, fog: ShadeFog, s: { dying: number }, rec: FxRec, age: number, x: number, z: number, alive: number): void {
  const now = frame.ctx.now;
  if (s.dying < 0) s.dying = rec.start;
  fog.spread(Math.max(0, Math.min(FOG_FRAME.maxStep, now - s.dying)), x, z);
  s.dying = now;
  // it thins from the alpha it had alive (`alive`), so a part-formed or faint Shade does not jump to full darkness
  fogTris(out.tris, frame.ctx.ax, fog, now, alive * Math.max(0, 1 - age / VEIL_DEATH_LIFE), 1 + FOG_FRAME.grow * age);
}

function drawVeilDeath(out: FxOut, frame: FxFrame, rec: FxRec, age: number): void {
  if (frame.hidden.has(rec.follow)) return;
  const ax = frame.ctx.ax, fogM = FOGS.get(rec.follow), m = VEILS.get(rec.follow);
  // in order: the fog or the veil that was drawn just before it died; else, in a session that draws fog, a resting fog; else a resting veil
  if (fogM && rec.start - fogM.t < FRESH) { dissolveFog(out, frame, fogM.fog, fogM, rec, age, fogM.x, fogM.z, fogM.alpha); return; }
  if (fogSeen && !(m && rec.start - m.t < FRESH)) {
    // a Shade of fog that died out of sight: a resting fog at the death spot (built once per record)
    let r = RESTING_FOG.get(rec);
    if (!r) {
      const fog = new ShadeFog(rng(rec.seed), frame.ctx.detail);
      fog.settle(rec.start, rec.x, rec.z, 1, stretchOf(frame.ctx));
      r = { fog, dying: -1 };
      RESTING_FOG.set(rec, r);
    }
    dissolveFog(out, frame, r.fog, r, rec, age, rec.x, rec.z, 1);
    return;
  }
  let lines: readonly VeilStrand[], sx: number, sy: number, wx: number, wz: number;
  if (m && rec.start - m.t < FRESH) { lines = m.veil.lines; sx = m.sx; sy = m.sy; wx = m.wx; wz = m.wz; }
  else {
    // Not seen just before it died (out of sight): a resting cloud at the death spot, built once per record (strands are relative to the feet at 0, 0).
    wx = rec.x; wz = rec.z; sx = 0; sy = 0;
    let r = RESTING.get(rec);
    if (!r) { r = restingVeil({ x: 0, y: 0 }, 1, rng(rec.seed)); RESTING.set(rec, r); }
    lines = r;
  }
  const d = dissolveVeil(lines, { x: sx, y: sy - 6 }, age / VEIL_DEATH_LIFE);
  drawStrands(out.tris, ax, d.lines, wx, wz, sx, sy, d.alpha);
}

/** The status marks of the frame's figures, the burning light and the Shade veils. */
export function drawStatus(out: FxOut, frame: FxFrame, fx: Effects3d): void {
  nearN = 0;
  const figs = frame.figs;
  for (let i = 0; i < figs.length; i++) {
    const f = figs[i];
    if (f.effects === 0 || frame.hidden.has(f.id) || f.alpha < 0.05) continue;
    marks(out, frame, f, i);
  }
  const now = frame.ctx.now;
  for (let k = 0; k < nearN; k++) {
    const f = figs[nearIdx[k]], I = 0.9 + 0.1 * Math.sin(now * 17 + f.id);
    addLight(out, `bn${f.id}`, f.x, f.foot + f.top * 0.4, f.z, 2.5, 1.2 * I, 0.6 * I, 0.2 * I, LIGHT_KIND.Fire);
  }
  veils(out, frame);
  fogs(out, frame, fx);
}

/** Registers the status drawer and the drawer of the Shade's dying veil. */
export function registerStatus(): void {
  registerFrameFx(drawStatus);
  registerFx(FX_KIND.ShadeVeil, drawVeilDeath);
}

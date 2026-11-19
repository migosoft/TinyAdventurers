// Status marks round figures in 3D (#308, design §6): the marks of the `effects` bits of every drawn figure, card or model. The Accelerated afterimage is `Figures3d`'s own (dash copies path) and the body tints
// (Frozen's cool one, Poisoned's green) are the figures'. Every picture is a pure function of the clock and the figure's id. Figures in
// `hidden` get no marks and add no light. The Shade's veil (`game/shadeHaze.ts`) is stateful (its strands trail the figure): the state
// is kept per Shade id in `VEILS`, and a dead Shade's veil drifts apart for a second (`FX_KIND.ShadeVeil`). A figure whose model has
// `spectre.smoke` (#359) wears the smoke body of `smoke.ts` instead of strands (kept per id in `SMOKES`, fed from the frame's pose); a dead one's smoke spreads and thins.
import { has } from '../../game/effectBits';
import { ENTANGLE_LOOKS, flameSpotAt, GLOOM, snowflakeAlpha } from '../../game/fxLooks';
import { dissolveVeil, restingVeil, VeilStrands, VEIL_DEATH_LIFE, type VeilStrand } from '../../game/shadeHaze';
import { EFFECT, EFFECT_LOOK, LIGHT_KIND } from '../../generated/defs';
import { TILE } from '../../sim/map';
import { addLight } from './booms';
import { FX_KIND, registerFrameFx, registerFx, type Effects3d, type FxFrame, type FxRec } from './effects3d';
import { hash3, rng } from './rand';
import { BALL1, dot, fireBall, groundRing, PX, smooth, streak, type Axes, type MV3, type V3 } from './shapes';
import { stretchOf } from './figureFx';
import { Smoke, SMOKE, type PlaceOf } from './smoke';
import { copyPose } from '../models/pose3d';
import { BONES } from '../models/bones';
import { bonePoint } from '../models/rig';
import type { SmokeSpec } from '../models/tubeDesc';
import { SPECTRE_FORM } from '../figures';
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
/** When a smoke is restarted at its place and how long it fades once its figure leaves the frame (seconds, seconds, tiles). */
export const SMOKE_FRAME = { fade: 0.3, gap: 3, jump: 1 } as const;
/** The longest step of a smoke (s), the faintest figure that wears one, and how far a clock may run back (s) before the smoke restarts. */
const SMOKE_STEP = { max: 0.1, minAlpha: 0.05, rewind: 1 } as const;
/** The bone whose matrix stands for the figure's root (`SmokeSpec`'s bone -1: hover, lean, twist and lunge, no part's own drift). */
const HIPS = BONES.indexOf('hips');
type Tone = readonly [number, number, number];
/**
 * The smoke of the figures with `spectre.smoke` (the Shade's model, #359), per id: its state, the clock of its last frame (`t`), the smoke's own clock,
 * the spot, the alpha it was drawn with (for the fade), the tone and size it was written with, and the clock of its last dying step (-1 while alive).
 */
interface SmokeMem {
  smoke: Smoke; t: number; clock: number; x: number; z: number; alpha: number; dying: number; tone: Tone; px: number;
  /** How fast the smoke's clock runs of the frame's time: 1, a half asleep, 0 petrified or frozen. */
  rate: number;
  /** The clock of the smoke's last step (it goes on stepping after its figure left the frame, or died). */
  stepped: number;
  /** What `place` needs from the last frame the figure was drawn (storage reused): its rig (a copy of the pose), yaw, form and foot. */
  rig: NonNullable<DrawnFig['rig']>; yaw: number; form: number; foot: number;
}
export const SMOKES = new Map<number, SmokeMem>();
/** The look of the last smoke drawn since `clearVeils()`: a Shade then dies as smoke even when its own was not seen. */
let smokeSeen: { spec: SmokeSpec; px: number; tone: Tone } | null = null;
/** Forgets every veil and smoke (tests). */
export function clearVeils(): void { VEILS.clear(); SMOKES.clear(); smokeSeen = null; }

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

const drawnSmokes = new Set<number>();
/** A smoke to write this frame: a figure of the frame (`f`) or an entry whose figure left (`m` only), and how far it is from the camera. Pooled. */
interface SmokeJob { far: number; f: DrawnFig | null; m: SmokeMem | null }
const jobPool: SmokeJob[] = [];
const jobs: SmokeJob[] = [];
const moved: [number, number] = [0, 0];
const noMove: readonly [number, number] = [0, 0];
const tmpP: [number, number, number] = [0, 0, 0];
/** What `place` reads: the rig, the figure's place and yaw, and the stretch of the camera. */
const here = { rig: null as DrawnFig['rig'], x: 0, z: 0, yaw: 0, st: 1 };

/**
 * The world place of a rest point of `bone` (model px, the figure's frame), in tiles: the pose's point (`bonePoint`), turned by the yaw as `skinVertex`'s
 * comment says (world.x = x cos - z sin, world.z = x sin + z cos), its height stretched by the camera and lifted to the figure's root (`rig.lift`).
 * Bone -1 is the figure's root, the hips' matrix (hover, lean, twist, lunge; no part's own drift).
 */
export function smokePlace(rig: NonNullable<DrawnFig['rig']>, x: number, z: number, yaw: number, stretch: number, bone: number, p: readonly [number, number, number], out: [number, number, number]): void {
  bonePoint(rig.pose, rig.scale, bone < 0 ? HIPS : bone, p, tmpP);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out[0] = x + (tmpP[0] * c - tmpP[2] * s) / TILE;
  out[1] = (tmpP[1] / TILE) * stretch + rig.lift;
  out[2] = z + (tmpP[0] * s + tmpP[2] * c) / TILE;
}
const place: PlaceOf = (bone, p, out) => smokePlace(here.rig!, here.x, here.z, here.yaw, here.st, bone, p, out);

/** The speed of a smoke's clock for a figure's effects: stone and ice hold it, sleep halves it. */
const rateOf = (effects: number): number => (has(effects, EFFECT.Petrified) || has(effects, EFFECT.Frozen) ? 0 : has(effects, EFFECT.Sleep) ? 0.5 : 1);

/** Steps (or restarts) the smoke of a figure with `spectre.smoke`; returns its entry. */
function stepSmoke(frame: FxFrame, f: DrawnFig): SmokeMem {
  const ctx = frame.ctx, now = ctx.now, spec = f.spectre!.smoke!, rig = f.rig!, px = rig.scale / TILE, tone = spec.tone;
  here.rig = rig; here.x = f.x; here.z = f.z; here.yaw = f.yaw; here.st = stretchOf(ctx);
  // the hard parts carry smoke as they fade in
  const parts = smooth(SPECTRE_FORM.body[0], SPECTRE_FORM.body[1], f.form);
  let m = SMOKES.get(f.id);
  const rate = rateOf(f.effects);
  if (!m) {
    m = {
      smoke: new Smoke(spec, rng(f.id * 7919 + 1), ctx.detail), t: now, clock: 0, x: f.x, z: f.z, alpha: 1, dying: -1, tone, px, rate, stepped: now,
      rig: { pose: copyPose(rig.pose), scale: rig.scale, lift: rig.lift }, yaw: f.yaw, form: f.form, foot: f.foot,
    };
    SMOKES.set(f.id, m);
    m.smoke.settle(place, ctx.ax, px, f.form, f.foot, parts);
  } else if (now - m.t > SMOKE_FRAME.gap || now < m.t - SMOKE_STEP.rewind || Math.hypot(f.x - m.x, f.z - m.z) > SMOKE_FRAME.jump) {
    // out of sight for long, a clock that ran back, or moved far in one frame: all of it starts at the new place, with no streak across the room
    m.smoke.settle(place, ctx.ax, px, f.form, f.foot, parts);
  } else if (rate > 0) {
    // a frozen clock repeats the picture (`step` ignores a step of 0); stone and ice hold their smoke still
    const dt = Math.max(0, Math.min(SMOKE_STEP.max, now - m.t));
    moved[0] = f.x - m.x; moved[1] = f.z - m.z;
    m.smoke.step(dt, place, ctx.ax, px, moved, f.form, parts, f.foot);
    m.clock += dt * rate;
  }
  m.t = now; m.stepped = now; m.x = f.x; m.z = f.z; m.alpha = f.alpha; m.dying = -1; m.tone = tone; m.px = px; m.rate = rate;
  // what the smoke keeps stepping with once its figure is gone (the pose copied into the entry's own storage)
  m.rig.pose.bones.set(rig.pose.bones); Object.assign(m.rig.pose.root, rig.pose.root); m.rig.scale = rig.scale; m.rig.lift = rig.lift;
  m.yaw = f.yaw; m.form = f.form; m.foot = f.foot;
  smokeSeen = { spec, px, tone };
  return m;
}

/** Steps a smoke whose figure left the frame, on its held place: nothing is born on the hard parts (`parts` 0), the body does not move. */
function stepGone(frame: FxFrame, m: SmokeMem): void {
  const ctx = frame.ctx, now = ctx.now, dt = Math.max(0, Math.min(SMOKE_STEP.max, now - m.stepped));
  m.stepped = now;
  if (m.rate <= 0 || !(dt > 0)) return;
  here.rig = m.rig; here.x = m.x; here.z = m.z; here.yaw = m.yaw; here.st = stretchOf(ctx);
  m.smoke.step(dt, place, ctx.ax, m.px, noMove, m.form, 0, m.foot);
  m.clock += dt * m.rate;
}

/** The smokes of the frame: those of the visible figures and the fading ones of figures that left the frame, written far to near. */
function smokes(out: FxOut, frame: FxFrame, fx: Effects3d): void {
  const ctx = frame.ctx, now = ctx.now, sy = Math.sin(ctx.cam.yaw), cy = Math.cos(ctx.cam.yaw);
  drawnSmokes.clear();
  jobs.length = 0;
  const add = (x: number, z: number, f: DrawnFig | null, m: SmokeMem | null): void => {
    const j = (jobPool[jobs.length] ??= { far: 0, f: null, m: null });
    j.far = x * sy - z * cy; j.f = f; j.m = m;   // along the ground's far direction (up the screen): larger is further from the camera
    jobs.push(j);
  };
  for (let i = 0; i < frame.figs.length; i++) {
    const f = frame.figs[i];
    if (!f.spectre?.smoke || !f.rig || frame.hidden.has(f.id) || f.alpha < SMOKE_STEP.minAlpha || fx.following(FX_KIND.ShadeVeil, f.id)) continue;
    add(f.x, f.z, f, null);
    drawnSmokes.add(f.id);
  }
  for (const [id, m] of SMOKES) {
    if (now - m.t > SMOKE_FRAME.gap || now < m.t - SMOKE_STEP.rewind) { SMOKES.delete(id); continue; }
    // gone from the frame (out of view, faint): it fades where it was; a dying one belongs to its record, a hidden one shows nothing
    if (drawnSmokes.has(id) || frame.hidden.has(id) || fx.following(FX_KIND.ShadeVeil, id)) continue;
    if (now - m.t >= SMOKE_FRAME.fade) { SMOKES.delete(id); continue; }
    add(m.x, m.z, null, m);
  }
  jobs.sort((a, b) => b.far - a.far);
  for (const j of jobs) {
    if (j.f) {
      const m = stepSmoke(frame, j.f);
      m.smoke.write(out.smoke, ctx.ax, m.px, ctx.smokeTone ?? m.tone, m.clock, j.f.alpha, 1);
    } else {
      const m = j.m!;
      stepGone(frame, m);
      m.smoke.write(out.smoke, ctx.ax, m.px, ctx.smokeTone ?? m.tone, m.clock, m.alpha * Math.max(0, 1 - (now - m.t) / SMOKE_FRAME.fade), 1);
    }
  }
}

function veils(out: FxOut, frame: FxFrame): void {
  const ctx = frame.ctx, now = ctx.now, ax = ctx.ax;
  for (let i = 0; i < frame.figs.length; i++) {
    const f = frame.figs[i];
    if (!f.def.veil || f.spectre?.smoke || frame.hidden.has(f.id) || f.alpha < 0.05) continue;
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

/** A dying smoke out of sight just before it died: the smoke is made at the record's spot once and spreads from there. */
interface RestingSmoke { smoke: Smoke; dying: number; clock: number; tone: Tone; px: number; rate: number }
const RESTING_SMOKE = new WeakMap<FxRec, RestingSmoke>();

/** A dying smoke: it spreads outward from (x, z), thins over `VEIL_DEATH_LIFE` and swells. `s.dying` is the clock of its last step. */
function dissolveSmoke(out: FxOut, frame: FxFrame, s: { smoke: Smoke; dying: number; clock: number; tone: Tone; px: number; rate: number }, rec: FxRec, age: number, x: number, z: number, alive: number): void {
  const ctx = frame.ctx, now = ctx.now;
  if (s.dying < 0) s.dying = rec.start;
  const dt = Math.max(0, Math.min(SMOKE_STEP.max, now - s.dying));
  s.smoke.spread(dt, x, z);
  // the clock runs on (the picture's streaks must not freeze for the length of the death), but not for stone or ice
  s.clock += dt * s.rate;
  s.dying = now;
  // it thins from the alpha it had alive (`alive`), so a part-formed or faint Shade does not jump to full darkness
  s.smoke.write(out.smoke, ctx.ax, s.px, ctx.smokeTone ?? s.tone, s.clock, alive * Math.max(0, 1 - age / VEIL_DEATH_LIFE), 1 + SMOKE.death.grow * age);
}

/** The rest point of the model at the record's spot, upright and unturned: the place of a smoke that was never seen alive. */
function restingSmoke(frame: FxFrame, rec: FxRec): RestingSmoke {
  const seen = smokeSeen!, st = stretchOf(frame.ctx);
  const at: PlaceOf = (_b, p, out) => { out[0] = rec.x + p[0] * seen.px; out[1] = p[1] * seen.px * st; out[2] = rec.z + p[2] * seen.px; };
  const smoke = new Smoke(seen.spec, rng(rec.seed), frame.ctx.detail);
  smoke.settle(at, frame.ctx.ax, seen.px, 1, 0, 1);
  return { smoke, dying: -1, clock: rec.start, tone: seen.tone, px: seen.px, rate: 1 };
}

function drawVeilDeath(out: FxOut, frame: FxFrame, rec: FxRec, age: number): void {
  if (frame.hidden.has(rec.follow)) return;
  const ax = frame.ctx.ax, sm = SMOKES.get(rec.follow), m = VEILS.get(rec.follow);
  // in order: the smoke or the veil that was drawn just before it died; else, in a session that draws smoke, a resting smoke; else a resting veil
  if (sm && rec.start - sm.t < FRESH) { dissolveSmoke(out, frame, sm, rec, age, sm.x, sm.z, sm.alpha); return; }
  if (smokeSeen && !(m && rec.start - m.t < FRESH)) {
    // a Shade of smoke that died out of sight: a resting smoke at the death spot (built once per record)
    let r = RESTING_SMOKE.get(rec);
    if (!r) { r = restingSmoke(frame, rec); RESTING_SMOKE.set(rec, r); }
    dissolveSmoke(out, frame, r, rec, age, rec.x, rec.z, 1);
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
  smokes(out, frame, fx);
}

/** Registers the status drawer and the drawer of the Shade's dying veil. */
export function registerStatus(): void {
  registerFrameFx(drawStatus);
  registerFx(FX_KIND.ShadeVeil, drawVeilDeath);
}

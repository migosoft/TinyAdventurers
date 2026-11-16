// The runes round every magic cast (#308, design §3 and §4): glowing glyph strokes on a sphere round the caster while it winds up
// (and in a short swirl for an instant cast), a small vortex in front of the hand for a primary, a slow swirl while a figure channels.
// On the release they burst outward; a cast that is broken off winks out where it stands. A rune's place, glyph and timing are pure
// functions of (record seed, rune index, time). The picture is the try-out's (`magicStage.ts`), in scalar form: nothing is allocated
// per rune or per frame. The `fan` mode of the try-out is not ported.
import { ANIM, EFFECT, FLAG, LIGHT_KIND, RUNE_LOOK } from '../../generated/defs';
import { has } from '../../game/effectBits';
import type { Cand } from '../lights';
import { pushGlow } from '../cards';
import { clamp01, easeOut, lerp, PX, type V3 } from './shapes';
import { hash3 } from './rand';
import { FX_KIND, registerFx, type FxFrame, type FxRec } from './effects3d';
import { FX_LIGHT_CAP, type DrawnFig, type FxCtx, type FxOut } from './types';

export type RuneLookId = (typeof RUNE_LOOK)[keyof typeof RUNE_LOOK];

/** A look's colours: each rune takes one of `runes` by its seed, `core` is the thin bright stroke, `light` the caster light. */
export interface RunePalette { runes: readonly V3[]; core: V3; light: V3 }

/** Keyed by the generated `RUNE_LOOK`: a new look without a palette does not compile. */
export const RUNE_PALETTES: Record<RuneLookId, RunePalette> = {
  [RUNE_LOOK.Fire]: { runes: [[1, 0.55, 0.14]], core: [1, 0.93, 0.7], light: [1.3, 0.72, 0.28] },
  [RUNE_LOOK.Cold]: { runes: [[0.4, 0.75, 1]], core: [0.88, 0.97, 1], light: [0.45, 0.8, 1.4] },
  [RUNE_LOOK.Arcane]: { runes: [[1, 0.3, 0.8], [1, 0.5, 0.95]], core: [1, 0.9, 0.97], light: [1.4, 0.45, 1.15] },
  [RUNE_LOOK.Holy]: { runes: [[1, 0.82, 0.3], [1, 0.92, 0.55]], core: [1, 0.98, 0.85], light: [1.4, 1.15, 0.5] },
  [RUNE_LOOK.Gloom]: { runes: [[0.35, 0.1, 0.55], [0.18, 0.04, 0.3], [0.05, 0.02, 0.08]], core: [0.75, 0.5, 1], light: [0.6, 0.25, 1] },
  [RUNE_LOOK.Nature]: { runes: [[0.4, 0.85, 0.3], [0.55, 0.95, 0.4]], core: [0.85, 1, 0.75], light: [0.55, 1.1, 0.45] },
};

/** The palette of a channelling figure: its own colour (`FigureDef.base`, 0xrrggbb). */
export function channelPalette(base: number): RunePalette {
  const r = ((base >> 16) & 255) / 255, g = ((base >> 8) & 255) / 255, b = (base & 255) / 255;
  return {
    runes: [[r, g, b]],
    core: [lerp(r, 1, 0.7), lerp(g, 1, 0.7), lerp(b, 1, 0.7)],
    light: [r * 1.3, g * 1.3, b * 1.3],
  };
}

export type RuneMode = 'windup' | 'instant' | 'primary' | 'channel';

/** The state of one cast's runes. Times are the run's clock, in seconds. */
export interface RuneRec {
  caster: number;
  look: number;
  mode: RuneMode;
  start: number;
  /** When the runes burst (planned from the wind-up; null for a channel). */
  release: number | null;
  /** When the cast was broken off (the runes wink out), or null. */
  end: number | null;
  aim: number;
  /** The caster's foot: followed until the release, then where the release happened. */
  x: number;
  z: number;
  seed: number;
  /** Since when the caster is missing from the drawn figures, or -1. */
  lost: number;
  /** The channel's palette (made once). */
  pal: RunePalette | null;
}

// Each glyph is strokes on a grid 2 wide and 4 high.
const GLYPHS: readonly (readonly (readonly number[])[])[] = [
  [[0, 0, 0, 4], [0, 4, 2, 2], [2, 2, 0, 2]],
  [[1, 0, 1, 4], [1, 4, 2, 3], [1, 2, 0, 3]],
  [[0, 0, 2, 4], [2, 0, 0, 4]],
  [[0, 0, 0, 4], [0, 2, 2, 4], [0, 2, 2, 0]],
  [[1, 0, 1, 4], [0, 3, 1, 4], [2, 3, 1, 4], [0, 1, 2, 1]],
  [[0, 4, 2, 4], [2, 4, 0, 0], [0, 0, 2, 0]],
  [[0, 0, 1, 4], [1, 4, 2, 0], [0.5, 2, 1.5, 2]],
  [[0, 0, 0, 4], [2, 0, 2, 4], [0, 4, 2, 0]],
  [[1, 0, 1, 4], [0, 2, 1, 3], [2, 2, 1, 1]],
  [[0, 2, 1, 4], [1, 4, 2, 2], [2, 2, 1, 0], [1, 0, 0, 2]],
  [[0, 0, 2, 0], [1, 0, 1, 3], [0, 4, 1, 3], [2, 4, 1, 3]],
  [[0, 4, 0, 1], [0, 1, 1, 0], [1, 0, 2, 1], [2, 1, 2, 4]],
];

export const RUNE_N = { windup: 16, instant: 16, primary: 12 } as const;
/** The vortex: distance of its ring in front of the caster, the ring's radius, how fast it spins (rad/s), how far it travels. */
const VORTEX_D = 0.5, VORTEX_R = 0.2, VORTEX_SPIN = 9, VORTEX_RUN = 1.6;
/** A grid unit of a rune in tiles. */
const RUNE_U = 0.6 * PX;
/** The sphere's runes are this many times the vortex's (a try for the user to judge, #308: at 1 they were specks on a short cast). */
const SPHERE_SIZE = 2;
/** The centre of the rune sphere above the caster's foot, and its radius range. */
const SPHERE_Y = 0.75, SPHERE_R0 = 0.85, SPHERE_R1 = 1.2;
/**
 * One rule for every cast that releases (#308, the user): the runes stand for the cast's wind-up, but never shorter than a minimum
 * (`SPHERE_MIN` for the sphere, `PRIMARY_SWIRL` for the vortex), so an instant cast is the same picture as a long one, only shorter.
 * A rune shows at its full size at once and brightens over `APPEAR` s; every rune is whole at least `HOLD` s before the release.
 */
export const SPHERE_MIN = 0.3, PRIMARY_SWIRL = 0.2;
export const APPEAR = 0.1, HOLD = 0.05;
/** The sphere's runes are born over this share of the time they have; the whole sphere stands for the rest. */
const BORN_SHARE = 0.85;
/** The sphere turns faster on a shorter cast: `SPIN_REF / stand time`, between 1 and `SPIN_MAX` times a rune's own rate. */
const SPIN_REF = 1.2, SPIN_MAX = 4;
/** A wink-out (a cast broken off) takes this long. */
export const WINK = 0.2;
/** The flare around the release (+-). */
const FLARE = 0.12;
/** Channel: a rune is born every `CHANNEL_GAP` s, lives `CHANNEL_LIFE` s and turns slowly. */
const CHANNEL_GAP = 0.8 / RUNE_N.windup, CHANNEL_LIFE = 1.2, CHANNEL_RATE = 0.6, CHANNEL_FADE = 0.3;
/** A cast whose caster shows Idle, Run or Hurt this soon after its start is not yet judged (the snapshot may lag the event). */
const GRACE = 0.15;
/** A caster missing from the drawn figures for longer than this has left: its runes wink out. */
const LEAVE = 0.25;
/** The longest burst of a rune (sphere 0.3 to 0.6 s, primary 0.35 to 0.5 s). */
export const BURST_MAX = 0.6;
const LIGHT_Y = 0.9, LIGHT_RADIUS = 4.5;

export function newRune(caster: number, look: number, mode: Exclude<RuneMode, 'channel'>, start: number, windupS: number, aim: number, x: number, z: number, seed: number): RuneRec {
  // a primary releases with its bolt: after its wind-up if it has one (a monster's), else after the short swirl (a hero's)
  const swirl = Math.max(windupS, mode === 'primary' ? PRIMARY_SWIRL : SPHERE_MIN);
  return { caster, look, mode, start, release: start + swirl, end: null, aim, x, z, seed, lost: -1, pal: null };
}

export function newChannel(caster: number, start: number, x: number, z: number, seed: number): RuneRec {
  return { caster, look: 0, mode: 'channel', start, release: null, end: null, aim: 0, x, z, seed, lost: -1, pal: null };
}

/** The mode of a `Cast` event. */
export const castMode = (primary: boolean, windupS: number): Exclude<RuneMode, 'channel'> => (primary ? 'primary' : windupS > 0 ? 'windup' : 'instant');

const rgb: [number, number, number] = [0, 0, 0];
const core: [number, number, number] = [0, 0, 0];
const pa: [number, number, number] = [0, 0, 0];
const pb: [number, number, number] = [0, 0, 0];

/**
 * When rune `i` of `n` shows, seconds after the cast's start. The sphere's runes come one by one over the time the cast has (the
 * same share of it for an instant cast and for a long wind-up); a primary's vortex pops in PRIMARY_SWIRL before its release; a
 * channel bears one every CHANNEL_GAP. Every rune of a cast that releases is whole (APPEAR) at least HOLD s before the release.
 */
export function runeBorn(r: RuneRec, i: number, n: number): number {
  const seed = r.seed | 0;
  if (r.mode === 'channel') return i * CHANNEL_GAP;
  const W = r.release === null ? Infinity : r.release - r.start;
  const last = Math.max(0, W - APPEAR - HOLD);
  if (r.mode === 'primary') return Math.min(hash3(seed, i, 1) * 0.05 + Math.max(0, W - PRIMARY_SWIRL), last);
  return ((i + hash3(seed, i, 1)) / n) * last * BORN_SHARE;
}

/** The point of a glyph grid position on the rune's plane (centre `c`, axes `h` and `v`, grid unit `u`, drift `ox`, `oy`), into `p`. */
function gridPoint(p: [number, number, number], gx: number, gy: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number,
  vx: number, vy: number, vz: number, u: number, ox: number, oy: number): void {
  const h = (gx - 1) * u + ox, v = (gy - 2) * u + oy;
  p[0] = cx + hx * h + vx * v; p[1] = cy + hy * h + vy * v; p[2] = cz + hz * h + vz * v;
}

/**
 * The runes of a record at `now`. Returns the summed strength for the caster light (0 for none; a primary's is halved).
 * `fig` is the drawn caster (null when it is not drawn): the runes follow its foot until the release.
 */
export function runeTris(out: FxOut, ctx: FxCtx, r: RuneRec, fig: DrawnFig | null, now: number): number {
  const T = now - r.start;
  if (T < 0) return 0;
  const channel = r.mode === 'channel';
  const releaseRel = r.release === null ? Infinity : r.release - r.start;
  const endRel = r.end === null ? Infinity : r.end - r.start;
  if (fig && T < releaseRel && T < endRel) { r.x = fig.x; r.z = fig.z; }
  const pal = channel ? (r.pal ??= channelPalette(fig ? fig.def.base : 0xffffff)) : RUNE_PALETTES[r.look as RuneLookId] ?? RUNE_PALETTES[RUNE_LOOK.Fire];
  const prim = r.mode === 'primary';
  const n = channel ? 0 : RUNE_N[r.mode as 'windup' | 'instant' | 'primary'];
  const seed = r.seed | 0;
  const T_ = out.tris, ax = ctx.ax;
  // channel: the runes alive now are those born in the last CHANNEL_LIFE seconds
  let i0 = 0, i1 = n;
  if (channel) {
    const tEnd = Math.min(T, endRel);
    i1 = Math.floor(tEnd / CHANNEL_GAP) + 1;
    i0 = Math.max(0, Math.ceil((T - CHANNEL_LIFE) / CHANNEL_GAP));
  }
  const px_ = -Math.sin(r.aim), pz_ = Math.cos(r.aim), ca = Math.cos(r.aim), sa = Math.sin(r.aim);
  let sum = 0;
  for (let i = i0; i < i1; i++) {
    const glyph = GLYPHS[Math.floor(hash3(seed, i, 0) * GLYPHS.length)];
    const born = runeBorn(r, i, n);
    // during a wind-up a few wink out early, irregularly; the rest burst on the release
    const early = !channel && !prim && hash3(seed, i, 2) < 0.25 ? born + 0.3 + hash3(seed, i, 3) * 0.4 : Infinity;
    const life = prim ? 0.35 + hash3(seed, i, 4) * 0.15 : 0.3 + hash3(seed, i, 4) * 0.3;   // the burst's length, uneven per rune
    const ph = hash3(seed, i, 5) * 6.28;
    if (T < born) continue;
    const age = T - born;
    // seconds the rune stands (its swirl) before it bursts, ends or fades out
    const stop = Math.min(early, releaseRel, endRel);
    if (born >= stop) continue;
    const burst = !channel && releaseRel <= early && releaseRel <= endRel;
    let dying: number;
    if (channel) {
      dying = age > CHANNEL_LIFE - CHANNEL_FADE ? clamp01((age - (CHANNEL_LIFE - CHANNEL_FADE)) / CHANNEL_FADE) : 0;
      if (T > endRel) dying = Math.max(dying, clamp01((T - endRel) / WINK));
    } else {
      const outS = T - stop;
      if (outS > (burst ? life : WINK)) continue;
      dying = outS > 0 ? clamp01(outS / (burst ? life : WINK)) : 0;
    }
    const appear = clamp01(age / APPEAR);
    const flick = 0.82 + 0.18 * Math.sin(age * 23 + ph) * Math.sin(age * 7.1 + ph * 2);
    const flash = burst ? Math.max(0, 1 - Math.abs(T - releaseRel) / FLARE) : 0;   // they flare as the spell leaves
    const alpha = appear * (1 - dying) * flick;
    if (alpha <= 0.01) continue;
    const scale = 1 + 0.4 * (burst ? dying : 0);   // full size from the first frame; it only grows in the burst
    let cx: number, cy: number, cz: number, face: number;
    if (prim) {
      // a ring round the spell's path spinning in front of the hand; on the release it spirals forward along the path, widening
      const run = burst ? easeOut(dying) : 0;
      const th = (i / n) * Math.PI * 2 + VORTEX_SPIN * age * (1 - 0.5 * run);
      // each rune runs its own share of the way, so the ring draws out into a corkscrew along the path
      const share = 0.35 + 0.65 * ((i * 5) % n) / n;
      const d = VORTEX_D + (i % 3) * 0.05 + run * VORTEX_RUN * share, rad = VORTEX_R * (0.5 + 0.5 * appear) + run * 0.25;
      cx = r.x + ca * d + px_ * Math.cos(th) * rad;
      cz = r.z + sa * d + pz_ * Math.cos(th) * rad;
      cy = 0.7 + Math.sin(th) * rad;
      face = r.aim;
    } else {
      // on a sphere round the caster turning on its own tilted axis: slow over a wind-up, quicker over the short instant swirl
      const kz = hash3(seed, i, 6) * 2 - 1, ka = hash3(seed, i, 7) * Math.PI * 2, kr = Math.sqrt(1 - kz * kz);
      const kx_ = kr * Math.cos(ka), ky_ = kz, kz_ = kr * Math.sin(ka);
      const pz0 = hash3(seed, i, 8) * 2 - 1, pa0 = hash3(seed, i, 9) * Math.PI * 2, pr0 = Math.sqrt(1 - pz0 * pz0);
      const p0x = pr0 * Math.cos(pa0), p0y = pz0, p0z = pr0 * Math.sin(pa0);
      const rad = SPHERE_R0 + hash3(seed, i, 10) * (SPHERE_R1 - SPHERE_R0);
      const spin = (0.5 + hash3(seed, i, 11) * 0.5) * (i % 2 ? 1 : -1);
      const rate = channel ? CHANNEL_RATE : Math.min(SPIN_MAX, Math.max(1, SPIN_REF / releaseRel));
      const ang = spin * rate * Math.min(age, stop - born), c = Math.cos(ang), s = Math.sin(ang);
      const dot = (p0x * kx_ + p0y * ky_ + p0z * kz_) * (1 - c);
      const tx = p0x * c + (ky_ * p0z - kz_ * p0y) * s + kx_ * dot;
      const ty = p0y * c + (kz_ * p0x - kx_ * p0z) * s + ky_ * dot;
      const tz = p0z * c + (kx_ * p0y - ky_ * p0x) * s + kz_ * dot;
      const push = burst ? easeOut(dying) * 1.3 : 0;   // the burst outward
      const rr = rad + push;
      cx = r.x + tx * rr; cz = r.z + tz * rr;
      cy = Math.max(0.08, SPHERE_Y + ty * rr * 0.8) + 0.04 * Math.sin(age * 2.3 + ph);
      face = Math.atan2(tz, tx);
    }
    // the rune's own plane: upright and facing away from the caster on the sphere; a primary's faces the camera (else it shows edge-on)
    let hx: number, hy: number, hz: number, vx: number, vy: number, vz: number;
    if (prim) { hx = ax.right[0]; hy = ax.right[1]; hz = ax.right[2]; vx = ax.up[0]; vy = ax.up[1]; vz = ax.up[2]; }
    else { hx = -Math.sin(face); hy = 0; hz = Math.cos(face); vx = 0; vy = 1; vz = 0; }
    const nx = hy * vz - hz * vy, ny = hz * vx - hx * vz, nz = hx * vy - hy * vx;
    const big = prim ? 1 : SPHERE_SIZE;
    const u = RUNE_U * scale * big;
    const col = pal.runes[Math.floor(hash3(seed, i, 16) * pal.runes.length) % pal.runes.length];
    core[0] = lerp(pal.core[0], 1, flash); core[1] = lerp(pal.core[1], 1, flash); core[2] = lerp(pal.core[2], 1, flash);
    const wide = 0.7 * PX * scale * big, wideExt = 0.25 * PX * big, thin = 0.28 * PX * scale * big, thinExt = 0.12 * PX * big;
    const bandA = (prim ? 0.5 : 0.35) * alpha, coreA = 0.95 * alpha;
    for (let k = 0; k < glyph.length; k++) {
      const st = glyph[k];
      // a dying rune's strokes drift apart
      const ox = (hash3(seed, i, 12 + (k % 4)) - 0.5) * 0.08 * dying, oy = hash3(seed, i, 12 + ((k + 1) % 4)) * 0.06 * dying;
      gridPoint(pa, st[0], st[1], cx, cy, cz, hx, hy, hz, vx, vy, vz, u, ox, oy);
      gridPoint(pb, st[2], st[3], cx, cy, cz, hx, hy, hz, vx, vy, vz, u, ox, oy);
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2], l = Math.hypot(dx, dy, dz) || 1;
      const ex = dx / l, ey = dy / l, ez = dz / l;
      // side = the plane's normal x along
      const sx = ny * ez - nz * ey, sy = nz * ex - nx * ez, sz = nx * ey - ny * ex;
      band(T_, pa, pb, sx, sy, sz, ex, ey, ez, wide / 2, wideExt, col[0], col[1], col[2], bandA);
      band(T_, pa, pb, sx, sy, sz, ex, ey, ez, thin / 2, thinExt, core[0], core[1], core[2], coreA);
    }
    const g = bandA * (1 + flash);
    rgb[0] = col[0] * g; rgb[1] = col[1] * g; rgb[2] = col[2] * g;
    pushGlow(out.glows, cx, cy, cz, prim ? 0.15 : 0.12 * big, rgb, ctx.cam);
    sum += alpha * (1 + flash);
  }
  const k = Math.min(1.6, sum / ((channel ? CHANNEL_LIFE / CHANNEL_GAP : n) * 0.6));
  return prim ? k * 0.5 : k;
}

/** One stroke as a quad: half-width `o` along the side direction, `ext` longer at both ends. */
function band(T: FxOut['tris'], a: readonly number[], b: readonly number[], sx: number, sy: number, sz: number, ex: number, ey: number, ez: number,
  o: number, ext: number, r: number, g: number, bl: number, al: number): void {
  const ox = sx * o, oy = sy * o, oz = sz * o, qx = ex * ext, qy = ey * ext, qz = ez * ext;
  const x0 = a[0] - ox - qx, y0 = a[1] - oy - qy, z0 = a[2] - oz - qz;
  const x1 = a[0] + ox - qx, y1 = a[1] + oy - qy, z1 = a[2] + oz - qz;
  const x2 = b[0] + ox + qx, y2 = b[1] + oy + qy, z2 = b[2] + oz + qz;
  const x3 = b[0] - ox + qx, y3 = b[1] - oy + qy, z3 = b[2] - oz + qz;
  T.tri(x0, y0, z0, x1, y1, z1, x2, y2, z2, r, g, bl, al);
  T.tri(x0, y0, z0, x2, y2, z2, x3, y3, z3, r, g, bl, al);
}

const figOf = (figs: readonly DrawnFig[], id: number): DrawnFig | null => {
  for (let i = 0; i < figs.length; i++) if (figs[i].id === id) return figs[i];
  return null;
};

/** Ends the cast when it is broken off (see the design's §4): the runes wink out where they stand. */
function judge(r: RuneRec, frame: FxFrame, fig: DrawnFig | null, now: number): void {
  if (r.end !== null) return;
  if (r.release !== null && now >= r.release) return;   // a cast that left cannot be broken off
  const e = frame.ents.get(r.caster);
  if (e && ((e.flags & FLAG.DEAD) !== 0 || has(e.effects, EFFECT.Frozen) || has(e.effects, EFFECT.Petrified) || has(e.effects, EFFECT.Sleep))) {
    r.end = now;
    return;
  }
  if (!fig) {
    if (r.lost < 0) r.lost = now;
    else if (now - r.lost > LEAVE) r.end = now;
    return;
  }
  r.lost = -1;
  if (r.mode === 'channel') {
    if (fig.anim !== ANIM.Channel) r.end = now;
  } else if ((r.mode === 'windup' || (r.mode === 'primary' && r.release !== null && r.release - r.start > PRIMARY_SWIRL + 1e-6)) && now - r.start > GRACE) {
    if (fig.anim === ANIM.Idle || fig.anim === ANIM.Move || (e && (e.flags & FLAG.HURT) !== 0)) r.end = now;
  }
}

/** True while a record still has a picture to draw. */
function live(r: RuneRec, now: number): boolean {
  if (r.end !== null) return now - r.end <= WINK;
  if (r.release === null) return true;
  return now - r.release <= BURST_MAX;
}

/** The drawer of the `Cast` records. Returns false when the record has nothing left to draw (the system drops it). */
export function drawRunes(out: FxOut, frame: FxFrame, rec: FxRec): boolean {
  const r = rec.rune;
  if (!r) return false;
  const now = frame.ctx.now;
  const fig = figOf(frame.figs, r.caster);
  judge(r, frame, fig, now);
  if (!live(r, now)) return false;
  if (frame.hidden.has(r.caster)) return true;
  const k = runeTris(out, frame.ctx, r, fig, now);
  if (k > 0.02 && out.lights.length < FX_LIGHT_CAP) {
    const pal = r.mode === 'channel' ? r.pal : RUNE_PALETTES[r.look as RuneLookId] ?? RUNE_PALETTES[RUNE_LOOK.Fire];
    if (pal) {
      // like the runes, the light follows the caster until the release (or the end), then stays at the spot
      const following = fig !== null && (r.release === null || now < r.release) && (r.end === null || now < r.end);
      const lc: Cand = {
        id: `m${r.caster}.9`, kind: LIGHT_KIND.Magic, x: following ? fig.x : r.x, y: LIGHT_Y, z: following ? fig.z : r.z, radius: LIGHT_RADIUS,
        r: pal.light[0] * k, g: pal.light[1] * k, b: pal.light[2] * k, shadow: true, skip: -1, base: Math.max(pal.light[0], pal.light[1], pal.light[2]) * k,
      };
      out.lights.push(lc);
    }
  }
  return true;
}

/** Registers the rune drawer (idempotent). */
export function registerRunes(): void {
  registerFx(FX_KIND.Cast, drawRunes);
}

// Arrows, bolts and the thrown axe as 3D objects (#407): the shots that have a pack frame in `PROJECTILES`. A slender arrow points
// along its flight (pitched along #321's arc) and stays stuck at its landing angle; the axe tumbles end over end and lands blade down.
// Every one of them draws the same trail (pale, lit by the room); a magic shot (a colour: `PROJECTILES[kind].magic`, or the frame's
// `shotMagic`) glows in that colour and leaves tiny sparkles where it passed. The flight's direction, the trail and the sparkles come
// from each shot's own short history of drawn positions, so nothing here knows the arc. Drawn for this game with Claude Code.
import { isProjectileKind, PROJECTILES } from '../../game/anim/defs';
import { CONST, KIND } from '../../generated/defs';
import { TILE } from '../../sim/map';
import { pushGlow } from '../cards';
import { ART } from '../camera';
import type { FxFrame } from './effects3d';
import { hash3 } from './rand';
import { dot, PX, streak, type V3 } from './shapes';
import type { FxTris } from './tris';
import type { FxOut, StuckShot } from './types';

/** The trail of every frame shot: opacity at the shot, seconds of flight it covers, width in tiles (the user's numbers, #407). */
export const TRAIL = { alpha: 0.6, secs: 0.3, width: 0.04 };
/** A magic shot's sparkles: born per second of flight, and how long each twinkles where it was born. */
const SPARK_RATE = 160, SPARK_LIFE = 0.75;
/** A shot's history outlives the shot by this, for the fading trail and sparkles. */
const KEEP = SPARK_LIFE + 0.05;
/** The axe's tumble (rad/s, as the card's spin) and the angle it rests at: blade down and forward. */
const SPIN = 14, AXE_REST = 2.1;
/** A stuck arrow's pitch below the level when its flight was never seen (rad), and the limits of a seen one. */
const STUCK_PITCH = 0.44, PITCH_MIN = 0.15, PITCH_MAX = 1.2;
/** How deep a stuck arrow's tip sits in the ground, and how high a resting axe's pivot (tiles). */
const TIP_IN = 0.1, AXE_REST_Y = 0.16;
const PALE: V3 = [0.92, 0.92, 0.86];
const SUN: V3 = [-0.45, 0.8, -0.4];

export const isFrameShot = (kind: number): boolean => isProjectileKind(kind) && !!PROJECTILES[kind]?.frame;
const isAxe = (kind: number): boolean => kind === KIND.ThrownAxe;
const rgb = (c: number): V3 => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

/** A flat-shaded shape in its own three axes: 9 numbers a triangle, its outward normal and its colour. */
interface Shape { tris: number[]; normal: number[]; colour: number[] }
type P3 = readonly [number, number, number];
function shape(): Shape & { tri(a: P3, b: P3, c: P3, col: V3, mid: P3): void; quad(a: P3, b: P3, c: P3, d: P3, col: V3, mid: P3): void } {
  const s: Shape = { tris: [], normal: [], colour: [] };
  const tri = (a: P3, b: P3, c: P3, col: V3, mid: P3): void => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12) return;
    // the normal points away from `mid`
    if (n[0] * (a[0] + b[0] + c[0] - 3 * mid[0]) + n[1] * (a[1] + b[1] + c[1] - 3 * mid[1]) + n[2] * (a[2] + b[2] + c[2] - 3 * mid[2]) < 0) n = [-n[0], -n[1], -n[2]];
    s.tris.push(...a, ...b, ...c); s.normal.push(n[0] / l, n[1] / l, n[2] / l); s.colour.push(...col);
  };
  return { ...s, tri, quad: (a, b, c, d, col, mid) => { tri(a, b, c, col, mid); tri(a, c, d, col, mid); } };
}

const WOOD = rgb(0x8f4029), WOOD_LIGHT = rgb(0xc56025), HEAD = rgb(0xb6cbcf), WHITE = rgb(0xfdf7ed), RED = rgb(0xda4e38), STEEL = rgb(0x72d6ce), STEEL_DARK = rgb(0x55a894);

/** The arrow's length and its shaft's width (tiles). */
export const ARROW = { len: 0.78, shaft: 0.018 };
/** The arrow along its first axis, its middle at 0 and its tip at `len / 2`; tiles. */
const ARROW_SHAPE = ((): Shape => {
  const S = shape(), L = ARROW.len, w = ARROW.shaft, tip = L / 2, tail = -L / 2;
  const hl = 0.13, hw = w * 2.3, ht = w * 0.8, r = w / 2, fw = w * 2.4;
  // the head: a flat four-sided point
  const hb: P3[] = [[tip - hl, hw, 0], [tip - hl, 0, ht], [tip - hl, -hw, 0], [tip - hl, 0, -ht]], hm: P3 = [tip - hl * 0.7, 0, 0];
  for (let i = 0; i < 4; i++) S.tri([tip, 0, 0], hb[i], hb[(i + 1) % 4], HEAD, hm);
  S.quad(hb[0], hb[1], hb[2], hb[3], HEAD, [tip, 0, 0]);
  // the shaft
  const c = (a: number, i: number): P3 => [a, i === 0 ? r : i === 2 ? -r : 0, i === 1 ? r : i === 3 ? -r : 0];
  for (let i = 0; i < 4; i++) S.quad(c(tip - hl, i), c(tip - hl, (i + 1) % 4), c(tail, (i + 1) % 4), c(tail, i), WOOD, [0, 0, 0]);
  // four vanes: red by the shaft, white outside
  for (let i = 0; i < 4; i++) {
    const s = i === 0 ? 1 : i === 2 ? -1 : 0, u = i === 1 ? 1 : i === 3 ? -1 : 0;
    const v = (a: number, off: number): P3 => [tail + a, s * off, u * off];
    // a vane is seen from both sides: its normal leans up and to the light
    const far: P3 = [0, -u * 9 - s, -9 + s * 3 - u];
    S.quad(v(0.2, r), v(0.17, fw * 0.5), v(0.03, fw * 0.5), v(0.01, r), RED, far);
    S.quad(v(0.17, fw * 0.5), v(0.14, fw), v(0.02, fw), v(0.03, fw * 0.5), WHITE, far);
  }
  return S;
})();

/** The axe: first axis up the handle, second toward the blade's edge, third its thickness; sprite px from the pivot (where the head
 *  meets the handle), read off the pack's `weapon_throwing_axe`. */
const AXE_TIP: readonly [number, number] = [1.5, 4.5];   // (along the handle, toward the edge): the middle of the cutting edge
const AXE_SHAPE = ((): Shape => {
  const S = shape();
  // the handle: a six-sided rod, lighter toward the blade
  const top = 4.5, bottom = -7.5, hb = -0.5, hr = 0.9;
  const ring = (a: number, k: number): P3 => [a, hb + hr * Math.cos((k * Math.PI) / 3), hr * Math.sin((k * Math.PI) / 3)];
  for (let k = 0; k < 6; k++) {
    S.quad(ring(top, k), ring(top, k + 1), ring(bottom, k + 1), ring(bottom, k), k === 0 || k === 5 ? WOOD_LIGHT : WOOD, [0, hb, 0]);
    S.tri([top, hb, 0], ring(top, k), ring(top, k + 1), WOOD_LIGHT, [0, hb, 0]);
    S.tri([bottom, hb, 0], ring(bottom, k), ring(bottom, k + 1), WOOD, [0, hb, 0]);
  }
  // the head: its outline as (toward the edge, along the handle, half thickness), from the poll round the flaring blade
  const E: [number, number, number][] = [[3.4, 4.5, 0.3], [4.2, 3.2, 0], [4.5, 1.5, 0], [4.2, -0.6, 0], [3.4, -2.5, 0.3]];
  const O: [number, number, number][] = [[-3.5, 0.5, 0.6], [-3.5, 2.5, 0.6], [1.5, 2.6, 0.75], ...E, [1.5, 0.4, 0.75]];
  // the bright cutting edge is a band: the steel ends a little before it
  const inner = O.map(([b, a, h]): [number, number, number] => (h === 0 ? [b - 1.1, 1.5 + (a - 1.5) * 0.85, 0.32] : [b, a, h]));
  const mid: P3 = [1.5, 1.2, 0], cb = 1.5, ca = 1.5, ch = 0.8;
  for (const side of [1, -1]) {
    const p = (q: [number, number, number]): P3 => [q[1], q[0], q[2] * side];
    for (let i = 0; i < O.length; i++) {
      const j = (i + 1) % O.length;
      S.tri([ca, cb, ch * side], p(inner[i]), p(inner[j]), i >= 7 || i === 0 ? STEEL_DARK : STEEL, mid);
      if (O[i][2] === 0 || O[j][2] === 0) S.quad(p(inner[i]), p(inner[j]), p(O[j]), p(O[i]), WHITE, mid);
    }
  }
  // the rim where the two sides do not meet (the poll and the neck)
  for (let i = 0; i < O.length; i++) {
    const j = (i + 1) % O.length;
    if (O[i][2] > 0 && O[j][2] > 0) S.quad([O[i][1], O[i][0], O[i][2]], [O[j][1], O[j][0], O[j][2]], [O[j][1], O[j][0], -O[j][2]], [O[i][1], O[i][0], -O[i][2]], STEEL_DARK, mid);
  }
  return S;
})();

/** Draws `s` at `o` with its three axes along the unit vectors e0, e1, e2, `k` tiles a unit. */
function drawShape(T: FxTris, s: Shape, o: V3, e0: V3, e1: V3, e2: V3, k: number, alpha: number): void {
  const t = s.tris, n = s.normal, c = s.colour;
  const X = (i: number): number => o[0] + (t[i] * e0[0] + t[i + 1] * e1[0] + t[i + 2] * e2[0]) * k;
  const Y = (i: number): number => o[1] + (t[i] * e0[1] + t[i + 1] * e1[1] + t[i + 2] * e2[1]) * k;
  const Z = (i: number): number => o[2] + (t[i] * e0[2] + t[i + 1] * e1[2] + t[i + 2] * e2[2]) * k;
  for (let i = 0, q = 0; i < t.length; i += 9, q += 3) {
    const nx = n[q] * e0[0] + n[q + 1] * e1[0] + n[q + 2] * e2[0], ny = n[q] * e0[1] + n[q + 1] * e1[1] + n[q + 2] * e2[1], nz = n[q] * e0[2] + n[q + 1] * e1[2] + n[q + 2] * e2[2];
    const sh = 0.62 + 0.38 * (nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
    T.tri(X(i), Y(i), Z(i), X(i + 3), Y(i + 3), Z(i + 3), X(i + 6), Y(i + 6), Z(i + 6), c[q] * sh, c[q + 1] * sh, c[q + 2] * sh, alpha);
  }
}

/** An arrow with its middle at `p`, flying along the unit vector `d`. */
function drawArrow(T: FxTris, p: V3, d: V3, alpha: number): void {
  // side = d x up (level), third = side x d
  let sx = -d[2], sz = d[0];
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-6) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }
  drawShape(T, ARROW_SHAPE, p, d, [sx, 0, sz], [-sz * d[1], sz * d[0] - sx * d[2], sx * d[1]], 1, alpha);
}

/** The axe's axes at tumble angle `th`, flying level along (hx, hz): up the handle, toward the edge, across. */
function axeAxes(hx: number, hz: number, th: number): [V3, V3, V3] {
  const c = Math.cos(th), s = Math.sin(th);
  return [[hx * s, c, hz * s], [hx * c, -s, hz * c], [-hz, 0, hx]];
}

/** One drawn position of a shot: where it was (tiles, y up) and where its trail passes (the axe's blade; the shot itself otherwise). */
interface Sample { t: number; x: number; y: number; z: number; tx: number; ty: number; tz: number }
interface Track { kind: number; magic: number | undefined; born: number; seen: number; s: Sample[]; d: [number, number, number] }

/** The frame shots of one run: their histories, drawn every frame by `Effects3d.frame`. */
export class FrameShots {
  private tracks = new Map<number, Track>();

  /** The unit direction a tracked shot flew last, or null (tests). */
  dirOf(key: number): readonly [number, number, number] | null {
    return this.tracks.get(key)?.d ?? null;
  }

  /** Notes a shot's drawn position of this frame. `y` is its height in tiles, `aim` its level direction (rad). */
  private see(key: number, kind: number, now: number, x: number, y: number, z: number, aim: number, magic: number | undefined): void {
    let tr = this.tracks.get(key);
    // a new shot, or the clock went back (a dev page's loop): a fresh history
    if (!tr || tr.kind !== kind || now < tr.seen) { tr = { kind, magic, born: now, seen: now, s: [], d: [Math.cos(aim), 0, Math.sin(aim)] }; this.tracks.set(key, tr); }
    tr.seen = now; tr.magic = magic;
    const s = tr.s;
    if (s.length && s[s.length - 1].t === now) s.pop();
    // the direction: from the last position at least 30 ms old (one frame's step is too jittery under interpolation)
    for (let i = s.length - 1; i >= 0; i--) {
      if (now - s[i].t < 0.03 && i > 0) continue;
      const dx = x - s[i].x, dy = y - s[i].y, dz = z - s[i].z, l = Math.hypot(dx, dy, dz);
      if (l > 1e-4) tr.d = [dx / l, dy / l, dz / l];
      break;
    }
    let tx = x, ty = y, tz = z;
    if (isAxe(kind)) {
      const k = PROJECTILES[kind].scale / 16, [a, b] = this.axes(tr, now);
      tx += (a[0] * AXE_TIP[0] + b[0] * AXE_TIP[1]) * k; ty += (a[1] * AXE_TIP[0] + b[1] * AXE_TIP[1]) * k; tz += (a[2] * AXE_TIP[0] + b[2] * AXE_TIP[1]) * k;
    }
    s.push({ t: now, x, y, z, tx, ty, tz });
    while (s.length > 1 && now - s[0].t > KEEP) s.shift();
  }

  private axes(tr: Track, now: number): [V3, V3, V3] {
    const l = Math.hypot(tr.d[0], tr.d[2]) || 1;
    return axeAxes(tr.d[0] / l, tr.d[2] / l, SPIN * (now - tr.born));
  }

  /** Draws the frame's flying shots, what they leave behind, and the stuck ones. */
  draw(out: FxOut, f: FxFrame): void {
    const now = f.ctx.now, ax = f.ctx.ax;
    const magicOf = (id: number, kind: number): number | undefined => f.shotMagic?.get(id) ?? PROJECTILES[kind].magic;
    for (const e of f.ents.values()) {
      if (!isFrameShot(e.kind) || f.hiddenShots.has(e.id)) continue;
      this.see(e.id, e.kind, now, e.x / TILE, (e.z ?? CONST.SHOT_HEIGHT) / ART, e.y / TILE, e.aim, magicOf(e.id, e.kind));
    }
    // the own predicted shots: their numbers never meet the entity ids
    for (const s of f.shots) if (isFrameShot(s.kind)) this.see(-1 - s.shot, s.kind, now, s.x / TILE, s.z / ART, s.y / TILE, Math.atan2(s.vy, s.vx), PROJECTILES[s.kind].magic);

    for (const [key, tr] of this.tracks) {
      if (now - tr.seen > KEEP || now < tr.seen) { this.tracks.delete(key); continue; }
      const s = tr.s, last = s[s.length - 1], col = tr.magic === undefined ? null : rgb(tr.magic);
      if (tr.seen === now) {
        const p: V3 = [last.x, last.y, last.z];
        if (isAxe(tr.kind)) { const [a, b, c] = this.axes(tr, now); drawShape(out.lit, AXE_SHAPE, p, a, b, c, PROJECTILES[tr.kind].scale / 16, 1); }
        else drawArrow(out.lit, p, tr.d, 1);
        if (col) pushGlow(out.glows, p[0], p[1], p[2], 0.4, [col[0] * 0.45, col[1] * 0.45, col[2] * 0.45], f.ctx.cam);
      }
      // the trail: through the drawn positions of the last `TRAIL.secs`, fading with their age
      const T = col ? out.tris : out.lit, c = col ?? PALE;
      for (let i = s.length - 1; i > 0; i--) {
        const a0 = TRAIL.alpha * (1 - (now - s[i].t) / TRAIL.secs), a1 = TRAIL.alpha * (1 - (now - s[i - 1].t) / TRAIL.secs);
        if (a0 <= 0) break;
        streak(T, ax, [s[i].tx, s[i].ty, s[i].tz], [s[i - 1].tx, s[i - 1].ty, s[i - 1].tz], TRAIL.width, c, a0, Math.max(0, a1));
      }
      if (col) this.sparkles(out, f, tr, col, key);
    }

    for (const st of f.stuck ?? []) {
      if (st.pitch === undefined) this.settle(st);
      const hx = Math.cos(st.aim), hz = Math.sin(st.aim), x = st.x / TILE, z = st.y / TILE;
      if (isAxe(st.kind)) {
        const [a, b, c] = axeAxes(hx, hz, AXE_REST);
        drawShape(out.lit, AXE_SHAPE, [x, AXE_REST_Y * PROJECTILES[st.kind].scale, z], a, b, c, PROJECTILES[st.kind].scale / 16, st.alpha);
      } else {
        const cp = Math.cos(st.pitch!), d: V3 = [hx * cp, -Math.sin(st.pitch!), hz * cp], back = TIP_IN - ARROW.len / 2;
        drawArrow(out.lit, [x + d[0] * back, d[1] * back, z + d[2] * back], d, st.alpha);
      }
      if (st.magic !== undefined) {
        const c = rgb(st.magic), k = 0.45 * st.alpha * st.left;
        pushGlow(out.glows, x, 0.15, z, 0.4, [c[0] * k, c[1] * k, c[2] * k], f.ctx.cam);
      }
    }
  }

  /** A stuck shot takes its landing angle and its magic from the flight that ended nearest to it (within 1.5 tiles). */
  private settle(st: StuckShot): void {
    let best: Track | null = null, bd = 1.5;
    for (const tr of this.tracks.values()) {
      if (tr.kind !== st.kind) continue;
      const l = tr.s[tr.s.length - 1], d = Math.hypot(l.x - st.x / TILE, l.z - st.y / TILE);
      if (d < bd) { bd = d; best = tr; }
    }
    st.pitch = best && best.d[1] < 0 ? Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.asin(-best.d[1]))) : STUCK_PITCH;
    st.magic = best ? best.magic : PROJECTILES[st.kind].magic;
  }

  /** Sparkle n is born `n / SPARK_RATE` s on the clock, where the shot was then; it drifts up a little, twinkles and fades. */
  private sparkles(out: FxOut, f: FxFrame, tr: Track, col: V3, key: number): void {
    const now = f.ctx.now, ax = f.ctx.ax, s = tr.s, seed = key | 0;
    const light: V3 = [col[0] * 0.4 + 0.6, col[1] * 0.4 + 0.6, col[2] * 0.4 + 0.6];
    let i = s.length - 1;
    for (let n = Math.floor(tr.seen * SPARK_RATE); n >= 0; n--) {
      const born = n / SPARK_RATE, age = now - born;
      if (age > SPARK_LIFE || born < s[0].t) break;
      while (i > 0 && s[i - 1].t >= born) i--;
      const a = s[Math.max(0, i - 1)], b = s[i], u = b.t > a.t ? Math.min(1, Math.max(0, (born - a.t) / (b.t - a.t))) : 0;
      const k = age / SPARK_LIFE, sp = 0.03 + 0.1 * k;
      const x = a.x + (b.x - a.x) * u + (hash3(seed, n, 91) - 0.5) * sp * 2, y = a.y + (b.y - a.y) * u + (hash3(seed, n, 92) - 0.5) * sp * 2 + 0.12 * age, z = a.z + (b.z - a.z) * u + (hash3(seed, n, 93) - 0.5) * sp * 2;
      const tw = Math.max(0, Math.sin(age * (18 + 20 * hash3(seed, n, 94)) + hash3(seed, n, 95) * 6.28));
      const al = (1 - k) ** 0.6 * (0.25 + 0.75 * tw), c = n % 3 === 0 ? light : col;
      dot(out.tris, ax, x, y, z, PX * (0.2 + 0.2 * hash3(seed, n, 96)), c[0], c[1], c[2], al);
      // one in seven flashes as a tiny four-pointed star
      if (n % 7 === 0 && tw > 0.6) {
        const r = PX * 0.9 * tw, R = ax.right, U = ax.up;
        streak(out.tris, ax, [x - R[0] * r, y - R[1] * r, z - R[2] * r], [x + R[0] * r, y + R[1] * r, z + R[2] * r], PX * 0.14, c, al, al);
        streak(out.tris, ax, [x - U[0] * r, y - U[1] * r, z - U[2] * r], [x + U[0] * r, y + U[1] * r, z + U[2] * r], PX * 0.14, c, al, al);
      }
    }
  }
}

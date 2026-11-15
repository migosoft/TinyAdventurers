// Ground hazards in 3D (#308, design §6): burning ground (FirePatch), consecrated ground (HolyGround) and entangling roots (Roots).
// The 2D original is `PhaserRunView.drawHazard`: a glow of the hazard's radius (the `aim` field, px; the look's when 0) whose strength
// follows the remaining life (`extra`, ms, full from 500) with a flicker, and rising sparks. Each picture is a pure function of the
// clock and the entity's id. The light is the server's (no client light).
import { isHazardKind } from '../../game/anim/defs';
import { HAZARD_LOOKS } from '../../game/fxLooks';
import { KIND } from '../../generated/defs';
import { TILE } from '../../sim/map';
import { registerFrameFx, type FxFrame } from './effects3d';
import { hash3 } from './rand';
import { BALL1, dot, fireBall, groundRing, PX, streak, type MV3, type V3 } from './shapes';
import type { FxTris } from './tris';
import type { FxOut } from './types';

/** The strength of a hazard: `min(1, extra / 500)` times the flicker times the look's own, as 2D sets the glow's alpha. */
export function hazardStrength(extra: number, now: number, id: number, lookAlpha: number): number {
  return Math.min(1, extra / 500) * (0.7 + 0.3 * Math.sin(now / 0.07 + id)) * lookAlpha;
}

/** Half extents of the hazard on the floor (tiles): the radius (`aim` px, else the look's) times the look's squash. Only the fire patch is squashed in 3D (the others' 0.7 is 2D's foreshortening, which the camera does here). */
export function hazardRadii(kind: number, aim: number): { rx: number; rz: number } {
  const look = HAZARD_LOOKS[kind], r = (aim > 0 ? aim : look.r) / TILE;
  return kind === KIND.FirePatch ? { rx: r * look.sx, rz: r * look.sy } : { rx: r, rz: r };
}

const rgbIn = (c: number, out: MV3): MV3 => { out[0] = ((c >> 16) & 255) / 255; out[1] = ((c >> 8) & 255) / 255; out[2] = (c & 255) / 255; return out; };
const c0: MV3 = [0, 0, 0], c1: MV3 = [0, 0, 0];
const pa: MV3 = [0, 0, 0], pb: MV3 = [0, 0, 0];

/** A flat ellipse on the floor at height `y`, alpha `aMid` in the middle and `aEdge` at the rim. */
function ellipse(T: FxTris, x: number, z: number, y: number, rx: number, rz: number, rgb: V3, aMid: number, aEdge: number, steps = 24): void {
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2, b = ((i + 1) / steps) * Math.PI * 2;
    T.tri(x, y, z, x + Math.cos(a) * rx, y, z + Math.sin(a) * rz, x + Math.cos(b) * rx, y, z + Math.sin(b) * rz, rgb[0], rgb[1], rgb[2], aMid, aEdge, aEdge);
  }
}

/** Rising motes: `n` live at a time, each born at a spot of the disc (radius `r`, `zk` squash) and rising `rise` tiles/s for `life` s. */
function motes(T: FxTris, frame: FxFrame, id: number, x: number, z: number, r: number, zk: number, n: number, life: number, rise: number, cols: readonly number[], size: number): void {
  const ax = frame.ctx.ax, now = frame.ctx.now;
  for (let i = 0; i < n; i++) {
    const t = now / life + i / n + hash3(id, i, 9), cyc = Math.floor(t), ph = t - cyc, sd = id * 131 + i;
    const a = hash3(sd, cyc, 0) * Math.PI * 2, d = Math.sqrt(hash3(sd, cyc, 1)) * r;
    rgbIn(cols[Math.floor(hash3(sd, cyc, 2) * cols.length) % cols.length], c0);
    dot(T, ax, x + Math.cos(a) * d, 0.05 + (rise * (0.7 + 0.6 * hash3(sd, cyc, 3))) * ph * life, z + Math.sin(a) * d * zk, size, c0[0], c0[1], c0[2], 1 - ph * ph);
  }
}

const EMBER: MV3 = [1, 0x50 / 255, 0x10 / 255], GOLD: MV3 = [1, 0xd0 / 255, 0x40 / 255], VINE: MV3 = [0x40 / 255, 0xa0 / 255, 0x40 / 255];

function fire(out: FxOut, frame: FxFrame, id: number, x: number, z: number, rx: number, rz: number, s: number): void {
  const T = out.tris, ctx = frame.ctx, now = ctx.now, look = HAZARD_LOOKS[KIND.FirePatch];
  ellipse(T, x, z, 0.02, rx, rz, EMBER, Math.min(1, s * 0.8), 0, 20);
  // six flame tongues hop about the disc, each to a new spot now and then
  for (let i = 0; i < 6; i++) {
    const t = now / 0.45 + i * 0.37, cyc = Math.floor(t), sd = id * 17 + i;
    const a = hash3(sd, cyc, 0) * Math.PI * 2, d = Math.sqrt(hash3(sd, cyc, 1)) * 0.8;
    const k = 0.5 + 0.5 * s;
    fireBall(T, BALL1, x + Math.cos(a) * d * rx, 0.08 * k, z + Math.sin(a) * d * rz, 0.08 * k, now * 1.3 + i, sd, 0.7, (1 - s) * 0.5, true);
  }
  motes(T, frame, id, x, z, rx, rz / rx, Math.max(3, Math.round(15 * ctx.detail)), 0.5, look.rise / TILE, look.colors, PX * 1.5);
}

function holy(out: FxOut, frame: FxFrame, id: number, x: number, z: number, r: number, s: number): void {
  const T = out.tris, look = HAZARD_LOOKS[KIND.HolyGround];
  ellipse(T, x, z, 0.02, r, r, GOLD, Math.min(1, s * 0.9), Math.min(1, s * 0.15), 32);
  groundRing(T, x, z, 0.025, r * 0.9, r, GOLD, 0, Math.min(1, s * 1.4), 32);
  motes(T, frame, id, x, z, r, 1, Math.max(2, Math.round(5 * frame.ctx.detail)), 0.8, look.rise / TILE, look.colors, PX * 1.5);
}

function roots(out: FxOut, frame: FxFrame, id: number, x: number, z: number, r: number, s: number): void {
  const T = out.tris, L = out.lit, ctx = frame.ctx, now = ctx.now, look = HAZARD_LOOKS[KIND.Roots];
  ellipse(L, x, z, 0.02, r, r, VINE, Math.min(1, s * 0.5), Math.min(1, s * 0.1), 24);
  const a = Math.min(1, s * 1.6);
  rgbIn(0x60c050, c1);
  // ten vine strands: curled lines on the floor from near the middle to near the rim, swaying a little; six leaves at their tips
  for (let i = 0; i < 10; i++) {
    const sd = id * 29 + i, ang = hash3(sd, 0, 0) * Math.PI * 2, bend = (hash3(sd, 0, 1) - 0.5) * 1.6, len = r * (0.55 + 0.4 * hash3(sd, 0, 2));
    let px = x + Math.cos(ang) * r * 0.12, pz = z + Math.sin(ang) * r * 0.12;
    for (let seg = 0; seg < 3; seg++) {
      const k = (seg + 1) / 3, th = ang + bend * k + Math.sin(now * 1.2 + i + seg) * 0.06;
      const nx = x + Math.cos(th) * (r * 0.12 + len * k), nz = z + Math.sin(th) * (r * 0.12 + len * k);
      pa[0] = px; pa[1] = 0.04; pa[2] = pz; pb[0] = nx; pb[1] = 0.04; pb[2] = nz;
      streak(L, ctx.ax, pa, pb, PX * (1.5 - seg * 0.3), VINE, a, a);
      px = nx; pz = nz;
    }
    if (i < 6) dot(L, ctx.ax, px, 0.06, pz, PX * 2, c1[0], c1[1], c1[2], a);
  }
  motes(T, frame, id, x, z, r, 1, Math.max(2, Math.round(6 * ctx.detail)), 0.6, look.rise / TILE, look.colors, PX);
}

/** Draws the hazards of the frame that lie in the footprint and are not hidden. */
export function drawHazards(out: FxOut, frame: FxFrame): void {
  const fp = frame.fp, now = frame.ctx.now;
  for (const e of frame.ents.values()) {
    if (!isHazardKind(e.kind) || frame.hidden.has(e.id)) continue;
    const look = HAZARD_LOOKS[e.kind];
    if (!look) continue;
    const s = hazardStrength(e.extra, now, e.id, look.alpha);
    if (s <= 0.004) continue;
    const x = e.x / TILE, z = e.y / TILE, { rx, rz } = hazardRadii(e.kind, e.aim > 0 ? e.aim : 0);
    if (fp && (x + rx < fp.x0 || x - rx > fp.x1 || z + rz < fp.z0 || z - rz > fp.z1)) continue;
    if (e.kind === KIND.FirePatch) fire(out, frame, e.id, x, z, rx, rz, s);
    else if (e.kind === KIND.HolyGround) holy(out, frame, e.id, x, z, rx, s);
    else roots(out, frame, e.id, x, z, rx, s);
  }
}

/** Registers the hazard drawer. */
export function registerHazards(): void {
  registerFrameFx(drawHazards);
}

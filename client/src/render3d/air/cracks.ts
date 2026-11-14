// Cracks (#307): a Daylight light seen as an opening in a ceiling plane. The pure model: `crackOf` turns a static light and the
// 2D sun look (lookFor, so a crack looks the same in both views) into numbers; `crackMask` is the CPU twin of the shader's mask
// (the dungeon 3D demo's `sunMask`, extended by the 2D variety: rays, the faint main beam, widening); `selectCracks` picks the
// ones worth sending; `packCracks` lays them out as the uniform arrays of the shader. No three.js, no GPU.
import { LIGHT_KIND } from '../../generated/defs';
import type { LightField, StaticLight } from '../../game/light';
import { HEIGHT_RANGE, beamShape, cloudAt, hash01, lookFor, rayGlow, rayShapes, sunLook, type SunLook } from '../../game/sunmath';
import { lightRgb } from '../lights';
import type { Footprint } from '../lights';
import { PITCH_MIN } from '../params';
import { hiddenAt, type SightMask } from '../sightmask';

/** Shader slots (first guess; the cove has 5 suns). */
export const CRACK_CAP = 8;
/** The demo's SUN_DIR z share: the light also comes from the north. */
export const CRACK_Z_TILT = -0.2;
/** The demo's soft rim: smoothstep(RIM_LO, RIM_HI, r) in the mask. */
export const RIM_LO = 0.62;
export const RIM_HI = 1.0;
/** The faint main beam's share of the light (the 2D `MAIN_ALPHA`). */
export const MAIN_ALPHA = 0.45;
/** The opening's rim middle (r about 0.81) sits at the patch's edge: rx = patch / 2 / this (first guess). */
const RIM_MID = 0.81;
/** The opening's depth against its width (the demo's 1.5 / 2.3; first guess). */
const RZ_SHARE = 0.65;
/** Width of a ray's soft edge across the opening (shares of the -1..1 span). */
const RAY_EDGE = 0.08;
/** Most rays one crack has (`SunLook.rays`). */
export const RAY_CAP = 3;

export interface Crack {
  id: number;
  /** The patch centre on the floor (the light's tile centre), tiles. */
  fx: number;
  fz: number;
  /** The ceiling height: look.height (5..7). */
  ceil: number;
  /** Unit vector toward the sun: normalize(look.dir * look.slant / look.height, 1, CRACK_Z_TILT). */
  dir: [number, number, number];
  /** The opening's ellipse half-axes (tiles, at the floor) and turn (rad, hashed from the id). */
  rx: number;
  rz: number;
  rot: number;
  /** The opening's size at the ceiling as a share of the floor's: 0.5 (look.widen) or 1. */
  widen: number;
  /** lightRgb(Daylight, colour, look.glow * cloud). */
  rgb: [number, number, number];
  /** The faint main beam's share: MAIN_ALPHA when look.main, else 0. */
  main: number;
  /** Per ray (look.rays of them): floor u0, u1 and top u0, u1, shares -1..1 across the opening. */
  rays: [number, number, number, number][];
  /** The rim's wave phase (the demo's s * 2.1, hashed from the id). */
  wave: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The crack of static light `l` at time `t` (s), with `base` as the 2D sun look (slant, direction, cloud gap). */
export function crackOf(l: StaticLight, base: SunLook, t: number): Crack {
  const look = lookFor(l.id, base);
  const cloud = cloudAt(l.id, t, look);
  const len = Math.hypot((look.dir * look.slant) / look.height, 1, CRACK_Z_TILT);
  const rx = look.patch / 2 / RIM_MID;
  const beam = beamShape(l.x, l.y, look);
  const [bl, br] = [beam.bottom[0][0], beam.bottom[1][0]];
  const [tl, tr] = [beam.top[0][0], beam.top[1][0]];
  const rays = rayShapes(beam, l.id, look).map((r): [number, number, number, number] => [
    (2 * (r.bottom[0][0] - bl)) / (br - bl) - 1,
    (2 * (r.bottom[1][0] - bl)) / (br - bl) - 1,
    (2 * (r.top[0][0] - tl)) / (tr - tl) - 1,
    (2 * (r.top[1][0] - tl)) / (tr - tl) - 1,
  ]);
  return {
    id: l.id,
    fx: l.x + 0.5,
    fz: l.y + 0.5,
    ceil: look.height,
    dir: [(look.dir * look.slant) / look.height / len, 1 / len, CRACK_Z_TILT / len],
    rx,
    rz: rx * RZ_SHARE,
    rot: hash01(l.id, 0, 30) * 2 * Math.PI,
    widen: look.widen ? 0.5 : 1,
    rgb: lightRgb(LIGHT_KIND.Daylight, l.colour, look.glow * cloud),
    main: look.main ? MAIN_ALPHA : 0,
    rays,
    wave: hash01(l.id, 0, 31) * 2 * Math.PI,
  };
}

/**
 * The light share of a crack (0..1; where rays overlap up to sqrt(rays), as the 2D rays add) at the world point (x, y, z) in tiles. Follows the sun ray from the point down to the floor, turns
 * it by `rot` and divides by the ellipse (`rx`, `rz`) scaled by s(y) = mix(1, widen, y / ceil): that is `e`. The rim is the
 * demo's wobbly ellipse; the shade is the faint main beam or the rays' bands (floor edges mixed to the top's by height), glow-scaled
 * by the ray count, times the demo's streak. 0 above the ceiling and below the floor. Keep it branch-light: the shader copies it.
 */
export function crackMask(c: Crack, x: number, y: number, z: number): number {
  if (y < 0 || y >= c.ceil) return 0;
  const k = y / c.dir[1];
  const px = x - c.dir[0] * k - c.fx;
  const pz = z - c.dir[2] * k - c.fz;
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  const s = 1 + (c.widen - 1) * (y / c.ceil);
  const ex = (px * cs + pz * sn) / (c.rx * s);
  const ey = (-px * sn + pz * cs) / (c.rz * s);
  const ang = Math.atan2(ey, ex);
  const r = Math.hypot(ex, ey) * (1 + 0.13 * Math.sin(3 * ang + c.wave) + 0.07 * Math.sin(7 * ang + 1.3));
  const rim = 1 - smooth(RIM_LO, RIM_HI, r);
  if (rim <= 0) return 0;
  const h = y / c.ceil;
  let bands = 0;
  for (const [u0, u1, t0, t1] of c.rays) {
    const lo = u0 + (t0 - u0) * h;
    const hi = u1 + (t1 - u1) * h;
    bands += smooth(lo - RAY_EDGE / 2, lo + RAY_EDGE / 2, ex) * (1 - smooth(hi - RAY_EDGE / 2, hi + RAY_EDGE / 2, ex));
  }
  const shade = Math.max(c.main, rayGlow(1, c.rays.length) * bands);
  const streak = 0.62 + 0.38 * smooth(-0.2, 0.6, Math.sin(ex * 7.5 + c.wave * 0.8 + 0.6 * Math.sin(ey * 3)));
  return rim * shade * streak;
}

/**
 * The Daylight lights worth a slot: on, near the footprint, not in the dark. Nearest to its centre first. The margin is the slant plus the
 * tallest shaft's reach along the flattest view (`HEIGHT_RANGE[1] / tan(PITCH_MIN)`: the march from a bottom-edge pixel meets a shaft that far
 * beyond the footprint) plus a tile, so no shaft pops in at the screen edge. `base` is the page's own look (default the run's).
 */
export function selectCracks(field: LightField, fp: Footprint, mask: SightMask | null, cap: number, base: SunLook = sunLook): StaticLight[] {
  const reach = HEIGHT_RANGE[1] / Math.tan((PITCH_MIN * Math.PI) / 180);
  const mx = (fp.x0 + fp.x1) / 2;
  const mz = (fp.z0 + fp.z1) / 2;
  const scored: { l: StaticLight; d: number }[] = [];
  for (const l of field.lights.values()) {
    if (l.kind !== LIGHT_KIND.Daylight || !l.on) continue;
    const m = Math.abs(lookFor(l.id, base).slant) + reach + 1;
    const cx = l.x + 0.5, cz = l.y + 0.5;
    if (cx < fp.x0 - m || cx > fp.x1 + m || cz < fp.z0 - m || cz > fp.z1 + m) continue;
    if (mask && hiddenAt(mask, cx, cz)) continue;
    scored.push({ l, d: Math.hypot(cx - mx, cz - mz) });
  }
  scored.sort((a, b) => a.d - b.d || a.l.id - b.l.id);
  return scored.slice(0, Math.max(0, cap)).map((s) => s.l);
}

/**
 * The cracks as the shader's uniform arrays, `CRACK_CAP` slots (more cracks are cut; unused slots are 0). Per slot i:
 *   a[4i..]  = fx, fz, ceil, widen
 *   b[4i..]  = dir.x, dir.y, dir.z, wave
 *   c[4i..]  = rgb.r, rgb.g, rgb.b, main
 *   d[4i..]  = rx, rz, rot, ray count
 *   e[12i..] = three vec4 (ray j at 4j): floor u0, u1, top u0, top u1. Only the first `d.w` rays count: the rest are 0, and a
 *              zero ray is not an empty one (its soft edges still pass 0.25), so the shader must gate its ray loop on d.w.
 */
export interface PackedCracks { a: Float32Array; b: Float32Array; c: Float32Array; d: Float32Array; e: Float32Array; count: number }
/** `into` (a result of an earlier call) is cleared and refilled, so a per-frame caller allocates nothing. */
export function packCracks(cracks: readonly Crack[], into?: PackedCracks): PackedCracks {
  const out: PackedCracks = into ?? {
    a: new Float32Array(CRACK_CAP * 4),
    b: new Float32Array(CRACK_CAP * 4),
    c: new Float32Array(CRACK_CAP * 4),
    d: new Float32Array(CRACK_CAP * 4),
    e: new Float32Array(CRACK_CAP * RAY_CAP * 4),
    count: 0,
  };
  if (into) for (const arr of [out.a, out.b, out.c, out.d, out.e]) arr.fill(0);
  out.count = Math.min(cracks.length, CRACK_CAP);
  for (let i = 0; i < out.count; i++) {
    const k = cracks[i];
    out.a.set([k.fx, k.fz, k.ceil, k.widen], i * 4);
    out.b.set([k.dir[0], k.dir[1], k.dir[2], k.wave], i * 4);
    out.c.set([k.rgb[0], k.rgb[1], k.rgb[2], k.main], i * 4);
    out.d.set([k.rx, k.rz, k.rot, Math.min(k.rays.length, RAY_CAP)], i * 4);
    for (let j = 0; j < Math.min(k.rays.length, RAY_CAP); j++) out.e.set(k.rays[j], (i * RAY_CAP + j) * 4);
  }
  return out;
}

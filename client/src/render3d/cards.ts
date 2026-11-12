// Per-frame quads of the 3D view: figure and prop cards, floor decals, ground shadows, torch flames and glows.
import { facesLeft, snapGround, viewRay, type Cam } from './camera';
import { torchFlicker } from './light';
import type { ShadowCaster } from './lights';
import { frameOf, orbAt, type SceneState } from './scene';
import type { FrameRects } from './worldMesh';

/** Tiles a glow is moved toward the camera beyond its own size (the demo's 0.05 glow bias). */
export const GLOW_LIFT = 0.05;
/** Height of a card lying on the floor, above the terrain layers (0.002 apart). */
export const LIE_Y = 0.02;
/** Tiles a held weapon is pushed toward the camera so it draws over its wielder. */
export const WEAPON_BIAS = 0.01;
/** Height of a ground shadow: above the floor, below the lying cards. */
const SHADOW_Y = 0.01;

/** 6 vertices per quad. `look` has 5 floats per vertex: r, g, b, mode (0 multiply, 1 fill, 2 grey then multiply), alpha. */
export interface Quads { position: Float32Array; uv: Float32Array; look: Float32Array; /** One entity id per vertex, -1 none. */ owner: Float32Array; count: number }
export interface Glows { position: Float32Array; uv: Float32Array; color: Float32Array; count: number } // uv -1..1; color rgb already times strength
export interface Shadows { position: Float32Array; uv: Float32Array; alpha: Float32Array; count: number } // uv -1..1
/** `ghosts` (translucent, no depth write) must be sorted with `sortBackToFront` by the producer before it is handed over. */
export interface Dynamic { cards: Quads; ghosts: Quads; decals: Quads; shadows: Shadows; emissive: Quads; glows: Glows }

/** The growing arrays one pass is built in; `n` counts quads. */
export interface CardBuf { position: number[]; uv: number[]; look: number[]; /** One entity id per vertex of the looked quads (-1: none). */ owner: number[]; n: number }
export interface ShadowBuf { position: number[]; uv: number[]; alpha: number[]; n: number }
export interface GlowBuf { position: number[]; uv: number[]; color: number[]; n: number }

export const newCardBuf = (): CardBuf => ({ position: [], uv: [], look: [], owner: [], n: 0 });
export const newShadowBuf = (): ShadowBuf => ({ position: [], uv: [], alpha: [], n: 0 });
export const newGlowBuf = (): GlowBuf => ({ position: [], uv: [], color: [], n: 0 });

export const emptyQuads = (): Quads => ({ position: new Float32Array(0), uv: new Float32Array(0), look: new Float32Array(0), owner: new Float32Array(0), count: 0 });
export const emptyShadows = (): Shadows => ({ position: new Float32Array(0), uv: new Float32Array(0), alpha: new Float32Array(0), count: 0 });
export const emptyGlows = (): Glows => ({ position: new Float32Array(0), uv: new Float32Array(0), color: new Float32Array(0), count: 0 });

export const quadsOf = (b: CardBuf): Quads => ({ position: new Float32Array(b.position), uv: new Float32Array(b.uv), look: new Float32Array(b.look), owner: new Float32Array(b.owner), count: b.n });
export const shadowsOf = (b: ShadowBuf): Shadows => ({ position: new Float32Array(b.position), uv: new Float32Array(b.uv), alpha: new Float32Array(b.alpha), count: b.n });
export const glowsOf = (b: GlowBuf): Glows => ({ position: new Float32Array(b.position), uv: new Float32Array(b.uv), color: new Float32Array(b.color), count: b.n });

type V = [number, number, number, number, number]; // x y z u v
// Corners run top-left, top-right, bottom-right, bottom-left seen from the camera side; wound counter-clockwise.
const ORDER = [0, 3, 2, 0, 2, 1];

const pushQuad = (pos: number[], uv: number[], q: [V, V, V, V], extra?: (n: number) => void) => {
  for (const i of ORDER) {
    pos.push(q[i][0], q[i][1], q[i][2]);
    uv.push(q[i][3], q[i][4]);
    extra?.(i);
  }
};

/**
 * An upright card: an atlas frame (or a crop of it) standing on a foot point, turned to the camera.
 * Spaces and units, in the same terms as `Pose` (game/anim/pose.ts):
 * - `frame`: atlas frame name. `x`, `z`: foot point in tiles. `lift`: tiles raised. `bias`: tiles pushed along the view ray.
 * - `flip`: mirrors the picture (the texture u) only; it never moves the anchor, crop or pivot.
 * - `originX`: fraction of the frame width (0..1) of the DISPLAY frame (after the flip) that sits on the foot point (0.5: centre; `Pose.originX`).
 * - `footY`: fraction of the frame height (0..1, from the top) that sits on the foot point (1: bottom edge); Task 5 converts `footRow / h`.
 * - `crop`: frame px in DISPLAY space (after the flip), from the display frame's top-left; the quad and its uv cover only this rectangle.
 * - `scale`: multiplies the 16 px per tile; `sx`, `sy`: extra horizontal and vertical stretch (default 1).
 * - `angle`: radians, clockwise on screen, about `pivot` (frame px in display space from the top-left; default the anchor).
 * - `offset`: frame px, x right and y DOWN as in `Pose.body`, multiplied by `scale`.
 * - `tint` rgb 0..1, `mode` 0 multiply, 1 fill, 2 grey then multiply, `alpha` 0..1 (translucent pass only).
 */
export interface Card {
  frame: string; crop?: { x: number; y: number; w: number; h: number };
  x: number; z: number; lift: number; flip: boolean;
  originX: number; footY: number; scale: number; sx?: number; sy?: number;
  angle?: number; pivot?: [number, number]; offset?: [number, number];
  tint: [number, number, number]; mode: 0 | 1 | 2; alpha: number; bias?: number;
}

/** The corners (local frame px, x right, y up from the anchor) of a card's quad, rotated, then mapped through two axes. */
function place(
  c: Card, frames: FrameRects, cam: Cam, right: [number, number, number], up: [number, number, number], rot: boolean,
):{ q: [V, V, V, V]; r: { x: number; y: number; w: number; h: number } } | null {
  const fr = frames[c.frame];
  if (!fr) return null;
  const crop = c.crop ?? { x: 0, y: 0, w: fr.w, h: fr.h };
  const f = snapGround(cam.pitch, cam.yaw, c.x, c.z);
  const ay = c.footY * fr.h, ax = c.originX * fr.w;
  const sx = c.scale * (c.sx ?? 1) / 16, sy = c.scale * (c.sy ?? 1) / 16;
  const ox = c.offset ? c.offset[0] * c.scale : 0, oy = c.offset ? -c.offset[1] * c.scale : 0; // y down in, up out
  // Everything is in display space: the geometry is never mirrored, only the texture is read back to front.
  const ang = rot ? (c.angle ?? 0) : 0;
  const pvx = c.pivot ? c.pivot[0] - ax : 0, pvy = c.pivot ? ay - c.pivot[1] : 0; // pivot relative to the anchor, y up
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // Display column d is frame column w - d when flipped.
  const u0 = c.flip ? fr.x + fr.w - crop.x : fr.x + crop.x;
  const u1 = c.flip ? fr.x + fr.w - crop.x - crop.w : fr.x + crop.x + crop.w;
  const v0 = fr.y + crop.y, v1 = fr.y + crop.y + crop.h;
  const L = crop.x - ax, R = crop.x + crop.w - ax;
  const T = ay - crop.y, B = ay - crop.y - crop.h;
  // Frame px (dx right, dy up from the anchor) -> world: rotate clockwise about the pivot, scale, offset, then the axes.
  const corner = (dx: number, dy: number, u: number, v: number): V => {
    const rx = pvx + (dx - pvx) * ca + (dy - pvy) * sa;
    const ry = pvy - (dx - pvx) * sa + (dy - pvy) * ca;
    const a = rx * sx + ox / 16, b = ry * sy + oy / 16; // the offset is in screen units, not stretched
    return [f.x + right[0] * a + up[0] * b, up[1] * b + right[1] * a + c.lift, f.z + right[2] * a + up[2] * b, u, v];
  };
  const q: [V, V, V, V] = [corner(L, T, u0, v0), corner(R, T, u1, v0), corner(R, B, u1, v1), corner(L, B, u0, v1)];
  if (c.bias) {
    const ray = viewRay(cam.pitch, cam.yaw);
    for (const p of q) { p[0] += ray[0] * c.bias; p[1] += ray[1] * c.bias; p[2] += ray[2] * c.bias; }
  }
  return { q, r: fr };
}

const lookOf = (b: CardBuf, c: Card, owner = -1) => (): void => { b.look.push(c.tint[0], c.tint[1], c.tint[2], c.mode, c.alpha); b.owner.push(owner); };

/** `owner`: the id of the entity the card belongs to (its figure shadow's slot is the card's own), -1 none. */
export function pushCard(b: CardBuf, c: Card, frames: FrameRects, cam: Cam, owner = -1): void {
  const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
  const p = place(c, frames, cam, [cs, 0, sn], [0, 1, 0], true);
  if (!p) return;
  pushQuad(b.position, b.uv, p.q, lookOf(b, c, owner));
  b.n++;
}

/**
 * The shadow caster of an upright card (as `pushCard` places it, unstretched): `x`, `z` the middle of its bottom edge, `w` its width
 * along the card, `y0`/`y1` its lowest and highest corner, `u0 v0 u1 v1` its atlas rect (`u0 > u1` when mirrored). A rotation is
 * folded into the bounding rect of its corners; null for a frame the atlas lacks.
 */
export function casterOf(c: Card, id: number, frames: FrameRects, cam: Cam): ShadowCaster | null {
  const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
  const p = place(c, frames, cam, [cs, 0, sn], [0, 1, 0], true);
  if (!p) return null;
  const tl = p.q[0], br = p.q[2];
  // The corners differ along the card's right (cs, sn) only; the bounding rect runs from the least to the greatest.
  const along = (v: V): number => v[0] * cs + v[2] * sn;
  let lo = tl, hi = tl, y0 = Infinity, y1 = -Infinity;
  for (const v of p.q) {
    if (along(v) < along(lo)) lo = v;
    if (along(v) > along(hi)) hi = v;
    y0 = Math.min(y0, v[1]);
    y1 = Math.max(y1, v[1]);
  }
  return { id, x: (lo[0] + hi[0]) / 2, z: (lo[2] + hi[2]) / 2, w: along(hi) - along(lo), y0, y1, u0: tl[3], v0: tl[4], u1: br[3], v1: br[4] };
}

/**
 * A 1 x 1 tile card fixed to a wall face (not turned to the camera), for the emissive pass (no `look`): centre (x, y, z),
 * `nx`/`nz` the face's outward normal (+z, +x or -x here), the picture mirrored when `flip`.
 */
export function pushWall(b: CardBuf, frame: string, x: number, y: number, z: number, nx: number, nz: number, flip: boolean, frames: FrameRects): void {
  const fr = frames[frame];
  if (!fr) return;
  // The viewer in front of the face looks along -normal; their right is (-nz, nx) on the ground rotated: normal +z -> right +x, +x -> -z, -x -> +z.
  const rx = nz, rz = -nx;
  const u0 = flip ? fr.x + fr.w : fr.x, u1 = flip ? fr.x : fr.x + fr.w;
  const v0 = fr.y, v1 = fr.y + fr.h;
  const at = (s: number, h: number, u: number, v: number): V => [x + rx * s * 0.5, y + h * 0.5, z + rz * s * 0.5, u, v];
  pushQuad(b.position, b.uv, [at(-1, 1, u0, v0), at(1, 1, u1, v0), at(1, -1, u1, v1), at(-1, -1, u0, v1)]);
  b.n++;
}

/** A card lying flat on the floor (y = LIE_Y), its frame's foot-to-head axis along screen right (`headRight`) or left. */
export function pushLying(b: CardBuf, c: Card & { headRight: boolean }, frames: FrameRects, cam: Cam): void {
  const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
  // Ground directions on screen: right (c, s), down (-s, c). The frame turns a quarter turn: head (frame up) to right, frame right to down; or head left, frame right up.
  const right: [number, number, number] = c.headRight ? [-sn, 0, cs] : [sn, 0, -cs];
  const up: [number, number, number] = c.headRight ? [cs, 0, sn] : [-cs, 0, -sn];
  flat(b, c, frames, cam, right, up);
}

/** A card lying flat on the floor, upright on screen: the frame's up is up the screen (away from the camera on the ground), its right is screen right; `flip` mirrors it. */
export function pushFlat(b: CardBuf, c: Card, frames: FrameRects, cam: Cam): void {
  const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
  flat(b, c, frames, cam, [cs, 0, sn], [sn, 0, -cs]);
}

function flat(b: CardBuf, c: Card, frames: FrameRects, cam: Cam, right: [number, number, number], up: [number, number, number]): void {
  const p = place({ ...c, lift: 0 }, frames, cam, right, up, false);
  if (!p) return;
  for (const q of p.q) q[1] = LIE_Y;
  pushQuad(b.position, b.uv, p.q, lookOf(b, c));
  b.n++;
}

/**
 * A soft floor ellipse (uv -1..1), `alpha` its strength: ground shadows (2D: 0.45 at the centre).
 * `rx` runs along screen right on the ground, `rz` along screen down, so the ellipse keeps its look at any yaw.
 * Callers pass the snapped foot (`snapGround`), like the cards, so the shadow stays under the feet.
 */
export function pushShadow(b: ShadowBuf, cam: Cam, x: number, z: number, rx: number, rz: number, alpha: number): void {
  const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
  const at = (a: number, d: number, u: number, v: number): V => [x + cs * a * rx - sn * d * rz, SHADOW_Y, z + sn * a * rx + cs * d * rz, u, v];
  pushQuad(b.position, b.uv, [at(-1, -1, -1, -1), at(1, -1, 1, -1), at(1, 1, 1, 1), at(-1, 1, -1, 1)], () => { b.alpha.push(alpha); });
  b.n++;
}

/**
 * A glow quad: camera-facing (round on screen), screen-right (c, 0, s), screen-up (s sin p, cos p, -c sin p), half-size `size`.
 * Its centre is moved toward the camera by size + GLOW_LIFT along the view ray, which leaves its screen position
 * unchanged (orthographic view) but puts the whole disc in front of its wall, the wall top and the floor.
 * Known cost: it is added over figures standing within about `size` in front of a torch.
 */
export function pushGlow(b: GlowBuf, x0: number, y0: number, z0: number, size: number, rgb: [number, number, number], cam: Cam): void {
  const c = Math.cos(cam.yaw), sn = Math.sin(cam.yaw), sp = Math.sin(cam.pitch), cpi = Math.cos(cam.pitch);
  const ray = viewRay(cam.pitch, cam.yaw);
  const lift = size + GLOW_LIFT;
  const x = x0 + ray[0] * lift, y = y0 + ray[1] * lift, z = z0 + ray[2] * lift;
  const rx = size * c, rz = size * sn;
  const ux = size * sn * sp, uy = size * cpi, uz = -size * c * sp;
  pushQuad(b.position, b.uv, [
    [x - rx + ux, y + uy, z - rz + uz, -1, -1], [x + rx + ux, y + uy, z + rz + uz, 1, -1],
    [x + rx - ux, y - uy, z + rz - uz, 1, 1], [x - rx - ux, y - uy, z - rz - uz, -1, 1],
  ], () => { b.color.push(rgb[0], rgb[1], rgb[2]); });
  b.n++;
}

/** Sorts the quads of a translucent buffer back to front for the camera (whole quads of 6 vertices, by their centre's depth). */
export function sortBackToFront(b: CardBuf, cam: Cam): void {
  if (b.n < 2) return;
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  const depth: number[] = [];
  for (let q = 0; q < b.n; q++) {
    let d = 0;
    for (let i = 0; i < 6; i++) {
      const o = (q * 6 + i) * 3;
      const x = b.position[o] - cam.x, y = b.position[o + 1], z = b.position[o + 2] - cam.z;
      d += -(z * c - x * s) * cp - y * sp; // project()'s depth: grows away from the camera
    }
    depth.push(d / 6);
  }
  const order = [...depth.keys()].sort((p, q) => depth[q] - depth[p] || p - q);
  const reorder = (a: number[], per: number) => {
    const out: number[] = new Array(a.length);
    order.forEach((from, to) => { for (let k = 0; k < per * 6; k++) out[to * per * 6 + k] = a[from * per * 6 + k]; });
    for (let i = 0; i < a.length; i++) a[i] = out[i];
  };
  reorder(b.position, 3);
  reorder(b.uv, 2);
  reorder(b.look, 5);
  reorder(b.owner, 1);
}

/** One upright figure card: an atlas frame standing on a ground point (tiles), mirrored when `flip`. */
export interface CardItem { frame: string; x: number; z: number; flip: boolean }

/** The plain card of an item: bottom centre on the foot, no tint, opaque. */
const plain = (it: CardItem): Card => ({ frame: it.frame, x: it.x, z: it.z, lift: 0, flip: it.flip, originX: 0.5, footY: 1, scale: 1, tint: [1, 1, 1], mode: 0, alpha: 1 });

/** Standing cards, each on its snapped foot and turned to the camera's yaw; a frame the atlas lacks is skipped. */
export function cardQuads(items: readonly CardItem[], frames: FrameRects, cam: Cam): Quads {
  const b = newCardBuf();
  for (const it of items) pushCard(b, plain(it), frames, cam);
  return quadsOf(b);
}

export function buildDynamic(s: SceneState, frames: FrameRects, cam: Cam, t: number, orb: boolean): Dynamic {
  const ep: number[] = [], eu: number[] = [];
  const glows = newGlowBuf();
  let en = 0;

  const items: CardItem[] = [];
  for (const e of s.ents) {
    e.flip = facesLeft(cam.yaw, e.fx, e.fz, e.flip);
    items.push({ frame: frameOf(e), x: e.x, z: e.z, flip: e.flip });
  }
  for (const p of s.props) items.push({ frame: p.frame, x: p.x, z: p.z, flip: false });
  const cards = cardQuads(items, frames, cam);

  for (const tc of s.torches) {
    const fr = frames[`torch_f${Math.floor(t * 8 + tc.ph) % 5}`];
    const zz = tc.z - 0.14;
    if (fr) {
      pushQuad(ep, eu, [
        [tc.x - 0.5, tc.y + 0.5, zz, fr.x, fr.y], [tc.x + 0.5, tc.y + 0.5, zz, fr.x + fr.w, fr.y],
        [tc.x + 0.5, tc.y - 0.5, zz, fr.x + fr.w, fr.y + fr.h], [tc.x - 0.5, tc.y - 0.5, zz, fr.x, fr.y + fr.h],
      ]);
      en++;
    }
    const k = 0.5 * torchFlicker(t, tc.ph);
    pushGlow(glows, tc.x, tc.y + 0.25, zz, 1.5, [1 * k, 0.6 * k, 0.28 * k], cam);
  }
  if (orb) {
    const o = orbAt(t);
    pushGlow(glows, o.x, o.y, o.z, 0.9, [0.4 * 0.9, 0.58 * 0.9, 1 * 0.9], cam);
    pushGlow(glows, o.x, o.y, o.z, 0.22, [0.4 * 3, 0.58 * 3, 1 * 3], cam);
  }

  return {
    cards,
    ghosts: emptyQuads(),
    decals: emptyQuads(),
    shadows: emptyShadows(),
    emissive: { position: new Float32Array(ep), uv: new Float32Array(eu), look: new Float32Array(0), owner: new Float32Array(0), count: en },
    glows: glowsOf(glows),
  };
}

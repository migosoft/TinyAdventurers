// Reading the ground-cover image in TSL (#330): the uniforms every cover shader shares, a texel fetch, the cover's height and the kind table.
// Kept apart from coverNodes (the sheet and bushel materials) because `materials.ts` (the ground) and the trees (the falling leaf) read the
// cover too, and coverNodes itself imports `materials.ts`.
import { Vector2, Vector4 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { clamp, float, floor, int, ivec2, max, mod, select, texture, uniform, uniformArray, vec2 } from 'three/tsl';
import { COVER_KINDS } from './kinds';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The uniforms and the image every cover shader of a view shares; the view sets them each frame. */
export interface CoverShared {
  /** The wind's clock (seconds). */
  t: N;
  /** 1 when the wind moves the plants. */
  windOn: N;
  /** Tiles per 16 height units of the sheets' scale: a height of `h` px stands `h * gh / 16` tiles high (1..GH_MAX). */
  gh: N;
  /** 1 when the 3D cover is drawn, 0 when the ground shows the cover flat (or there is none). */
  on: N;
  /** cos(pitch), for the bushel cards' stretch. */
  cosP: N;
  /** A texture node over the cover image (one texel per map px: rgb = colour, a = height | kind id << 4); `setTexture` points it at a new image. */
  texture: N;
  /** The image's size in texels (a vec2 uniform). */
  size: N;
  setTexture(t: Texture): void;
}

/** `standIn`: any texture (a 1x1 one), until the first real image; `on` starts at 0. */
export function makeCoverShared(standIn: Texture): CoverShared {
  const tex = texture(standIn);
  tex.mergeable = false;
  const size = uniform(imageSize(standIn));
  return {
    t: uniform(0), windOn: uniform(0), gh: uniform(1), on: uniform(0).setName('coverOn'), cosP: uniform(1),
    texture: tex, size,
    setTexture(t) {
      tex.value = t;
      (size.value as Vector2).copy(imageSize(t));
    },
  };
}

function imageSize(t: Texture): Vector2 {
  const img = t.image as { width?: number; height?: number } | null;
  return new Vector2(Math.max(1, img?.width ?? 1), Math.max(1, img?.height ?? 1));
}

/**
 * The texel at the art pixel `cell` (a vec2 of whole numbers): colour, height in px (0 outside the image) and the cover kind id.
 * A fetch, not a filtered sample: it can sit in a vertex shader and needs no derivatives.
 */
export function coverTexel(s: CoverShared, cell: N): { rgb: N; h: N; id: N } {
  const c = clamp(cell, vec2(0, 0), s.size.sub(1));
  const inside = cell.x.greaterThanEqual(0).and(cell.y.greaterThanEqual(0)).and(cell.x.lessThan(s.size.x)).and(cell.y.lessThan(s.size.y));
  const t = s.texture.load(ivec2(int(c.x), int(c.y)));
  const byte = floor(t.a.mul(255).add(0.5));
  return { rgb: t.rgb, h: select(inside, mod(byte, 16), float(0)), id: floor(byte.div(16)) };
}

/** The cover's height (tiles) at `xz` (tiles): coverH of the texel / 16 * gh * on. 0 while the layer is off. */
export function coverHeightNode(s: CoverShared, xz: N): N {
  return coverTexel(s, floor(vec2(xz).mul(16))).h.div(16).mul(s.gh).mul(s.on);
}

const look = uniformArray(COVER_KINDS.map((k) => new Vector4(k.sway, k.footShade, k.darken, k.maxH)), 'vec4');
const tones = uniformArray(COVER_KINDS.flatMap((k) => (k.bushels?.tones ?? [[1, 1, 1], [1, 1, 1], [1, 1, 1]]).map(([r, g, b]) => new Vector4(r, g, b, 0))), 'vec4');
const bushelSway = uniformArray(COVER_KINDS.map((k) => new Vector4(k.bushels?.sway ?? 0, 0, 0, 0)), 'vec4');

/** The kind table at `id` (a float node): (sway at the top sheet in tiles, foot shade, ground darkening, max height in px). */
export function kindLook(id: N): { sway: N; footShade: N; darken: N; maxH: N } {
  const e: N = look.element(int(id));
  return { sway: e.x, footShade: e.y, darken: e.z, maxH: max(e.w, 1) };
}

/** Tone `n` (0..2) of the kind's bushels, and the bushel sway amplitude (tiles at the card's top). */
export function bushelTone(id: N, n: N): N {
  const e: N = tones.element(int(id).mul(3).add(int(n)));
  return e.xyz;
}
export function bushelSwayOf(id: N): N {
  const e: N = bushelSway.element(int(id));
  return e.x;
}

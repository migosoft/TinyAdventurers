// The sharp-bilinear copy of the off-screen picture to the canvas (#376): texels stay crisp, and only a band about one canvas pixel wide
// at each texel edge is blended, so any scale looks sharp without shimmer.
import { Vector2, type Texture, type TextureNode, type UniformNode } from 'three/webgpu';
import { clamp, float, floor, fract, max, texture, uniform, uv, vec2 } from 'three/tsl';

/** Per axis: the texel coordinate to sample linearly, for texel coordinate `t` and copy scale `s` (canvas px per texel). */
export function sharpTexel(t: number, s: number): number {
  const sEff = Math.max(s, 1);
  const r = 0.5 - 0.5 / sEff;
  const cd = t - Math.floor(t) - 0.5;
  const f = (cd - Math.min(Math.max(cd, -r), r)) * sEff + 0.5;
  return Math.floor(t) + f;
}

/** The copy's fragment node: `tex` sampled with the same formula; the uniforms are set per frame. Build it once: a new target only needs `node.value = newTexture`. */
export function sharpCopyNode(tex: Texture): { node: TextureNode; size: UniformNode<'vec2', Vector2>; scale: UniformNode<'vec2', Vector2> } {
  const size = uniform(new Vector2(1, 1));
  const scale = uniform(new Vector2(1, 1));
  const t = uv().mul(size);
  const sEff = max(scale, vec2(1, 1));
  const r = float(0.5).sub(float(0.5).div(sEff));
  const cd = fract(t).sub(0.5);
  const f = cd.sub(clamp(cd, r.negate(), r)).mul(sEff).add(0.5);
  const node = texture(tex, floor(t).add(f).div(size));
  return { node, size, scale };
}

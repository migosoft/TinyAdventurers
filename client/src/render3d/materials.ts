// Node materials of the 3D view (TSL).
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { attribute, floor, fract, int, ivec2, max, min, positionWorld, select, texture, textureLoad, uv, vec2, vec3, vec4 } from 'three/tsl';

const STONE = [0.115, 0.1, 0.145] as const;
const RIM = [0.4, 0.34, 0.33] as const;
const PX = 1 / 16;

/** Unlit world material: atlas texels for floor and faces, a generated stone top with a pale rim where a wall drops to something lower. */
export function worldMaterial(atlas: Texture, atlasW: number, atlasH: number, heights: Texture, mapW: number, mapH: number): MeshBasicNodeMaterial {
  const kind = attribute('kind', 'float');
  const isTop = kind.greaterThan(1.5);

  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));

  const wp = positionWorld;
  const cx = floor(wp.x);
  const cz = floor(wp.z);
  const fx = fract(wp.x);
  const fz = fract(wp.z);
  const hh = wp.y.sub(0.1);
  const lower = (dx: number, dz: number) =>
    textureLoad(heights, ivec2(int(min(max(cx.add(dx), 0), mapW - 1)), int(min(max(cz.add(dz), 0), mapH - 1)))).x.mul(2.55).lessThan(hh);
  const rim = fz.greaterThan(1 - 2 * PX).and(lower(0, 1))
    .or(fz.lessThan(PX).and(lower(0, -1)))
    .or(fx.lessThan(PX).and(lower(-1, 0)))
    .or(fx.greaterThan(1 - PX).and(lower(1, 0)));

  const top = select(rim, vec3(...RIM), vec3(...STONE));
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(select(isTop, top, texel.rgb), select(isTop, 1, texel.a));
  m.alphaTest = 0.5;
  return m;
}

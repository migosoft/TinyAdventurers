// Node materials of the 3D view (TSL).
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { attribute, float, floor, fract, int, ivec2, length, max, positionGeometry, positionWorld, select, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from './lightNodes';

const STONE = [0.115, 0.1, 0.145] as const;
const RIM = [0.4, 0.34, 0.33] as const;
const PX = 1 / 16;

/** Lit world material: atlas texels for floor and faces, a generated stone top with a pale rim where a wall drops to something lower. */
export function worldMaterial(atlas: Texture, atlasW: number, atlasH: number, lighting: Lighting): MeshBasicNodeMaterial {
  const kind = attribute('kind', 'float');
  const isTop = kind.greaterThan(1.5);

  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));

  const wp = positionWorld;
  const cx = floor(wp.x);
  const cz = floor(wp.z);
  const fx = fract(wp.x);
  const fz = fract(wp.z);
  const hh = wp.y.sub(0.1);
  const lower = (dx: number, dz: number) => lighting.cellH(ivec2(int(cx.add(dx)), int(cz.add(dz)))).lessThan(hh);
  const rim = fz.greaterThan(1 - 2 * PX).and(lower(0, 1))
    .or(fz.lessThan(PX).and(lower(0, -1)))
    .or(fx.lessThan(PX).and(lower(-1, 0)))
    .or(fx.greaterThan(1 - PX).and(lower(1, 0)));

  const top = select(rim, vec3(...RIM), vec3(...STONE));
  const albedo = select(isTop, top, texel.rgb);
  // Wrap: floor 0.35, wall face 0.5, wall top 0.15.
  const wrap = select(isTop, float(0.15), select(kind.greaterThan(0.5), float(0.5), float(0.35)));
  const lit = lighting.lightAt(wp, attribute('normal', 'vec3'), wrap);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(lighting.shoulder(albedo.mul(lit)), select(isTop, 1, texel.a));
  m.alphaTest = 0.5;
  return m;
}

/**
 * Upright sprites. The screen shows a card at its full sprite height, so the vertex is stretched by 1 / cos(pitch)
 * (the demo's true tilt); the light uses the true, unstretched position. `cosP` is set by the view each frame.
 */
export function cardMaterial(atlas: Texture, atlasW: number, atlasH: number, lighting: Lighting): { material: MeshBasicNodeMaterial; cosP: { value: number } } {
  const cosP = uniform(1);
  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));
  const truePos = varying(positionGeometry, 'cardPos');
  const m = new MeshBasicNodeMaterial();
  m.positionNode = vec3(positionGeometry.x, positionGeometry.y.div(cosP), positionGeometry.z);
  m.colorNode = vec4(lighting.shoulder(texel.rgb.mul(lighting.lightAt(truePos, vec3(0, 0, 0), 1))), texel.a);
  m.alphaTest = 0.5;
  m.side = DoubleSide;
  return { material: m, cosP };
}

/** Torch flames: the atlas texel, self-lit. */
export function emissiveMaterial(atlas: Texture, atlasW: number, atlasH: number, lighting: Lighting): MeshBasicNodeMaterial {
  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(lighting.shoulder(texel.rgb.mul(1.15)), texel.a);
  m.alphaTest = 0.5;
  m.side = DoubleSide;
  return m;
}

/** Camera-facing glow quads: colour times max(0, 1 - |uv|)^3, added to the picture, depth tested but not written. */
export function glowMaterial(): MeshBasicNodeMaterial {
  const g = max(float(1).sub(length(uv())), 0);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(attribute('glowColor', 'vec3').mul(g.mul(g).mul(g)), 1);
  m.transparent = true;
  m.blending = AdditiveBlending;
  m.depthWrite = false;
  m.side = DoubleSide;
  return m;
}

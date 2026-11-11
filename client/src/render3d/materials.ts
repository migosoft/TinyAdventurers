// Node materials of the 3D view (TSL).
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { attribute, clamp, float, floor, fwidth, fract, int, ivec2, length, max, positionGeometry, positionWorld, select, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from './lightNodes';
import { GRASS_FLAT, STONE } from './light';

const RIM = [0.4, 0.34, 0.33] as const;
const PX = 1 / 16;

/** The demo's depth bias, in tiles toward the camera: cards 0.03, flames and glows 0.05 (the world has none). */
export const CARD_BIAS = 0.03;
export const FLAME_BIAS = 0.05;

/**
 * The unit vector from the target toward the camera, set by the view each frame. A vertex moved along it by `b` tiles
 * keeps its screen position (the view is orthographic) and gains `b` of depth on either backend.
 */
export function viewTowardUniform() {
  return uniform(new Vector3(0, 0, 1));
}
export type ViewToward = ReturnType<typeof viewTowardUniform>;

/** What `worldMaterial` hands back: the material and the handles the view drives. */
export interface WorldMaterial {
  material: MeshBasicNodeMaterial;
  /** 0 or 1: floors and the ground read the linear texture at a sharpened position. */
  smooth: { value: number };
  /** Points the ground kind at a new image (nearest and linear copies of it) and marks it ready. */
  setGround(nearest: Texture, linear: Texture): void;
}

/**
 * Lit world material: atlas texels for floor and faces, a generated stone top with a pale rim where a wall drops to something lower,
 * and (kind `ground`) the painted woodland ground, `GRASS_FLAT` while no image is set. The ground's rect is the whole image in px.
 * `smooth` (0 or 1) switches floor and ground to the linear texture at a sharpened position; it is a uniform, so flipping it recompiles nothing.
 */
export function worldMaterial(atlas: Texture, linearAtlas: Texture, atlasW: number, atlasH: number, lighting: Lighting, groundStart: Texture): WorldMaterial {
  const kind = attribute('kind', 'float');
  const isTop = kind.greaterThan(1.5).and(kind.lessThan(2.5));
  const isGround = kind.greaterThan(2.5);
  const isFace = kind.greaterThan(0.5).and(kind.lessThan(1.5));

  const size = vec2(atlasW, atlasH);
  const p0 = uv();
  // Derivatives are taken here, at the top level of the fragment code and outside any branch (WGSL requires uniform control flow).
  const fw = max(fwidth(p0), vec2(1e-6));
  const seam = floor(p0.add(0.5));
  const sharp = seam.add(clamp(p0.sub(seam).div(fw), -0.5, 0.5));
  const rect = attribute('rect', 'vec4');
  // The atlas has no padding: keep the linear taps inside the frame.
  const p = clamp(sharp, rect.xy.add(0.5), rect.xy.add(rect.zw).sub(0.5));
  const smooth = uniform(0);
  const useSmooth = smooth.greaterThan(0.5);
  // Both reads sit in the shader and a select picks one; sampling stays in uniform control flow.
  const atlasTexel = select(useSmooth.and(kind.lessThan(0.5)), texture(linearAtlas, p.div(size)), texture(atlas, p0.div(size)));

  const groundReady = uniform(0);
  const groundNear = texture(groundStart, p0.div(max(rect.zw, vec2(1))));
  const groundLin = texture(groundStart, p.div(max(rect.zw, vec2(1))));
  // Two texture nodes on one texture start are "mergeable" (same uniform hash, so one shared binding): then only one of them would follow `setGround`.
  groundNear.mergeable = false;
  groundLin.mergeable = false;
  const groundTexel = select(useSmooth, groundLin, groundNear);
  const ground = vec4(select(groundReady.greaterThan(0.5), groundTexel.rgb, vec3(...GRASS_FLAT)), select(groundReady.greaterThan(0.5), groundTexel.a, 1));
  const texel = select(isGround, ground, atlasTexel);

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
  // Wrap: floor and ground 0.35, wall face 0.5, wall top 0.15.
  const wrap = select(isTop, float(0.15), select(isFace, float(0.5), float(0.35)));
  const lit = lighting.lightAt(wp, attribute('normal', 'vec3'), wrap);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(lighting.shoulder(albedo.mul(lit)), select(isTop, 1, texel.a));
  m.alphaTest = 0.5;
  return {
    material: m,
    smooth,
    setGround(nearest, linear) {
      groundNear.value = nearest;
      groundLin.value = linear;
      groundReady.value = 1;
    },
  };
}

/**
 * Upright sprites. The screen shows a card at its full sprite height, so the vertex is stretched by 1 / cos(pitch)
 * (the demo's true tilt); the light uses the true, unstretched position. `cosP` is set by the view each frame.
 */
export function cardMaterial(atlas: Texture, atlasW: number, atlasH: number, lighting: Lighting, toward: ViewToward): { material: MeshBasicNodeMaterial; cosP: { value: number } } {
  const cosP = uniform(1);
  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));
  const truePos = varying(positionGeometry, 'cardPos');
  const m = new MeshBasicNodeMaterial();
  m.positionNode = vec3(positionGeometry.x, positionGeometry.y.div(cosP), positionGeometry.z).add(toward.mul(CARD_BIAS));
  m.colorNode = vec4(lighting.shoulder(texel.rgb.mul(lighting.lightAt(truePos, vec3(0, 0, 0), 1))), texel.a);
  m.alphaTest = 0.5;
  m.side = DoubleSide;
  return { material: m, cosP };
}

/** Torch flames: the atlas texel, self-lit. */
export function emissiveMaterial(atlas: Texture, atlasW: number, atlasH: number, lighting: Lighting, toward: ViewToward): MeshBasicNodeMaterial {
  const texel = texture(atlas, uv().div(vec2(atlasW, atlasH)));
  const m = new MeshBasicNodeMaterial();
  m.positionNode = positionGeometry.add(toward.mul(FLAME_BIAS));
  m.colorNode = vec4(lighting.shoulder(texel.rgb.mul(1.15)), texel.a);
  m.alphaTest = 0.5;
  m.side = DoubleSide;
  return m;
}

/** Camera-facing glow quads (already moved toward the camera by `buildDynamic`, so no bias here): colour times max(0, 1 - |uv|)^3, added to the picture, depth tested but not written. */
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

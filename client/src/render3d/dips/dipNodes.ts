// The ground of the dips in TSL (#324): the floor's own texel above the lip, the bank rock below it (mud for water, basalt for lava,
// layered slate chasm rock), lit like the world, with the lava's band of glow and the chasm's depth fade. The mesh (dipMesh.ts) carries the
// world material's `kind` and `rect` plus a per-vertex `dip` kind; the rock reads the world position only, so it looks the same on the
// sloped ground and on the vertical skirts along walls. The numbers are first guesses from the mockup, to be tuned by eye.
import type { NodeMaterial, Texture } from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { abs, attribute, dot, exp, float, fract, length, max, min, mix, positionWorld, select, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { flatTexel } from '../materials';
import { fbm2, vnoise2 } from '../noiseNodes';
import { LAVA_LEVEL } from './shape';

/** The light's wrap on a dip surface (like a floor's). */
const WRAP = 0.35;

/** The chasm rock's albedo (lit by the game light), and its own cool light per unit of relief shading, which makes the shape read with no torch near. */
const CHASM_ROCK = vec3(0.09, 0.088, 0.086);
const CHASM_SELF = vec3(0.17, 0.18, 0.205);
/** The strata: layers per world unit across the tilted strata coordinate, the tilt (tan of the angle, rising to the right), the noise warping the layers (frequencies and amounts), the share of a layer's height that is the sloping top (the rest is the undercut), the grain. */
const STRATA_FREQ = 1.7, STRATA_TILT = 0.7;
const STRATA_WARP_FREQ = 0.9, STRATA_WARP = 0.9, STRATA_WARP2_FREQ = 3.6, STRATA_WARP2 = 0.45;
const STRATA_LEDGE = 1.0, STRATA_CHIP_FREQ = 9, STRATA_CHIP = 0.45;
/** The relief: the step of the finite differences, the slope's weight, the light's direction in the wall's frame (along the wall, up it, out of it), the ambient share, the grain's strength and frequency. */
const STRATA_EPS = 0.1, STRATA_RELIEF = 0.8;
const STRATA_LIGHT = vec3(-0.45, 0.55, 0.7);
const STRATA_AMBIENT = 0.12, STRATA_GRAIN = 0.2, STRATA_GRAIN_FREQ = 24;

/**
 * The height of the rock face at (s, y), s along the wall: the strata coordinate is warped by noise, `1 - fract` of it makes each layer
 * recede slowly going up and jump out at its end (the undercut underside), plus chips. Sine-free noise only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
function strata(s: N, y: N): N {
  const p = vec2(s, y);
  const warp = vnoise2(p.mul(STRATA_WARP_FREQ)).sub(0.5).mul(STRATA_WARP).add(vnoise2(p.mul(STRATA_WARP2_FREQ).add(7)).sub(0.5).mul(STRATA_WARP2));
  const a = y.sub(s.mul(STRATA_TILT)).mul(STRATA_FREQ).add(warp.mul(STRATA_FREQ));
  const top = float(1).sub(fract(a)).mul(STRATA_LEDGE);
  return top.add(vnoise2(p.mul(STRATA_CHIP_FREQ)).mul(STRATA_CHIP));
}

export interface DipMaterial {
  material: NodeMaterial;
  /** 0 or 1: the floor texel above the lip reads the linear texture at a sharpened position. */
  smooth: { value: number };
  /** Seconds, set by the view each frame: the lava band's flicker. */
  time: { value: number };
  /** Points the ground kind at a new image (nearest and linear copies of it) and marks it ready. */
  setGround(nearest: Texture, linear: Texture): void;
}

/**
 * The dip ground: `mix(floor texel, rock, bank)` by the depth below the floor, lit with `lightAt` (without the lava cell's own glow: the
 * material draws a band of it at the lava's level), then the sight step. Opaque. `time` drives the band.
 */
export function dipMaterial(atlas: Texture, linearAtlas: Texture, atlasW: number, atlasH: number, lighting: Lighting, groundStart: Texture, sight: Sight): DipMaterial {
  const kind = attribute('kind', 'float');
  const dip = attribute('dip', 'float');
  const normal = attribute('normal', 'vec3');
  const flat = flatTexel(atlas, linearAtlas, atlasW, atlasH, groundStart, kind);
  const time = uniform(0);

  const wp = positionWorld;
  const y = wp.y;
  const d = y.negate();
  // The rock is drawn in a plane that slides with depth, so the pattern does not smear on steep banks.
  const pp = wp.xz.add(vec2(y.mul(0.8), y.mul(-0.5)));
  const bank = smoothstep(0.02, 0.12, d);

  // The kinds, by ranges of the vertex attribute (0 none, 1 water, 2 lava, 3 chasm).
  const isLava = dip.greaterThan(1.5).and(dip.lessThan(2.5));
  const isChasm = dip.greaterThan(2.5);

  // All the noise is evaluated here, at the top level; the kinds only pick between the results.
  const rough = fbm2(pp.mul(5));
  const mud = vec3(0.10, 0.085, 0.055).mul(float(0.6).add(rough.mul(0.8)));
  const pebbles = smoothstep(0.66, 0.72, vnoise2(pp.mul(4.3).add(3.1)));
  const stones = vec3(0.20, 0.19, 0.16).mul(float(0.7).add(vnoise2(pp.mul(9)).mul(0.5)));
  const waterRock = mix(mix(mud, stones, pebbles), vec3(0.03, 0.07, 0.04), smoothstep(0.4, 2.0, d).mul(0.7));

  const lavaRock = vec3(0.045, 0.038, 0.036).mul(float(0.6).add(rough.mul(0.9))).mul(float(0.75).add(vnoise2(pp.mul(23)).mul(0.5)));

  // The chasm's rock: layered ledges. The height field is read at the point and one step along the wall and one step down it; its
  // slope, lit from the upper left, gives the relief (a ledge's top bright, its undercut underside black).
  const s0 = wp.x.sub(wp.z);
  const h0 = strata(s0, y);
  const hs = strata(s0.add(STRATA_EPS), y);
  const hy = strata(s0, y.add(STRATA_EPS));
  const gs = hs.sub(h0).div(STRATA_EPS).mul(STRATA_RELIEF), gy = hy.sub(h0).div(STRATA_EPS).mul(STRATA_RELIEF);
  const nrm = vec3(gs.negate(), gy.negate(), 1);
  const lamb = max(float(0), dot(nrm, STRATA_LIGHT)).div(length(nrm));
  const grain = float(1 - STRATA_GRAIN).add(vnoise2(vec2(s0, y).mul(STRATA_GRAIN_FREQ)).mul(2 * STRATA_GRAIN));
  const ridges = float(STRATA_AMBIENT).add(lamb.mul(1 - STRATA_AMBIENT)).mul(grain);
  const chasmRock = CHASM_ROCK.mul(ridges);

  const glowNoise = fbm2(wp.xz.mul(3).add(vec2(0, time.mul(0.2))));

  const rock = select(dip.lessThan(1.5), waterRock, select(dip.lessThan(2.5), lavaRock, chasmRock));
  const albedo = mix(flat.texel.rgb, rock, bank);

  const lit = lighting.lightAt(wp, normal, WRAP, { selfLit: false });
  const base = lighting.finish(albedo, lit);

  // The lava's glowing band at its own level, and the chasm's cool self-light, then its fade with depth (the twin of `depthFade`).
  const band = vec3(1.1, 0.22, 0.02)
    .mul(exp(abs(y.sub(LAVA_LEVEL)).mul(-7)))
    .mul(float(0.5).add(glowNoise.mul(0.8)))
    .mul(smoothstep(0, 0.08, d));
  const cool = CHASM_SELF.mul(ridges).mul(bank);
  const fade = float(0.03).add(exp(min(y, 0).mul(0.55)).mul(0.97));
  // `base` (every light and shadow loop) is built once; only these cheap terms are picked by float weights (a colour `select` would emit `base` per branch).
  const lavaW = select(isLava, float(1), float(0));
  const chasmW = select(isChasm, float(1), float(0));
  const colour = mix(base.add(band.mul(lavaW)), base.add(cool).mul(fade), chasmW);

  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sight.apply(colour, wp, sight.unseenAt(wp.xz)), 1);
  return { material: m, smooth: flat.smooth, time, setGround: flat.setGround };
}

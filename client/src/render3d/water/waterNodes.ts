// The water's surface in TSL (#345), and the ceiling only its mirror pass draws. The surface is one flat sheet at WATER_LEVEL
// (waterMesh.ts). It is clear: what lies behind it (the bed, a wading figure's legs) comes from a copy of the opaque scene, read at the
// screen position with a small refraction offset, and is absorbed by the length of the way through the water (red first), so the deep
// middle is dark because the way is long, not because of a tint. The depth is the bed's height from the field texture (waterField.ts),
// not the depth buffer. On top: the room mirrored in the water plane (a picture the view draws from below, passes.ts) and the glints of
// the lights. Calm, large waves and the ripples of ripples.ts tilt the normal that all of it reads. The numbers are first guesses from
// the mockup, tuned by eye.
import { Matrix4, MeshBasicNodeMaterial, Texture, Vector4, type NodeMaterial } from 'three/webgpu';
import { Fn, If, Loop, abs, clamp, dot, exp, float, length, max, mix, normalize, positionWorld, pow, screenUV, sin, smoothstep, step, texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import type { ViewToward } from '../materials';
import { fbm2, vnoise2 } from '../noiseNodes';
import { BED_RES, OUTLINE_EDGE } from '../dips/shape';
import { RIPPLE, RIPPLE_CAP, RIPPLE_LIFE, RIPPLE_SPEED } from './ripples';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** A loop from 0 to `end` whose index is called `name` (every TSL loop names its own index). */
const named = (name: string, end: number): N => ({ start: 0, end, name });

/** The waves: the heights (tiles) of two slow sines and one low-frequency noise, the step of the normal's finite differences (tiles) and the factor on the slope. */
export const WAVES = { a1: 0.007, a2: 0.006, a3: 0.008, eps: 0.015, gain: 2 } as const;
/**
 * The waves' shapes. Each sine runs along one axis (`k`, radians per tile), slanted by the other (`skew`), at `speed` radians per
 * second (the second one runs the other way). The noise has `freq` cells per tile and drifts `drift` cells per second.
 */
export const WAVE_SHAPE = {
  sine1: { k: 2.1, skew: 0.5, speed: 0.9 }, sine2: { k: 2.6, skew: 0.9, speed: 0.7 }, noise: { freq: 1.8, drift: [0.12, 0.09] },
} as const;
/** What a tile of way through the water takes from red, green and blue, and the colour the water itself scatters back per unit of light at the surface. */
export const ABSORB = [0.55, 0.22, 0.16] as const, SCATTER = [0.004, 0.02, 0.022] as const;
/**
 * `REFRACT`: the offset of the scene copy's read, in screens per unit of the normal's tilt (scaled by the depth, up to 1 tile).
 * The mirror's share is `clamp(MIRROR_BASE + F * FRESNEL_GAIN * (1 - MIRROR_BASE), 0, MIRROR_MAX)` with F the Fresnel term; its picture is
 * read `MIRROR_WOBBLE` screens off per unit of tilt and multiplied by `MIRROR_GAIN`. `VIEW_MIN`: the least height of the view vector the
 * way through the water is divided by. `WRAP`: the wrap of the light the scatter colour is lit by.
 */
export const REFRACT = 0.012, MIRROR_BASE = 0.45, FRESNEL_GAIN = 6, MIRROR_MAX = 0.95, MIRROR_WOBBLE = 0.015, MIRROR_GAIN = 1.15, VIEW_MIN = 0.2, WRAP = 0.5;
/** The Fresnel term: the share mirrored looking straight down, and the power of its rise toward a grazing view. */
const FRESNEL_0 = 0.02, FRESNEL_POW = 5;

/**
 * The ceiling's rock: the darkest albedo and the range the noise adds, its warm tint, the noise's frequency (per tile); the cracks'
 * frequency, half width (in noise value) and how dark they are; the light's wrap.
 */
export const CEILING = { base: 0.03, range: 0.12, tint: [1, 0.93, 0.88], freq: 2.7, crackFreq: 4.7, crackWidth: 0.03, crackDark: 0.35, wrap: 0.35 } as const;

export interface WaterMaterial {
  material: NodeMaterial;
  time: { value: number };
  /** RIPPLE_CAP vec4 (x, z, age, strength) as `Ripples.pack` writes them; null: none. */
  setRipples(packed: Float32Array | null): void;
  /** The opaque scene's copy (a render target's texture of the picture's size). Set before the first draw. */
  setScene(copy: Texture): void;
  /** The mirror picture with the matrix (projection times view of the mirror camera) that finds a world point in it; null: no reflection (the mirror term is 0). */
  setMirror(m: { picture: Texture; matrix: Matrix4 } | null): void;
  /** 1 while a mirror is set, else 0: the factor on the mirror's share. */
  readonly mirrorOn: { value: number };
  /** The ripple uniform's RIPPLE_CAP slots (x, z, age, strength) as `setRipples` left them; read-only, for tests. */
  readonly ripples: readonly Vector4[];
}

/** `field`: the RG half-float texture of the bed height and the water mask (waterField.ts), linear; `map` its size in tiles; `toward`: the unit vector toward the eye. */
export function waterMaterial(lighting: Lighting, sight: Sight, field: Texture, map: { w: number; h: number }, toward: ViewToward): WaterMaterial {
  const time = uniform(0);
  // A free slot has age -1 and adds nothing (its strength is stale: only the age says whether a slot is live).
  const rip = uniformArray(Array.from({ length: RIPPLE_CAP }, () => new Vector4(0, 0, -1, 0)), 'vec4');
  const uMirror = uniform(new Matrix4());
  const uMirrorOn = uniform(0);

  // The surface's height at `p` (x, z in tiles): the waves and the ripples (the twin of `rippleHeight`).
  const waves = Fn(([p]: N[]) => {
    const { sine1: s1, sine2: s2, noise: nz } = WAVE_SHAPE;
    const w = float(WAVES.a1).mul(sin(p.x.mul(s1.k).add(time.mul(s1.speed)).add(p.y.mul(s1.skew))))
      .add(float(WAVES.a2).mul(sin(p.y.mul(s2.k).sub(time.mul(s2.speed)).add(p.x.mul(s2.skew)))))
      .add(float(WAVES.a3).mul(vnoise2(p.mul(nz.freq).add(vec2(time.mul(nz.drift[0]), time.mul(nz.drift[1])))).sub(0.5)))
      .toVar();
    Loop(named('rp', RIPPLE_CAP), ({ rp: i }: N) => {
      const r: N = rip.element(i);
      const age = r.z;
      If(age.greaterThan(0).and(age.lessThan(RIPPLE_LIFE)), () => {
        const u = length(p.sub(r.xy)).sub(age.mul(RIPPLE_SPEED));
        const env = exp(age.mul(-RIPPLE.decay)).mul(r.w).mul(smoothstep(0, RIPPLE.rise, age));
        const uw = u.mul(RIPPLE.width);
        w.addAssign(float(RIPPLE.height).mul(env).mul(exp(uw.mul(uw).negate())).mul(sin(u.mul(RIPPLE.waves))));
      });
    });
    return w;
  });

  const P: N = positionWorld;
  const p = P.xz;
  const V: N = toward;
  const h0: N = waves(p).toVar();
  const slopeX: N = waves(p.add(vec2(WAVES.eps, 0))).sub(h0).div(WAVES.eps).mul(WAVES.gain);
  const slopeZ: N = waves(p.add(vec2(0, WAVES.eps))).sub(h0).div(WAVES.eps).mul(WAVES.gain);
  const Nw: N = normalize(vec3(slopeX.negate(), 1, slopeZ.negate())).toVar();

  // Bed height and water mask: one filtered sample at the top level. Texel (i, j) lies at tile (i / BED_RES, j / BED_RES).
  const fieldAt = texture(field, p.mul(BED_RES).add(0.5).div(vec2(map.w * BED_RES + 1, map.h * BED_RES + 1)));
  // The surface's own height: a pool's sheet lies at WATER_LEVEL, a puddle's at PUDDLE_LEVEL (#380).
  const depth = max(P.y.sub(fieldAt.r), 0);
  const thick = depth.div(max(V.y, VIEW_MIN));

  // What lies behind the surface, absorbed along its way, plus the little the water scatters back of the light at the surface.
  const copyNode = texture(new Texture(), screenUV.add(Nw.xz.mul(REFRACT).mul(clamp(depth, 0, 1))));
  const T = exp(vec3(...ABSORB).mul(thick).negate());
  const lit = lighting.lightAt(P, Nw, WRAP, { shadow: 'walls' }).rgb;
  const through = copyNode.rgb.mul(T).add(vec3(...SCATTER).mul(lit).mul(float(1).sub(T)));

  // The mirror picture at the surface point (v runs down in a picture: three turns it for the backend), nudged by the waves.
  const clip = uMirror.mul(vec4(P, 1));
  const ndc = clip.xy.div(clip.w);
  const mirrorNode = texture(new Texture(), vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5))).add(Nw.xz.mul(MIRROR_WOBBLE)));
  const fresnel = float(FRESNEL_0).add(pow(float(1).sub(max(dot(Nw, V), 0)), FRESNEL_POW).mul(1 - FRESNEL_0));
  const share = clamp(float(MIRROR_BASE).add(fresnel.mul(FRESNEL_GAIN * (1 - MIRROR_BASE))), 0, MIRROR_MAX).mul(uMirrorOn);
  const colour = mix(through, mirrorNode.rgb.mul(MIRROR_GAIN), share).add(lighting.glintAt(P, Nw, V));

  const m = new MeshBasicNodeMaterial();
  // Outside the pool's outline (a chasm's or a lava pool's bulge into a border cell) there is no surface.
  m.colorNode = vec4(sight.apply(colour, P, sight.unseenAt(p)), step(OUTLINE_EDGE, fieldAt.g));
  m.alphaTest = 0.5;

  return {
    material: m,
    time,
    mirrorOn: uMirrorOn,
    ripples: rip.array as Vector4[],
    setRipples(packed) {
      for (let i = 0; i < RIPPLE_CAP; i++) {
        const v = rip.array[i] as Vector4;
        if (packed) v.set(packed[i * 4], packed[i * 4 + 1], packed[i * 4 + 2], packed[i * 4 + 3]);
        else v.set(0, 0, -1, 0);
      }
    },
    setScene(copy) {
      copyNode.value = copy;
    },
    setMirror(mi) {
      uMirrorOn.value = mi ? 1 : 0;
      if (!mi) return;
      mirrorNode.value = mi.picture;
      (uMirror.value as Matrix4).copy(mi.matrix);
    },
  };
}

/**
 * The mirror pass's ceiling: dark rough rock (noise over the world's x and z, thin dark cracks), lit from below by the game's lights, so a
 * torch leaves a warm patch on it. Without it the water mirrors empty space, which reads as a slate sheen. The picture never draws it.
 */
export function ceilingMaterial(lighting: Lighting, sight: Sight): NodeMaterial {
  const P: N = positionWorld;
  const q = P.xz;
  const tone = float(CEILING.base).add(fbm2(q.mul(CEILING.freq)).mul(CEILING.range));
  const vein = abs(vnoise2(q.mul(CEILING.crackFreq).add(vec2(9, 0))).sub(0.5));
  const crack = mix(float(CEILING.crackDark), float(1), smoothstep(CEILING.crackWidth * 0.5, CEILING.crackWidth, vein));
  const albedo = vec3(...CEILING.tint).mul(tone).mul(crack);
  const lit = lighting.lightAt(P, vec3(0, -1, 0), CEILING.wrap, { shadow: 'walls' });
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sight.apply(lighting.finish(albedo, lit), P, sight.unseenAt(q)), 1);
  return m;
}

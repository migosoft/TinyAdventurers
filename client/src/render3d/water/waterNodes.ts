// The water's surface in TSL (#345), and the ceiling only its mirror pass draws. The surface is one flat sheet at WATER_LEVEL
// (waterMesh.ts). It is clear: what lies behind it (the bed, a wading figure's legs) comes from a copy of the opaque scene, read at the
// screen position with a small refraction offset, and is absorbed by the length of the way through the water (red first), so the deep
// middle is dark because the way is long, not because of a tint. The depth is the bed's height from the field texture (waterField.ts),
// not the depth buffer. On top: the room mirrored in the water plane (a picture the view draws from below, passes.ts) and the glints of
// the lights. Calm, large waves and the ripples of ripples.ts tilt the normal that all of it reads. The numbers are first guesses from
// the mockup, tuned by eye.
import { Matrix4, MeshBasicNodeMaterial, Texture, Vector3, Vector4, type NodeMaterial } from 'three/webgpu';
import { Fn, If, Loop, abs, clamp, cos, dot, exp, float, fract, length, max, mix, normalize, positionWorld, pow, reflect, screenUV, sin, smoothstep, sqrt, step, texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import type { ViewToward } from '../materials';
import { fbm2, vnoise2 } from '../noiseNodes';
import { BED_RES, OUTLINE_EDGE, WATER_LEVEL } from '../dips/shape';
import { FISH_AWAY, FISH_CAP, FISH_STRIDE } from '../pond/fish';
import type { Mouth } from '../pond/pondField';
import { PUDDLE_LEVEL } from '../stone/shape';
import { DROP, RIPPLE, RIPPLE_CAP, RIPPLE_LIFE, RIPPLE_SPEED } from './ripples';

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
/** A puddle's ring (#380): the share of the light at the surface its sides add, rising between these two tilts of the normal toward the eye (the calm waves stay below the first). */
export const RING_SHEEN = { from: 0.12, to: 0.4, gain: 0.6 } as const;
/** A sheet at or above this height is a puddle's (`PUDDLE_LEVEL`), below it a pool's (`WATER_LEVEL`): only a puddle's rings get the sheen. */
export const PUDDLE_GATE = (WATER_LEVEL + PUDDLE_LEVEL) / 2;
/** The Fresnel term: the share mirrored looking straight down, and the power of its rise toward a grazing view. */
const FRESNEL_0 = 0.02, FRESNEL_POW = 5;

/**
 * The water in daylight (#360: a woodland's pond and brooks), by eye after the pond spike (#348). The same clear sheet as the dungeon's,
 * under a sun and a sky instead of a ceiling.
 */
export const DAY = {
  /** What a tile of way through the water takes from red, green and blue (the bed turns blue-green with depth), and the colour the water scatters back per unit of light at the surface. */
  absorb: [0.5, 0.17, 0.13], murk: [0.04, 0.2, 0.2],
  /** The height over the ground the sun's shadow is read at: the bed's (dipNodes.ts), so the water and its bed sit in the same tree shadows. */
  shadowAt: 0.03,
  /**
   * The sky's mirror: its share looking down (`base`) and how fast the Fresnel term raises it (`gain`) up to `max`; the mirrored ray's
   * heights between which the colour goes from the horizon's to the zenith's (`low`, `high`); the factor on the waves' tilt for that
   * ray (`tilt`: the calm waves show as bands of sky); the depth (tiles) over which the mirror fades in from the shore (`shore`); the
   * share a mirrored tree or figure adds (`things`); the share of the sky's mirror left in a tree's shadow (`shade`: a bright sheet in
   * a dark shadow reads as milk).
   */
  sky: { base: 0.16, gain: 6, max: 0.9, low: 0.45, high: 0.95, tilt: 3, shore: 0.35, things: 0.25, shade: 0.6 },
  /** The caustics on the bed: the two noises' cells per tile and their drifts (cells per second), half the width of a light line (in noise value), the depths (tiles) where they fade in and are gone, and their gain on the sunlit bed. */
  caustic: { freq: 2.63, driftA: [0.21, 0.13], driftB: [-0.17, 0.19], width: 0.1, shore: 0.1, from: 0.15, to: 1.3, gain: 0.3 },
  /**
   * The sun's sparkles: small dashes across the screen that twinkle. Two noises (`along` the screen's right and `across`, cells per tile,
   * the second `finer` by this factor) are multiplied; a sparkle shows where the product passes `from` (full at `to`). A low sun
   * stretches them (`stretch`: the share `along` loses). How many there are follows the slope a wavelet needs to turn the sun to the
   * eye: `spread` (and `spreadLow` more under a low sun) is the slope the wavelets reach, `lean` the factor on the calm waves' own
   * slope (sparkles gather on the sides that face the sun), `rare` what a poor angle takes from the product, `least` the share that
   * is always left. `gain`: a sparkle's brightness in sun light; `sheen`: the faint glow around them.
   */
  spark: { along: 5.3, across: 9.7, finer: 1.6, from: 0.65, to: 0.705, stretch: 0.45, spread: 0.3, spreadLow: 0.6, lean: 6, rare: 0.12, least: 0.45, gain: 0.8, sheen: 0.03 },
  /** The pale line where the water meets the bank: its width as depth (tiles) and its share of the light. */
  edge: { width: 0.05, gain: 0.1 },
} as const;
/**
 * A pond's current (#360), after the spike's: where the field's flow channels are not zero, a fine pattern runs downstream. It is
 * noise carried by the flow in two phases that cross-fade (`cycle` seconds each, shifted half a cycle), so it never stretches for
 * long; at full strength it runs `speed` tiles per second. `streak`: the pale streaks' noise cells per tile, the step (tiles) between
 * the four places along the stream the noise is averaged over (that draws it out into lines), the noise values between which a streak
 * appears, and its share of the light at the surface on a brook. `wavelet`: the cells per tile of the noise that tilts the surface,
 * and the tilt at full strength (quality Fast leaves the wavelets out and keeps the streaks).
 */
export const CURRENT = {
  speed: 1.3, cycle: 1.3,
  streak: { freq: 11.7, smear: 0.06, from: 0.58, to: 0.67, gain: 0.26 },
  wavelet: { freq: 6.3, tilt: 0.11 },
} as const;
/**
 * The stir where a brook enters the pond (#360; its rings are `MOUTH_RING` in ripples.ts): a restless, paler patch. It starts `before`
 * tiles upstream of the mouth, is full `rise` tiles into the pond and fades out by `len` tiles; `width` is its half width (tiles) at
 * the mouth, growing by `widen` per tile. Inside it the wavelets tilt the surface by `tilt` more, the streaks gain `flecks`, and the
 * water takes `pale` of the colour `milk` (lit): churned water is cloudy.
 */
export const STIR = { before: 0.5, rise: 0.4, len: 3.2, width: 0.55, widen: 0.3, tilt: 0.2, flecks: 0.1, pale: 0.2, milk: [0.515, 0.66, 0.66] } as const;
/**
 * How the fish (pond/fish.ts) are drawn: dark shapes under the surface. Half a body's length (tiles) is `len` to `len + longer`, its
 * swim depth `depth` to `depth + deeper` (both by the fish's number). A body is `slim` of its length wide; the tail fin sits `tailAt`
 * lengths behind the middle, `tail` long and `tailWide` wide, a little fainter (`tailDim`). The body bends as a wave of `wave`
 * radians per tile and `wag` tiles of swing at the tail. A fish shows where the water is `clear` to `clear + full` tiles deeper than
 * it swims, takes `dark` of the light from what lies behind it, less by exp(-dim * depth) the deeper it swims, and is seen `bend`
 * tiles off per unit of the surface's tilt and tile of depth.
 */
export const FISH_LOOK = {
  len: 0.19, longer: 0.1, depth: 0.22, deeper: 0.4, slim: 0.3, tailAt: 1.25, tail: 0.38, tailWide: 0.26, tailDim: 0.8,
  wave: 11.3, wag: 0.035, clear: 0.05, full: 0.25, dark: 0.8, dim: 1.1, bend: 0.35,
} as const;
/** The sky's colours the water mirrors (`waterSky` in sun.ts makes them from the hour's sky). */
export interface WaterSky { zenith: readonly [number, number, number]; horizon: readonly [number, number, number] }

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
  /** In daylight: the sky's colours the surface mirrors, set per frame. A water without daylight has no sky: null, and `setSky` does nothing. */
  setSky(s: WaterSky): void;
  readonly sky: { zenith: Vector3; horizon: Vector3 } | null;
  /** In daylight: 1 while a mirror is set, else 0 (quality Fast): the switch of the sparkles, the caustics and the current's wavelets. Null without daylight. */
  readonly fine: { value: number } | null;
  /** A pond's fish (#360): FISH_CAP times (x, z, heading, wag phase) as `Fish.positions` gives them; null: none. A water without a pond draws no fish, and this does nothing. */
  setFish(positions: Float32Array | null): void;
  /** The fish uniform's FISH_CAP slots as `setFish` left them (read-only, for tests); null: a water without a pond. */
  readonly fish: readonly Vector4[] | null;
}

/** The current and the stir of a pond's water at the surface point: the tilt they add to the normal, the streaks' noise (0..1) and the strengths of the current and the stir there (0..1). */
interface PondSurface { slope: N; streak: N; amt: N; stir: N }

/**
 * A pond's moving water (`CURRENT`, `STIR`). `flow`: the field's flow channels at the point; `mouths`: where the brooks enter (their
 * places go into the shader as numbers: they never move).
 */
function pondSurface(k: { p: N; time: N; fine: N; flow: N; mouths: readonly Mouth[] }): PondSurface {
  const { p, time, flow } = k;
  const amt: N = clamp(length(flow), 0, 1).toVar();
  // The stir: a patch that fans out from each mouth along its direction.
  let stirAt: N = float(0);
  for (const m of k.mouths) {
    const d = p.sub(vec2(m.x, m.z));
    const along: N = dot(d, vec2(m.dx, m.dz)), across = d.x.mul(m.dz).sub(d.y.mul(m.dx));
    const half = max(along.mul(STIR.widen).add(STIR.width), STIR.width * 0.5);
    const side = across.div(half);
    stirAt = max(stirAt, smoothstep(-STIR.before, STIR.rise, along).mul(float(1).sub(smoothstep(STIR.rise, STIR.len, along))).mul(exp(side.mul(side).negate())));
  }
  const stir: N = stirAt.toVar();
  const S = CURRENT.streak, W = CURRENT.wavelet;
  // Plain arithmetic, so a real branch: nothing of it runs on still water. xy: the wavelets' tilt (0 with quality Fast), z: the streaks' noise.
  const work: N = Fn(() => {
    const v = vec3(0, 0, 0).toVar();
    If(amt.add(stir).greaterThan(0.004), () => {
      const ph: N = fract(time.div(CURRENT.cycle)), ph2: N = fract(time.div(CURRENT.cycle).add(0.5));
      const w: N = abs(ph.mul(2).sub(1)).toVar();
      // Two uncorrelated noises mixed by w have less contrast in the middle of the fade: this brings it back, so the pattern does not pulse.
      const keep = float(1).div(sqrt(w.mul(w).add(float(1).sub(w).mul(float(1).sub(w)))));
      const reach = CURRENT.speed * CURRENT.cycle;
      const qa: N = p.sub(flow.mul(ph.mul(reach))).toVar(), qb: N = p.sub(flow.mul(ph2.mul(reach))).add(vec2(5.2, 1.3)).toVar();
      const tap: N = flow.div(max(amt, 0.05)).mul(S.smear).toVar();
      const at = (q: N, steps: number): N => vnoise2(q.add(tap.mul(steps)).mul(S.freq));
      const line = (q: N): N => at(q, -1.5).add(at(q, -0.5)).add(at(q, 0.5)).add(at(q, 1.5)).div(4);
      const streak = mix(line(qa), line(qb), w).sub(0.5).mul(keep).add(0.5);
      const tilt = vec2(0, 0).toVar();
      If(k.fine.greaterThan(0.5), () => {
        const wave = (o: number): N => mix(vnoise2(qa.mul(W.freq).add(o)), vnoise2(qb.mul(W.freq).add(o)), w).sub(0.5).mul(keep);
        tilt.assign(vec2(wave(0), wave(7.1)).mul(amt.mul(W.tilt).add(stir.mul(STIR.tilt))));
      });
      v.assign(vec3(tilt, streak));
    });
    return v;
  })().toVar();
  return { slope: work.xy, streak: work.z, amt, stir };
}

/**
 * How much of the light from behind them the fish take at the surface point (`FISH_LOOK`), 0..1. `fish`: FISH_CAP vec4 (x, z, heading,
 * wag phase). Each is a slim body with a tail fin, seen where the view ray passes its swim depth.
 */
function fishShade(k: { p: N; V: N; Nw: N; depth: N; fish: N }): N {
  const L = FISH_LOOK;
  const fall = (a: N, b: N, x: N): N => float(1).sub(smoothstep(a, b, x));
  return Fn(() => {
    const shade = float(0).toVar();
    Loop(named('fi', FISH_CAP), ({ fi: i }: N) => {
      const f: N = k.fish.element(i);
      const n = float(i);
      const len: N = fract(n.mul(0.37).add(0.2)).mul(L.longer).add(L.len).toVar();
      const deep: N = fract(n.mul(0.618)).mul(L.deeper).add(L.depth).toVar();
      const d: N = k.p.sub(k.V.xz.mul(deep.div(max(k.V.y, VIEW_MIN)))).add(k.Nw.xz.mul(deep.mul(L.bend))).sub(f.xy).toVar();
      If(dot(d, d).lessThan(len.mul(len).mul(4)), () => {
        const c: N = cos(f.z), s: N = sin(f.z);
        const lx: N = d.x.mul(c).add(d.y.mul(s)).toVar();
        // the wave runs from the head to the tail and grows toward it
        const swing = sin(lx.mul(L.wave).add(f.w)).mul(L.wag).mul(fall(len.mul(-1.6), len.mul(0.6), lx));
        const ly: N = d.y.mul(c).sub(d.x.mul(s)).add(swing).toVar();
        const oval = (x: N, rx: N, ry: N): N => x.div(rx).mul(x.div(rx)).add(ly.div(ry).mul(ly.div(ry)));
        const body = fall(float(0.7), float(1), oval(lx, len, len.mul(L.slim)));
        const tail = fall(float(0.6), float(1), oval(lx.add(len.mul(L.tailAt)), len.mul(L.tail), len.mul(L.tailWide)));
        const seen = smoothstep(deep.add(L.clear), deep.add(L.clear + L.full), k.depth).mul(exp(deep.mul(-L.dim)));
        shade.assign(max(shade, max(body, tail.mul(L.tailDim)).mul(seen)));
      });
    });
    return shade.mul(L.dark);
  })();
}

/**
 * The colour of the surface in daylight (`DAY`): the bed and what stands in the water, seen through clear water that takes the sun and
 * the trees' shadows; the sky mirrored by Fresnel, with the mirror pass's trees and figures in it; the sun's sparkles; a pale line at
 * the bank.
 */
function daylightColour(k: {
  lighting: Lighting; P: N; V: N; Nw: N; slope: N; depth: N; thick: N; lit: N; copy: N; mirror: N; mirrorOn: N; time: N; zenith: N; horizon: N; fine: N;
  /** A pond's current, stir and fish (#360); null: a water without a pond, which has none of them. */
  pond: (PondSurface & { fish: N }) | null;
}): N {
  const { P, V, Nw, slope, depth, thick, time } = k;
  const { sun } = k.lighting;
  const p = P.xz;
  // The sun on the surface, read once: its colour, the trees' shadows and the clouds'.
  const sunLit: N = sun.term(P, vec3(P.x, DAY.shadowAt, P.z), float(1)).toVar();
  const light: N = k.lit.add(sunLit.mul(mix(max(dot(Nw, sun.dir), 0), float(1), WRAP))).toVar();

  // The slope a wavelet needs to turn the sun toward the eye, and how well the surface here offers it (0..1).
  const S = DAY.spark, C = DAY.caustic;
  const half: N = normalize(sun.dir.add(V));
  const lowSun = float(1).sub(sun.dir.y);
  const miss = half.xz.div(max(half.y, 0.2)).negate().sub(slope.mul(S.lean));
  const spread = float(S.spread).add(lowSun.mul(S.spreadLow));
  const facing: N = exp(dot(miss, miss).div(spread.mul(spread)).negate()).toVar();

  // The fine work, which quality Fast leaves out (plain arithmetic, so a real branch): x the caustics' lines, y the sparkles.
  const fineWork: N = Fn(() => {
    const v = vec2(0, 0).toVar();
    If(k.fine.greaterThan(0.5), () => {
      // The caustics lie on the bed: where the view ray lands, not on the surface.
      const pb = p.sub(V.xz.mul(thick));
      const ca = vnoise2(pb.mul(C.freq).add(vec2(time.mul(C.driftA[0]), time.mul(C.driftA[1]))));
      const cb = vnoise2(pb.mul(C.freq).add(vec2(time.mul(C.driftB[0]), time.mul(C.driftB[1]))).add(4.4));
      const lines = float(1).sub(smoothstep(0, C.width, abs(ca.sub(cb))));
      // The sparkles: dashes along the screen's right, wherever the camera has turned.
      const right = sun.right.xz;
      const q = vec2(dot(p, right), dot(p, vec2(right.y.negate(), right.x)));
      const along = float(S.along).mul(float(1).sub(lowSun.mul(S.stretch)));
      const tw1 = vnoise2(q.mul(vec2(along, S.across)).add(vec2(time.mul(0.9), time.mul(-0.6))));
      const tw2 = vnoise2(q.mul(vec2(along.mul(S.finer), S.across * S.finer)).add(vec2(time.mul(-0.7), time.mul(1.1))).add(3.3));
      const often = mix(float(S.least), float(1), facing);
      v.assign(vec2(lines, smoothstep(S.from, S.to, tw1.mul(tw2).sub(float(1).sub(often).mul(S.rare)))));
    });
    return v;
  })().toVar();

  // Through the water: the bed (lit by the same sun, with the caustics where it is shallow), absorbed along the way, and the water's own murk.
  const sunShare = clamp(dot(sunLit, vec3(1 / 3, 1 / 3, 1 / 3)), 0, 1);
  const caustics = fineWork.x.mul(smoothstep(0, C.shore, depth)).mul(float(1).sub(smoothstep(C.from, C.to, depth))).mul(sunShare).mul(C.gain);
  const T = exp(vec3(...DAY.absorb).mul(thick).negate());
  const clear = k.copy.rgb.mul(caustics.add(1)).mul(T).add(vec3(...DAY.murk).mul(light).mul(float(1).sub(T)));
  // In a pond: the fish in front of the bed, and the water churned cloudy where a brook comes in.
  const through = k.pond
    ? mix(clear.mul(float(1).sub(fishShade({ p, V, Nw, depth, fish: k.pond.fish }))), vec3(...STIR.milk).mul(light), k.pond.stir.mul(STIR.pale).mul(smoothstep(0, DAY.sky.shore, depth)))
    : clear;

  // The sky in the surface, and over it what the mirror pass drew (its picture is clear, alpha 0, where nothing stands).
  const K = DAY.sky;
  const R: N = reflect(V.negate(), normalize(vec3(slope.x.mul(-K.tilt), 1, slope.y.mul(-K.tilt))));
  const skyCol = mix(vec3(k.horizon), vec3(k.zenith), smoothstep(K.low, K.high, R.y));
  const things = k.mirror.a.mul(k.mirrorOn);
  const mirrored = skyCol.mul(mix(float(K.shade), float(1), sunShare)).mul(float(1).sub(things)).add(k.mirror.rgb.mul(k.mirrorOn));
  const open = smoothstep(0, K.shore, depth);
  const fresnel = pow(float(1).sub(max(dot(Nw, V), 0)), FRESNEL_POW);
  const share = clamp(float(K.base).add(fresnel.mul(K.gain)).add(things.mul(K.things)), 0, K.max).mul(open);

  const glints = sunLit.mul(fineWork.y.mul(S.gain).add(facing.mul(S.sheen))).mul(open);
  const edge = light.mul(float(1).sub(smoothstep(0, DAY.edge.width, depth)).mul(DAY.edge.gain));
  const still = mix(through, mirrored, share).add(k.lighting.glintAt(P, Nw, V)).add(glints).add(edge);
  if (!k.pond) return still;
  // The current's pale streaks, more of them in the stir: they take the light at the surface, so they show in a tree's shade too.
  const G = CURRENT.streak;
  const streaks = smoothstep(G.from, G.to, k.pond.streak).mul(k.pond.amt.mul(G.gain).add(k.pond.stir.mul(STIR.flecks)));
  return still.add(light.mul(streaks).mul(smoothstep(0, DAY.edge.width, depth)));
}

/**
 * `field`: the RGBA half-float texture of the bed height, the water mask and the current (waterField.ts), linear; `map` its size in
 * tiles; `toward`: the unit vector toward the eye. `daylight` (#360): the water of a world with a sun and a sky (`lighting` must have
 * its sun); without it the shader is the dungeon's, with nothing of the sun in it. `pond` (with `daylight` only): the map's pond
 * field, whose water runs, stirs at the mouths and holds fish; without it the shader has none of that.
 */
export function waterMaterial(
  lighting: Lighting, sight: Sight, field: Texture, map: { w: number; h: number }, toward: ViewToward,
  opts: { daylight?: boolean; pond?: { mouths: readonly Mouth[] } } = {},
): WaterMaterial {
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
        // a negative strength: a puddle's small ring
        const s = mix(float(DROP.scale), float(1), step(0, r.w));
        const u = length(p.sub(r.xy)).div(s).sub(age.mul(RIPPLE_SPEED));
        const env = exp(age.mul(-RIPPLE.decay)).mul(abs(r.w)).mul(s).mul(smoothstep(0, RIPPLE.rise, age));
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
  // Bed height, water mask and current: one filtered sample at the top level. Texel (i, j) lies at tile (i / BED_RES, j / BED_RES).
  const fieldAt = texture(field, p.mul(BED_RES).add(0.5).div(vec2(map.w * BED_RES + 1, map.h * BED_RES + 1)));
  const day = opts.daylight
    ? { zenith: uniform(new Vector3(0.3, 0.5, 0.82)).setName('waterZenith'), horizon: uniform(new Vector3(0.74, 0.79, 0.82)).setName('waterHorizon'), fine: uniform(0).setName('waterFine') }
    : null;
  // A pond's water (#360): the current and the stir tilt the surface too.
  const fish = day && opts.pond ? uniformArray(Array.from({ length: FISH_CAP }, () => new Vector4(FISH_AWAY, FISH_AWAY, 0, 0)), 'vec4') : null;
  const pond = day && opts.pond && fish ? { ...pondSurface({ p, time, fine: day.fine, flow: fieldAt.zw, mouths: opts.pond.mouths }), fish } : null;
  const slope: N = pond ? vec2(slopeX, slopeZ).add(pond.slope).toVar() : vec2(slopeX, slopeZ);
  const Nw: N = (pond ? normalize(vec3(slope.x.negate(), 1, slope.y.negate())) : normalize(vec3(slopeX.negate(), 1, slopeZ.negate()))).toVar();

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
  // A puddle (its sheet lies above a pool's) mirrors only dark rock, so a ring's sides that lean toward the eye also catch the light at
  // the surface: one line a crest.
  const sheen = smoothstep(RING_SHEEN.from, RING_SHEEN.to, dot(Nw.xz, V.xz)).mul(step(PUDDLE_GATE, P.y)).mul(RING_SHEEN.gain);
  const colour = day
    ? daylightColour({ lighting, P, V, Nw, slope, depth, thick, lit, copy: copyNode, mirror: mirrorNode, mirrorOn: uMirrorOn, time, ...day, pond })
    : mix(through, mirrorNode.rgb.mul(MIRROR_GAIN), share).add(lighting.glintAt(P, Nw, V)).add(lit.mul(sheen));

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
    sky: day && { zenith: day.zenith.value, horizon: day.horizon.value },
    fine: day && day.fine,
    fish: fish && (fish.array as Vector4[]),
    setFish(pos) {
      if (!fish) return;
      for (let i = 0; i < FISH_CAP; i++) {
        const v = fish.array[i] as Vector4, at = i * FISH_STRIDE;
        if (pos) v.set(pos[at], pos[at + 1], pos[at + 2], pos[at + 3]);
        else v.set(FISH_AWAY, FISH_AWAY, 0, 0);
      }
    },
    setSky(s) {
      day?.zenith.value.set(...s.zenith);
      day?.horizon.value.set(...s.horizon);
    },
    setMirror(mi) {
      uMirrorOn.value = mi ? 1 : 0;
      if (day) day.fine.value = uMirrorOn.value;
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

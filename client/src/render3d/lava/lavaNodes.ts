// The lava's surface and the heat shimmer over it in TSL (#344). The surface is one sheet at LAVA_LEVEL (lavaMesh.ts) that glows by
// itself: dark plates of crust (a Voronoi whose points drift) float on the molten rock, which shows in the cracks between them, in
// slow open pools and along the shore. A figure wading in it leaves a molten ring, and a bubble swells as a dome (the vertex stage
// lifts the sheet), pops as a bright ring and closes. No light of the room falls on it: the glow on the surroundings is the lava
// light of lightNodes.ts. The shimmer re-draws the scene behind the air over the lava with a small rising wobble. The numbers are the
// approved mockup's unless a comment says otherwise; its colours were tuned under a tone map, which the lava applies to itself (`GLOW`).
import { MeshBasicNodeMaterial, Texture, Vector4, type NodeMaterial } from 'three/webgpu';
import { Fn, If, Loop, attribute, dot, exp, float, floor, fract, length, max, mix, positionLocal, positionWorld, screenUV, sin, smoothstep, sqrt, step, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { sharedArray } from '../sharedArray';
import type { Sight } from '../sightNodes';
import type { ViewToward } from '../materials';
import { fbm2, hash21, hash22, vnoise2 } from '../noiseNodes';
import { LAVA_LEVEL, OUTLINE_EDGE } from '../dips/shape';
import { BUBBLE, BUBBLE_CAP } from './bubbles';
import { STIR_CAP } from './lava';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** A loop from 0 to `end` whose index is called `name` (every TSL loop names its own index). */
const named = (name: string, end: number): N => ({ start: 0, end, name });

/**
 * The crust: the plates' cells per tile; how far (cells) a slow noise of `warpFreq` per tile bends them; the cells per second the
 * whole crust flows; how far a cell's point drifts round its centre (cells; above about 0.4 the 3 by 3 search breaks and draws
 * squares) and how fast (radians per second); the width of the molten crack between two plates and of a plate's dull red rim (both in
 * cells, as the difference of the distances to the two nearest points).
 */
export const CRUST = { freq: 1.7, warp: 1.1, warpFreq: 0.7, flow: [0.035, 0.015], drift: 0.3, driftRate: 0.12, crack: 0.11, rim: 0.2 } as const;
/**
 * The molten rock: the open pools' noise (per tile) and the range of it over which the crust opens; the heat noise's frequency (per
 * tile); the ring round a wading figure: full within `ring[1]` tiles, gone at `ring[0]`.
 */
export const MOLTEN = { openFreq: 0.55, open: [0.6, 0.74], heatFreq: 2.2, ring: [0.75, 0.3] } as const;
/**
 * The shimmer: the height of the hot air over the lava (tiles); the largest offset of the scene copy's read (screens); the noise's
 * cells per tile along the camera's right and forward axis; the cells per second the two reads rise.
 */
export const HEAT = { height: 1.6, offset: 0.006, freq: [2.5, 2.2], rise: [1.6, 1.9] } as const;

/** The noises' drifts (per second, in their own cells): the two reads of the warp, the open pools and the heat; `warpSeed` sets the warp's second read apart. */
export const FLOW = { warp: [0.04, -0.035], warpSeed: 7.3, open: [-0.025, 0.018], heat: [0.22, -0.15] } as const;
/**
 * The colours, as light: `glowShown` presses them into what the screen shows, so a value above 1 is brighter, not clipped. Molten: from `deep` to `hot` by the heat, then toward `white` by `whiteShare` over
 * the heat range `whiteAt`. Crust: `crust` times a grain (`grain[0]` plus `grain[1]` of a noise at `grainFreq` per cell) and a tone
 * per plate (`plate[0]` plus `plate[1]` of the plate's hash); `rim` is added at a plate's edge, scaled by `rimHeat[0]` plus
 * `rimHeat[1]` of the heat.
 */
export const LAVA_COLOUR = {
  deep: [0.85, 0.1, 0.01], hot: [1.7, 0.55, 0.06], white: [2.4, 1.5, 0.55], whiteAt: [0.62, 0.85], whiteShare: 0.7,
  crust: [0.03, 0.018, 0.016], grainFreq: 5, grain: [0.5, 1], plate: [0.7, 0.6], rim: [0.35, 0.04, 0], rimHeat: [0.6, 0.4],
} as const;
/** The shore: over the first `width` tiles of lava above the bed there is no crust, and at the very edge the molten rock is `gain` times as bright. */
export const SHORE = { width: 0.15, gain: 1.3 } as const;
/** A wading figure's ring: the molten colour times `gain`, mixed in by up to `share`. */
export const STIR = { gain: 1.25, share: 0.9 } as const;
/**
 * A bubble's look. Swelling: the dome is solid within `edge` of its radius and `gain` times the molten colour, with the highlight
 * `glint` at `glintAt` radii off the centre (toward -x, -z), `glintSize` radii wide. Popping: a ring of colour `ring`, `ringSharp`
 * per tile sharp, and a patch of `patchGain` times the molten colour, `patch` radii wide and growing by one radius while it fades.
 */
export const BUBBLE_LOOK = {
  edge: 0.75, gain: 1.2, glint: [1.6, 1.2, 0.6], glintAt: 0.25, glintSize: 0.45,
  ring: [2.2, 1, 0.3], ringSharp: 12, patchGain: 1.5, patch: 0.5,
} as const;
/** The shimmer's noise: the offset that sets its second read apart; the strength at which a pixel is fully the wobbled copy; the least height of the view vector the ray is divided by; the heights of the ray at which the lava light is read. */
export const SHIMMER = { seed: 5.1, fade: 0.05, viewMin: 0.1, reads: 3 } as const;

/**
 * The glow's curve: the lava's colours are mixed as light (values above 1 are brighter, not whiter) and then pressed into 0..1 the way
 * the approved mockup showed them: `exposure`, the ACES filmic curve of three.js (`ACESFilmicToneMapping`: its two matrices as rows and
 * the fit between them) and the sRGB encoding. The view itself maps no tones; this is the lava's own response, which gives the cracks
 * their soft red skirt and turns the hottest rock toward yellow-white instead of clipping it.
 */
export const GLOW = {
  exposure: 1.15,
  toAces: [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]],
  fromAces: [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]],
} as const;

/** `colour` (light, any size) as the screen shows it, by `GLOW`. */
function glowShown(colour: N): N {
  const rows = (m: readonly (readonly number[])[], v: N): N => vec3(dot(v, vec3(...m[0])), dot(v, vec3(...m[1])), dot(v, vec3(...m[2])));
  const v: N = rows(GLOW.toAces, colour.mul(GLOW.exposure / 0.6));
  const fit = v.mul(v.add(0.0245786)).sub(0.000090537).div(v.mul(v.mul(0.983729).add(0.432951)).add(0.238081));
  const lin: N = rows(GLOW.fromAces, fit).clamp(0, 1);
  return mix(lin.mul(12.92), lin.pow(1 / 2.4).mul(1.055).sub(0.055), step(0.0031308, lin));
}

export interface LavaMaterial {
  material: NodeMaterial;
  time: { value: number };
  /** BUBBLE_CAP vec4 (x, z, age, size) as `Bubbles.pack` writes them; null: none. */
  setBubbles(packed: Float32Array | null): void;
  /** STIR_CAP vec4 (x, z, strength, 0); null: none. */
  setStirs(packed: Float32Array | null): void;
  /** The uniforms' slots as `setBubbles` and `setStirs` left them; read-only, for tests. */
  readonly bubbles: readonly Vector4[];
  readonly stirs: readonly Vector4[];
}

/** The surface of the lava. Its mesh carries the `shore` attribute (lavaMesh.ts) and world positions (the chunks stand at the origin). */
export function lavaMaterial(sight: Sight): LavaMaterial {
  const time = uniform(0);
  // A free slot has age -1 (a stale size adds nothing: only the age says whether a slot is live); a free stir has strength 0.
  const bub = sharedArray(Array.from({ length: BUBBLE_CAP }, () => new Vector4(0, 0, -1, 0)), 'vec4');
  const stir = sharedArray(Array.from({ length: STIR_CAP }, () => new Vector4()), 'vec4');
  const shore: N = attribute('shore', 'vec2');
  const END = BUBBLE.swell + BUBBLE.pop;

  /** The dome's radius of bubble `b` (the twin of `bubbleRadius`) and its share of the full size. */
  const grown = (b: N): N => smoothstep(0, BUBBLE.grow, b.z);
  const radius = (b: N, g: N): N => b.w.mul(g.mul(0.6).add(0.4));

  // The vertex stage: the sheet rises by the bubbles' domes (the twin of `bubbleRise`).
  const lifted = Fn(() => {
    const at: N = positionLocal;
    const rise = float(0).toVar();
    Loop(named('bv', BUBBLE_CAP), ({ bv: i }: N) => {
      const b: N = bub.element(i);
      If(b.z.greaterThan(0).and(b.z.lessThan(BUBBLE.swell)), () => {
        const g = grown(b).toVar();
        const r = radius(b, g);
        const off = at.xz.sub(b.xy);
        rise.addAssign(b.w.mul(BUBBLE.rise).mul(g).mul(max(float(1).sub(dot(off, off).div(r.mul(r))), 0)));
      });
    });
    return at.add(vec3(0, rise, 0));
  });

  const P: N = positionWorld;
  const p = P.xz;
  const along = (d: readonly number[]): N => vec2(time.mul(d[0]), time.mul(d[1]));

  const surface = Fn(() => {
    const C = LAVA_COLOUR;
    // The plates: a Voronoi over a bent, slowly flowing copy of the ground.
    const warp = vec2(fbm2(p.mul(CRUST.warpFreq).add(time.mul(FLOW.warp[0]))), fbm2(p.mul(CRUST.warpFreq).add(FLOW.warpSeed).add(time.mul(FLOW.warp[1]))));
    const q: N = p.mul(CRUST.freq).add(warp.mul(CRUST.warp)).add(along(CRUST.flow)).toVar();
    const cell0 = floor(q).toVar();
    const f = fract(q).toVar();
    // The squares of the distances to the nearest and the second nearest point, and the nearest cell's hash.
    const d1 = float(8).toVar(), d2 = float(8).toVar(), id = float(0).toVar();
    Loop(named('vj', 3), ({ vj }: N) => {
      Loop(named('vi', 3), ({ vi }: N) => {
        const g = vec2(float(vi).sub(1), float(vj).sub(1)).toVar();
        const cell = cell0.add(g).toVar();
        // The sine moves the cell's point to and fro round the cell's middle; the hash only sets the phase of each axis.
        const point = sin(hash22(cell).mul(2 * Math.PI).add(time.mul(CRUST.driftRate))).mul(CRUST.drift).add(0.5);
        const r = g.add(point).sub(f);
        const d = dot(r, r).toVar();
        If(d.lessThan(d1), () => {
          d2.assign(d1);
          d1.assign(d);
          id.assign(hash21(cell));
        }).ElseIf(d.lessThan(d2), () => {
          d2.assign(d);
        });
      });
    });
    const edge = sqrt(d2).sub(sqrt(d1)).toVar();
    const crack = float(1).sub(smoothstep(0, CRUST.crack, edge));
    const open = smoothstep(MOLTEN.open[0], MOLTEN.open[1], fbm2(p.mul(MOLTEN.openFreq).add(along(FLOW.open))));
    // The shore: 1 at the lava's edge, 0 from SHORE.width of lava over the bed.
    const bank = float(1).sub(smoothstep(0, SHORE.width, shore.y)).toVar();
    const plate = float(1).sub(crack).mul(float(1).sub(open)).mul(float(1).sub(bank));

    const heat = fbm2(p.mul(MOLTEN.heatFreq).add(along(FLOW.heat))).toVar();
    const molten: N = mix(mix(vec3(...C.deep), vec3(...C.hot), heat), vec3(...C.white), smoothstep(C.whiteAt[0], C.whiteAt[1], heat).mul(C.whiteShare)).toVar();
    const grain = vnoise2(q.mul(C.grainFreq)).mul(C.grain[1]).add(C.grain[0]);
    const crust = vec3(...C.crust).mul(grain).mul(id.mul(C.plate[1]).add(C.plate[0]))
      .add(vec3(...C.rim).mul(float(1).sub(smoothstep(0, CRUST.rim, edge))).mul(heat.mul(C.rimHeat[1]).add(C.rimHeat[0])));
    const col = mix(molten.mul(bank.mul(SHORE.gain - 1).add(1)), crust, plate).toVar();

    // The rings round wading figures.
    Loop(named('st', STIR_CAP), ({ st: i }: N) => {
      const s: N = stir.element(i);
      const ring = float(1).sub(smoothstep(MOLTEN.ring[1], MOLTEN.ring[0], length(p.sub(s.xy)))).mul(s.z);
      col.assign(mix(col, molten.mul(STIR.gain), ring.mul(STIR.share)));
    });

    // The bubbles: a molten dome while it swells, then a ring that widens and a patch that closes.
    const L = BUBBLE_LOOK;
    Loop(named('bb', BUBBLE_CAP), ({ bb: i }: N) => {
      const b: N = bub.element(i);
      const age = b.z;
      If(age.greaterThan(0).and(age.lessThan(END)), () => {
        const r = radius(b, grown(b)).toVar();
        const off = p.sub(b.xy).toVar();
        const d = length(off).toVar();
        If(age.lessThan(BUBBLE.swell), () => {
          const dome = float(1).sub(smoothstep(r.mul(L.edge), r, d));
          const glint = float(1).sub(smoothstep(0, r.mul(L.glintSize), length(off.add(r.mul(L.glintAt)))));
          col.assign(mix(col, molten.mul(L.gain).add(vec3(...L.glint).mul(glint)), dome));
        }).Else(() => {
          const a = age.sub(BUBBLE.swell).div(BUBBLE.pop).toVar();
          const fade = float(1).sub(a).toVar();
          const u = d.sub(r.mul(a.mul(BUBBLE.ring).add(1))).mul(L.ringSharp);
          col.addAssign(vec3(...L.ring).mul(exp(u.mul(u).negate())).mul(fade));
          col.assign(mix(col, molten.mul(L.patchGain), float(1).sub(smoothstep(0, r.mul(a.add(L.patch)), d)).mul(fade)));
        });
      });
    });
    return glowShown(col);
  });

  const m = new MeshBasicNodeMaterial();
  m.positionNode = lifted();
  // Outside the pool's outline (its bulge into a border cell ends there) there is no surface.
  m.colorNode = vec4(sight.apply(surface(), P, sight.unseenAt(p)), step(OUTLINE_EDGE, shore.x));
  m.alphaTest = 0.5;

  const fill = (slots: Vector4[], packed: Float32Array | null, free: number): void => {
    for (let i = 0; i < slots.length; i++) {
      if (packed) slots[i].set(packed[i * 4], packed[i * 4 + 1], packed[i * 4 + 2], packed[i * 4 + 3]);
      else slots[i].set(0, 0, free, 0);
    }
  };
  return {
    material: m,
    time,
    bubbles: bub.array as Vector4[],
    stirs: stir.array as Vector4[],
    setBubbles: (packed) => fill(bub.array as Vector4[], packed, -1),
    setStirs: (packed) => fill(stir.array as Vector4[], packed, 0),
  };
}

export interface ShimmerMaterial {
  material: NodeMaterial;
  time: { value: number };
  /** The opaque scene's copy (a render target's texture of the picture's size). Set before the first draw. */
  setScene(copy: Texture): void;
}

/**
 * The hot air over the lava: sheets above it (lavaMesh.ts) that show the scene copy, read a little off by a rising noise. All of it
 * comes from the pixel's view ray, not from the sheet, so the sheets of one pixel agree and no sheet's edge shows.
 * `lavaLight`: the lava light texture (alpha 1 on lava tiles, filtered); `map` its size in tiles; `toward`: the unit vector toward the eye.
 */
export function shimmerMaterial(sight: Sight, lavaLight: Texture, map: { w: number; h: number }, toward: ViewToward): ShimmerMaterial {
  const time = uniform(0);
  const P: N = positionWorld;
  const T: N = toward;
  const light = texture(lavaLight);
  const copy = texture(new Texture());

  const shown = Fn(() => {
    // The view ray's ground point at height `h` over the lava (the view is orthographic: every pixel's ray runs along `toward`).
    const per = T.xz.div(max(T.y, SHIMMER.viewMin)).toVar();
    const G: N = P.xz.add(per.mul(float(LAVA_LEVEL).sub(P.y))).toVar();
    // The air is hot over lava and cools with the height: three heights of the ray below `HEAT.height` (where the weight would be
    // 0) with the weights 1, 2/3 and 1/3 over their sum, so the strength reaches 1 over a wide pool; each read at the top level.
    const strength = float(0).toVar();
    for (let k = 0; k < SHIMMER.reads; k++) {
      const h = (HEAT.height * k) / SHIMMER.reads;
      strength.addAssign(light.sample(G.add(per.mul(h)).div(vec2(map.w, map.h))).a.mul((1 - k / SHIMMER.reads) / ((SHIMMER.reads + 1) / 2)));
    }
    // Only what the hero sees shimmers (all of it when the sight is off).
    const hard = sight.unseenAt(G).x.toVar();
    strength.mulAssign(sight.shown(hard, 0));
    // The noise lies on the ground in the camera's frame, so it rises on the screen whichever way the camera is turned.
    const ahead = T.xz.negate().div(max(length(T.xz), 1e-4)).toVar();
    const g = vec2(dot(G, vec2(ahead.y.negate(), ahead.x)).mul(HEAT.freq[0]), dot(G, ahead).mul(HEAT.freq[1])).toVar();
    const wobble = vec2(vnoise2(g.sub(vec2(0, time.mul(HEAT.rise[0])))), vnoise2(g.add(SHIMMER.seed).sub(vec2(0, time.mul(HEAT.rise[1]))))).sub(0.5);
    return vec4(copy.sample(screenUV.add(wobble.mul(HEAT.offset).mul(strength))).rgb, smoothstep(0, SHIMMER.fade, strength));
  });

  const m = new MeshBasicNodeMaterial();
  // No sight step: the copy went through it already, and the strength is gated by what is seen.
  m.colorNode = shown();
  m.transparent = true;
  m.depthWrite = false;
  return {
    material: m,
    time,
    setScene(c) {
      copy.value = c;
    },
  };
}

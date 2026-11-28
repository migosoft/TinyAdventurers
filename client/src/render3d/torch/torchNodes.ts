// The wall torch's two materials (#391). The holder is iron and wood lit by the game's lights like any world object, plus the fire's own
// warm light on the basket. The flame is lit by nothing and is see-through: fire painted on a card that turns round the flame's axis to
// the camera (so it is the same from every camera turn and on every wall), and a soft halo round it; both add their light to the picture
// (torch.ts builds the two quads). The fire is a sum of soft blobs cut into bands: a body that stays, and tongues that are born at the
// foot, climb, thin out and break off at the tip, each on its own clock. The same at every quality.
// Both materials end with the sight step, read on the floor in front of the wall (`foot`).
import { CustomBlending, DoubleSide, MeshBasicNodeMaterial, OneFactor, OneMinusSrcAlphaFactor, ZeroFactor, type NodeMaterial } from 'three/webgpu';
import { attribute, cross, float, floor, fract, length, max, mix, normalize, positionLocal, positionWorld, pow, sin, smoothstep, step, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { WALL_H } from '../heights';
import type { Lighting } from '../lightNodes';
import { cutWeightNode, type CutUniforms } from '../cutNodes';
import type { SeeUniforms, ViewToward } from '../materials';
import { hash21, hash22, vnoise2 } from '../noiseNodes';
import type { Sight } from '../sightNodes';
import { CARD_H, CARD_W, FLAME_H, FLAME_R, HALO_GAP, HALO_R } from './torch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The light's wrap round the holder's flat faces: iron in a dark hall still shows its shape. */
const HOLDER_WRAP = 0.35;
/** The fire's own light on the holder where `warm` is 1 (added after the room's light, so it shows in a dark hall too). */
const HOLDER_WARM = 0xc8601e;

/**
 * The flame's look (first guesses). Lengths are in FLAME_R, on the card: x across from the axis, y up from the foot (the flame's
 * nominal height FLAME_H is about 3.8).
 */
export const FLAME = {
  /**
   * The bands from the rim to the core (pack palette): the heat each starts at, its colour, how strongly its light is added, and how
   * much of what is behind it it hides (0: only added light; 1: a solid).
   */
  bands: [[0.16, 0xd8442a, 0.6, 0.3], [0.42, 0xff8a2a, 0.8, 0.45], [0.95, 0xffd24a, 0.95, 0.6], [1.45, 0xfff2b0, 1.1, 0.7]] as const,
  /** The body that stays: its middle's height, its half-width, how far it reaches down and up, how much it breathes (share) and how fast (rad/s). */
  body: { y: 1.0, w: 0.8, down: 1.0, up: 1.5, breathe: 0.1, rate: 7.3 },
  /** The white-hot heart low in the body: height, radius, weight. */
  heart: { y: 0.75, r: 0.6, weight: 0.5 },
  /**
   * The tongues: how many slots (never all visible: each life a slot stays empty with chance `rest`), lives a second (slowest, fastest),
   * where one is born (height) and how far from the axis (most), how high its middle climbs (least, most; its tip reaches further),
   * its radius (least, most), how much longer it is than wide (below its middle, above), how fast it narrows to its tip, and how far
   * it drifts back to the axis while it climbs (share).
   */
  tongues: { count: 6, rate: [1.1, 2.3], rest: 0.2, foot: 0.7, spread: 0.75, top: [2.4, 4.5], r: [0.45, 0.75], long: [1.4, 3.0], taper: 0.7, gather: 0.6 },
  /** The outline's sideways wobble, travelling up: how far (at the top), its wavelength's inverse, its speed (per s). */
  wobble: { far: 0.45, freq: 0.8, speed: 3.5 },
  /** The heat falls by this much from the foot to the nominal tip: the tops are redder and thinner. */
  cool: 0.35,
  /** The whole flame's brightness pulses by this share, at two rates (rad/s) so no beat is seen. */
  pulse: { depth: 0.22, rates: [9.7, 15.1] },
  /** The sparks: slots, lives a second, the chance a life has no spark, where they rise from and to (height), their radius, colour. */
  sparks: { count: 2, rate: 0.8, rest: 0.5, from: 2.2, to: 5.1, r: 0.14, colour: 0xffd24a },
  /** The halo: colour, strength at its middle, how much it swings with the flame's pulse (share). */
  halo: { colour: 0xff8a2a, strength: 0.55, swing: 0.3 },
} as const;

/** An upper bound of how far a corner of a flame's quads is from its vertex (tiles, size 1): what a chunk's bounds are widened by. */
export const FLAME_REACH = Math.max(CARD_H * FLAME_H, 2 * HALO_R + HALO_GAP);
/** Flames draw after the translucent figures and the smoke puffs, just before the glows: their light lies over all of them. */
export const FLAME_ORDER = 3.9;

const rgb = (c: number): N => vec3((c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
/** A soft blob: 1 at its middle, 0 from `d2` (the squared distance in radii) 1 on. */
const blob = (d2: N): N => {
  const k: N = max(float(1).sub(d2), 0);
  return k.mul(k);
};

/**
 * 1 where the torch's wall is cut (#347), else 0: read at the torch's wall point at the wall's top (the same test as the wall's own top edge there; at the flame's height the ground point lies in the wall cell and reads about 0.5), the same for all its vertices, so it hides whole.
 */
const hiddenByCut = (cut: CutUniforms, see: SeeUniforms): N => {
  const wall: N = attribute('foot', 'vec4'); // .zw: the wall point (.xy, the floor point in front, is the sight's)
  return cutWeightNode(vec3(wall.z, WALL_H, wall.w), cut, see).greaterThan(0.5).select(1, 0);
};

export function holderMaterial(lighting: Lighting, sight: Sight, cut: CutUniforms, see: SeeUniforms): NodeMaterial {
  const P: N = positionWorld;
  // every triangle has its own three vertices with its own normal (torch.ts): flat faces
  const lit = lighting.lightAt(P, attribute('normal', 'vec3'), HOLDER_WRAP);
  const m = new MeshBasicNodeMaterial();
  // the mesh's positions are world tiles about the origin, so scaling toward 0 collapses each triangle
  m.positionNode = positionLocal.mul(float(1).sub(hiddenByCut(cut, see))); // collapsed to zero-area triangles; the light stays
  const colour: N = lighting.finish(attribute('colour', 'vec3'), lit).add(rgb(HOLDER_WARM).mul(attribute('warm', 'float')));
  m.colorNode = vec4(sight.apply(colour, P, sight.unseenAt(attribute('foot', 'vec4').xy)), 1);
  return m;
}

export function flameMaterial(sight: Sight, toward: ViewToward, cut: CutUniforms, see: SeeUniforms): { material: NodeMaterial; time: { value: number } } {
  const time = uniform(0);
  /** The corner, the phase, the kind (0 card, 1 halo). */
  const f: N = attribute('flame', 'vec4'), reach: N = attribute('reach', 'vec2');
  const t: N = time.add(f.z), halo: N = f.w, seed: N = f.z;
  // The card stands upright and turns round the axis; the halo faces the camera whole and comes toward it, in front of the wall.
  const to: N = toward, right: N = normalize(vec3(to.z, 0, to.x.negate())), up: N = mix(vec3(0, 1, 0), cross(to, right), halo);
  const m = new MeshBasicNodeMaterial();
  m.positionNode = positionLocal.add(right.mul(f.x.mul(reach.x))).add(up.mul(f.y.mul(reach.y))).add(to.mul(halo.mul(reach.x.add(HALO_GAP)))).mul(float(1).sub(hiddenByCut(cut, see)));

  // the fire, in FLAME_R from the foot
  const T = FLAME.tongues, B = FLAME.body, top = FLAME_H / FLAME_R;
  const y: N = f.y.mul(CARD_H * top);
  const wob: N = vnoise2(vec2(y.mul(FLAME.wobble.freq).sub(t.mul(FLAME.wobble.speed)), seed)).sub(0.5).mul(2 * FLAME.wobble.far).mul(smoothstep(0.4, top, y));
  const x: N = f.x.mul(CARD_W).add(wob);
  const breathe: N = sin(t.mul(B.rate)).mul(B.breathe).add(1);
  const by: N = y.sub(B.y), bodyTall: N = mix(float(B.down), float(B.up).mul(breathe), step(0, by));
  let heat: N = blob(x.div(B.w).mul(x.div(B.w)).add(by.div(bodyTall).mul(by.div(bodyTall))));
  const hy: N = y.sub(FLAME.heart.y);
  heat = heat.add(blob(x.mul(x).add(hy.mul(hy)).div(FLAME.heart.r ** 2)).mul(FLAME.heart.weight));
  for (let i = 0; i < T.count; i++) {
    // its own clock: a life runs 0..1, and every life has its own place, height and size
    const u: N = t.mul(T.rate[0] + ((T.rate[1] - T.rate[0]) * i) / (T.count - 1)).add(i * 0.618);
    const k: N = fract(u), life: N = floor(u);
    const h: N = hash22(vec2(life, seed.add(i * 7.31))), h2: N = hash21(vec2(life.add(17.3), seed.add(i * 3.7)));
    const alive: N = step(T.rest, h2);
    const cx: N = h.x.sub(0.5).mul(2 * T.spread).mul(float(1).sub(k.mul(T.gather)));
    const cy: N = mix(float(T.foot), mix(float(T.top[0]), float(T.top[1]), h.y), pow(k, 1.2));
    // it swells as it leaves the foot and thins away as it climbs: at the end of its life it is gone
    const r: N = mix(float(T.r[0]), float(T.r[1]), fract(h2.mul(7.9))).mul(smoothstep(0, 0.2, k)).mul(pow(float(1).sub(k), 0.5)).mul(alive).add(1e-3);
    const dy: N = y.sub(cy), above: N = step(0, dy);
    const dx: N = x.sub(cx).mul(max(dy, 0).mul(T.taper).div(r).add(1));
    const tall: N = r.mul(mix(float(T.long[0]), float(T.long[1]), above));
    heat = heat.add(blob(dx.div(r).mul(dx.div(r)).add(dy.div(tall).mul(dy.div(tall)))).mul(alive));
  }
  heat = heat.mul(float(1).sub(y.div(top).mul(FLAME.cool)));
  const P = FLAME.pulse;
  const pulse: N = sin(t.mul(P.rates[0])).mul(0.6).add(sin(t.mul(P.rates[1]).add(2.1)).mul(0.4)).mul(0.5).add(0.5);
  const bright: N = float(1).sub(pulse.mul(P.depth));
  // bands, not a ramp: each is brighter and hides more than the one round it
  let fire: N = vec4(0, 0, 0, 0);
  for (const [from, colour, add, hide] of FLAME.bands) fire = mix(fire, vec4(rgb(colour).mul(add), hide), step(from, heat));
  fire = fire.mul(bright);
  const S = FLAME.sparks;
  for (let j = 0; j < S.count; j++) {
    const u: N = t.mul(S.rate).add(j / S.count), k: N = fract(u), life: N = floor(u);
    const h: N = hash22(vec2(life, seed.add(31.7 + j * 5.3)));
    const sx: N = h.x.sub(0.5).mul(1.6).add(sin(k.mul(9).add(life)).mul(0.25)), sy: N = mix(float(S.from), float(S.to), k);
    const on: N = step(length(vec2(x.sub(sx), y.sub(sy))), S.r).mul(step(S.rest, h.y)).mul(float(1).sub(k));
    fire = fire.add(vec4(rgb(S.colour).mul(on), 0));
  }
  // the halo: the glow pass's falloff (materials.ts `glowMaterial`), swinging with the flame's pulse
  const g: N = max(float(1).sub(length(f.xy)), 0);
  const H = FLAME.halo;
  const glow: N = rgb(H.colour).mul(g.mul(g).mul(g)).mul(float(H.strength).mul(float(1).sub(pulse.mul(H.swing))));
  const out: N = mix(fire, vec4(glow, 0), halo);
  // Added light gets no `sight.apply` (it would add the dark's or the mist's colour over the whole quads): like a glow it is only
  // dimmed and hidden, as scenery (the mist does not hide it).
  const u: N = sight.unseenAt(attribute('foot', 'vec4').xy), shown: N = sight.shown(u.x, 1);
  m.colorNode = vec4(sight.dim(out.xyz, u.y).mul(shown), out.w.mul(shown));
  // rgb is added whole and the alpha only says how much of the picture behind is hidden; the target's own alpha is left alone
  m.transparent = true;
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = ZeroFactor;
  m.blendDstAlpha = OneFactor;
  m.depthWrite = false;
  m.forceSinglePass = true;
  m.side = DoubleSide;
  return { material: m, time };
}

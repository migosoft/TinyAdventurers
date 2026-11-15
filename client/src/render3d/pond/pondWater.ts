// Spike (#348): the water of the ?r3d=pond page, one flat sheet over the map just above the ground. The shader draws everything of the
// water itself: the bed seen through clear water (found by following the view ray down to the field's depth, so it shifts with yaw and
// pitch like a real dip), the absorption by depth, fish as dark shapes over the bed, calm waves, the stream's current, ripple rings,
// the sky's reflection and the sun's glints. After the design of #345, with the sky in place of the dungeon's ceiling.
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DataTexture, LinearFilter, Mesh, MeshBasicNodeMaterial, NoColorSpace, RGBAFormat, UnsignedByteType, Vector3, Vector4 } from 'three/webgpu';
import { Fn, abs, clamp, cos, dot, exp, float, floor, fract, length, max, mix, normalize, positionWorld, pow, reflect, sin, smoothstep, texture, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { DEPTH_MAX, INSIDE_SPAN, POND_H, POND_W, fieldBytes } from './pondShape';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The sheet's height over the ground (tiles): above the painted ground, below what lies flat (cards.ts LIE_Y 0.02). */
export const WATER_Y = 0.012;
export const RIPPLES = 12;
export const FISH = 14;
/** How deep the fish swim (tiles). */
export const FISH_DEPTH = 0.32;
/** A ring's speed (tiles/s) and life (s), as in #345's design. */
export const RING = { speed: 0.75, life: 3 } as const;
/** Apparent depth over real depth for the view ray under the surface (refraction). */
const REFRACT = 0.75;
/** Absorption per tile of path through the water: red goes first (#345). */
const ABSORB: [number, number, number] = [0.5, 0.17, 0.13];

// A hash without sine (Dave Hoskins): the sine hash drew squares on the NVIDIA card (#324's gotchas).
const hash12 = Fn(([p]: N[]) => {
  const p3: N = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, vec3(p3.y, p3.z, p3.x).add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});
const vnoise = Fn(([p]: N[]) => {
  const i: N = floor(p);
  const f0: N = fract(p);
  const f: N = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
  return mix(mix(hash12(i), hash12(i.add(vec2(1, 0))), f.x), mix(hash12(i.add(vec2(0, 1))), hash12(i.add(vec2(1, 1))), f.x), f.y);
});

/** 1 below `a`, 0 above `b` (a < b): a falling smoothstep (GLSL leaves reversed edges undefined). */
const fall = (a: number, b: number, x: N): N => float(1).sub(smoothstep(a, b, x));

export interface PondWater {
  mesh: Mesh;
  /** Per frame: the time (s), the unit vector toward the camera, the sky's colours. */
  set(f: { t: number; toward: [number, number, number]; zenith: [number, number, number]; horizon: [number, number, number] }): void;
  /** A ring starting now at (x, z), `strength` about 0.3 (a fish) to 1 (a frog's dive). */
  ripple(x: number, z: number, strength: number): void;
  /** Fish `i`: its place and heading (radians, 0 = east). */
  fish(i: number, x: number, z: number, heading: number): void;
}

export function makePondWater(k: { lighting: Lighting; sight: Sight }): PondWater {
  const fb = fieldBytes();
  const field = new DataTexture(fb.data, fb.w, fb.h, RGBAFormat, UnsignedByteType);
  field.colorSpace = NoColorSpace;
  field.magFilter = LinearFilter;
  field.minFilter = LinearFilter;
  field.wrapS = ClampToEdgeWrapping;
  field.wrapT = ClampToEdgeWrapping;
  field.generateMipmaps = false;
  field.flipY = false;
  field.needsUpdate = true;

  const uT = uniform(0);
  const uV = uniform(new Vector3(0, 0.75, 0.66));
  const uZenith = uniform(new Vector3(0.3, 0.5, 0.8));
  const uHorizon = uniform(new Vector3(0.7, 0.8, 0.85));
  const rings = Array.from({ length: RIPPLES }, () => new Vector4(0, 0, -100, 0));
  const uRings = uniformArray(rings, 'vec4');
  const fishes = Array.from({ length: FISH }, () => new Vector4(-100, -100, 1, 0));
  const uFish = uniformArray(fishes, 'vec4');
  let nextRing = 0;
  let now = 0;

  const fieldAt = (q: N): N => texture(field, q.div(vec2(POND_W, POND_H)));

  const P: N = positionWorld;
  const p: N = P.xz;
  const f0: N = fieldAt(p);
  const insideV: N = f0.g.sub(0.5).mul(INSIDE_SPAN);
  const flow: N = f0.zw.sub(0.5).mul(2);
  const flowAmt: N = clamp(length(flow), 0, 1);

  // The surface's height (arbitrary units): two slow sines and a low noise (calm, large: busy waves read as "worms"), and on the
  // stream a finer noise carried by the current in two phases that cross-fade, so the pattern never stretches.
  const ph: N = fract(uT.mul(0.35));
  const ph2: N = fract(uT.mul(0.35).add(0.5));
  const wave = (q: N): N => {
    const calm = sin(q.x.mul(2.1).add(q.y.mul(1.3)).add(uT.mul(0.9))).mul(0.35)
      .add(sin(q.y.mul(2.6).sub(q.x.mul(1.2)).sub(uT.mul(0.7))).mul(0.3))
      .add(vnoise(q.mul(0.8).add(vec2(uT.mul(0.13), uT.mul(-0.09)))).mul(0.9));
    const a = vnoise(q.sub(flow.mul(ph.mul(2.4))).mul(3.4));
    const b = vnoise(q.sub(flow.mul(ph2.mul(2.4))).mul(3.4).add(vec2(5.2, 1.3)));
    const run = mix(a, b, abs(ph.mul(2).sub(1))).mul(2.2);
    return calm.mul(float(1).sub(flowAmt.mul(0.6))).add(run.mul(flowAmt));
  };
  // Pale streaks riding the current.
  const streakA: N = vnoise(p.sub(flow.mul(ph.mul(2.4))).mul(vec2(5, 5)).add(2.2));
  const streakB: N = vnoise(p.sub(flow.mul(ph2.mul(2.4))).mul(vec2(5, 5)).add(8.9));
  const streaks: N = smoothstep(0.66, 0.85, mix(streakA, streakB, abs(ph.mul(2).sub(1)))).mul(flowAmt);
  const E = 0.06;
  const h0: N = wave(p);
  const hx: N = wave(p.add(vec2(E, 0)));
  const hz: N = wave(p.add(vec2(0, E)));
  let slope: N = vec2(hx.sub(h0), hz.sub(h0)).div(E).mul(0.022);
  // The rings: a travelling wave packet around each source; its slope leans the normal along the radius.
  let ringLight: N = float(0);
  for (let i = 0; i < RIPPLES; i++) {
    const r4: N = uRings.element(i);
    const d: N = p.sub(r4.xy);
    const dist: N = max(length(d), 1e-3);
    const age: N = uT.sub(r4.z);
    const x: N = dist.sub(age.mul(RING.speed));
    const env: N = exp(x.mul(x).mul(-22)).mul(r4.w).mul(clamp(float(1).sub(age.div(RING.life)), 0, 1)).mul(smoothstep(0, 0.15, age));
    slope = slope.add(d.div(dist).mul(cos(x.mul(20)).mul(env).mul(0.22)));
    ringLight = ringLight.add(max(sin(x.mul(20)), 0).mul(env));
  }
  const Nw: N = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));

  // Down the view ray to the bed: the depth is read where the ray lands, three rounds.
  const kxz: N = uV.xz.div(max(uV.y, 0.3)).mul(REFRACT);
  const bend: N = Nw.xz.mul(0.35);
  let depth: N = f0.r.mul(DEPTH_MAX);
  let q: N = p;
  for (let i = 0; i < 3; i++) {
    q = p.sub(kxz.mul(depth)).add(bend.mul(depth));
    depth = fieldAt(q).r.mul(DEPTH_MAX);
  }

  // The light: the sky's ambient and the sun with the trees' and clouds' shadows, read at the surface.
  const sunLit: N = k.lighting.sun.term(P, P, float(1));
  const sunDir: N = k.lighting.sun.dir;
  const amb: N = k.lighting.ambient;
  const light: N = vec3(amb).add(sunLit.mul(max(sunDir.y, 0)));

  // The bed: sand at the rim, mud further in, a few stones; faint moving light lines where it is shallow.
  const n1: N = vnoise(q.mul(3.1));
  const n2: N = vnoise(q.mul(9.0).add(3.7));
  const stones: N = smoothstep(0.74, 0.8, vnoise(q.mul(7.3).add(11.1))).mul(fall(0.25, 0.7, depth));
  let bed: N = mix(vec3(0.5, 0.42, 0.27), vec3(0.2, 0.19, 0.11), smoothstep(0.08, 0.6, depth)).mul(n1.mul(0.35).add(0.75)).mul(n2.mul(0.2).add(0.9));
  bed = mix(bed, vec3(0.3, 0.3, 0.29).mul(n2.mul(0.5).add(0.6)), stones.mul(0.6));
  const ca: N = vnoise(q.mul(2.6).add(vec2(uT.mul(0.21), uT.mul(0.13))));
  const cb: N = vnoise(q.mul(2.6).add(vec2(uT.mul(-0.17), uT.mul(0.19))).add(4.4));
  const caustic: N = fall(0, 0.1, abs(ca.sub(cb))).mul(fall(0.15, 1.3, depth)).mul(0.18);
  const path = (d: N): N => d.div(max(uV.y, 0.3));
  const through = (d: N): N => exp(vec3(...ABSORB).mul(path(d)).negate());
  const murk: N = vec3(0.03, 0.13, 0.14).mul(light);
  const tBed: N = through(depth);
  bed = bed.mul(mix(vec3(1, 1, 1), vec3(0.72, 0.93, 1), smoothstep(0, 0.3, depth)));
  let under: N = bed.mul(vec3(amb).add(sunLit.mul(max(sunDir.y, 0)).mul(caustic.add(1)))).mul(tBed).add(murk.mul(float(1).sub(tBed)));

  // The fish: dark bodies with a wagging tail at their own depth, only where the water is deeper than they swim.
  const qf: N = p.sub(kxz.mul(FISH_DEPTH)).add(bend.mul(FISH_DEPTH));
  let fishMask: N = float(0);
  for (let i = 0; i < FISH; i++) {
    const f4: N = uFish.element(i);
    const d: N = qf.sub(f4.xy);
    const len = 0.2 + 0.09 * ((i * 7) % 5) / 4; // half the body's length, tiles
    const lx: N = d.x.mul(f4.z).add(d.y.mul(f4.w));
    const wag: N = sin(lx.mul(11).add(uT.mul(9 + (i % 3))).add(i * 1.7)).mul(0.03).mul(fall(-len * 1.6, len * 0.6, lx));
    const ly: N = d.y.mul(f4.z).sub(d.x.mul(f4.w)).add(wag);
    const body: N = fall(0.7, 1, lx.div(len).mul(lx.div(len)).add(ly.div(len * 0.3).mul(ly.div(len * 0.3))));
    const tx: N = lx.add(len * 1.25);
    const tail: N = fall(0.6, 1, tx.div(len * 0.38).mul(tx.div(len * 0.38)).add(ly.div(len * 0.26).mul(ly.div(len * 0.26))));
    fishMask = max(fishMask, max(body, tail.mul(0.8)));
  }
  fishMask = fishMask.mul(smoothstep(FISH_DEPTH + 0.05, FISH_DEPTH + 0.3, depth));
  const tFish: N = through(float(FISH_DEPTH));
  under = mix(under, vec3(0.07, 0.075, 0.06).mul(light).mul(tFish).add(murk.mul(float(1).sub(tFish))), fishMask.mul(0.85));

  // The surface: the sky mirrored, more at a flat angle, and the sun's glints (a sharp lobe and a faint broad one).
  const R: N = reflect(uV.negate(), Nw);
  const skyCol: N = mix(vec3(uHorizon), vec3(uZenith), smoothstep(0.1, 0.9, R.y));
  const fres: N = pow(float(1).sub(clamp(dot(uV, Nw), 0, 1)), 5);
  const mirror: N = clamp(fres.mul(6).add(0.2), 0, 0.9);
  const sr: N = max(dot(R, sunDir), 0);
  const glint: N = sunLit.mul(pow(sr, 700).mul(2.5).add(pow(sr, 90).mul(0.12)));
  let water: N = mix(under, skyCol, mirror).add(glint).add(vec3(light).mul(ringLight.mul(0.1).add(streaks.mul(0.22))));

  // The edge: the water thins out onto the bank with a pale line, and the earth just outside is wet and darker.
  const wet: N = smoothstep(-0.55, -0.02, insideV.add(h0.mul(0.03)));
  const edge: N = smoothstep(0, 0.14, insideV.add(h0.mul(0.03)));
  water = water.add(vec3(light).mul(fall(0.03, 0.16, insideV).mul(0.08)));
  const colour: N = mix(vec3(0.1, 0.075, 0.045).mul(light), water, edge);
  const alpha: N = max(edge, wet.mul(0.5));

  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(k.sight.apply(colour, P, k.sight.unseenAt(p)), alpha);
  m.transparent = true;
  m.depthWrite = false;

  const g = new BufferGeometry();
  const y = WATER_Y, w = POND_W, h = POND_H;
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, y, 0, 0, y, h, w, y, 0, w, y, 0, 0, y, h, w, y, h]), 3));
  const mesh = new Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;

  return {
    mesh,
    set(f) {
      now = f.t;
      uT.value = f.t;
      (uV.value as Vector3).set(...f.toward);
      (uZenith.value as Vector3).set(...f.zenith);
      (uHorizon.value as Vector3).set(...f.horizon);
    },
    ripple(x, z, strength) {
      rings[nextRing].set(x, z, now, strength);
      nextRing = (nextRing + 1) % RIPPLES;
    },
    fish(i, x, z, heading) {
      if (i < FISH) fishes[i].set(x, z, Math.cos(heading), Math.sin(heading));
    },
  };
}

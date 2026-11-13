// The sun in the light of the 3D view (#306): the shadow-map lookup, the cloud shadow and the camera of the sun's pass, in TSL.
// The maths of the fit is sun.ts's; the lookup here uses `sunCoord`'s formula.
import { DepthTexture, LessEqualCompare, LinearFilter, OrthographicCamera, Vector2, Vector3 } from 'three/webgpu';
import { Fn, clamp, dot, float, floor, fract, max, mix, sin, smoothstep, step, texture, uniform, vec2, vec3 } from 'three/tsl';
import type { SunFit, Vec3 } from './sun';
import type { SunFrame } from './view';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The shadow lookup's depth bias, in 0..1 of the map's depth range (the demo's value). */
export const SUN_BIAS = 0.0003;
/** The cloud layer: tiles above the ground, the noise scale (per tile) and how much faster than the wind the clouds drift. */
export const CLOUD = { layer: 14, scale: 0.065, drift: 2.4 * 0.065, darkest: 0.62 } as const;

export interface SunLight {
  /** The sun's light at P for a surface whose cosine term is ndl (vec3 node): colour * ndl * sunVis(Ps) * cloud(P); 0 while off. */
  term(P: N, Ps: N, ndl: N): N;
  /** Uniforms: `dir` toward the light, `right` the camera's right on the ground (a vec3, y 0); the view sets `right` each frame. */
  readonly dir: N;
  /** The light's colour (a vec3 uniform; black while no sun is set). */
  readonly colour: N;
  readonly right: N;
  /** Takes the frame's sun (null: off, the term is 0), the depth texture of its pass and whether the lookup flips v. */
  set(s: SunFrame | null, depth: DepthTexture, flipY: boolean): void;
}

/** A depth texture the lookup can compare against (also the stand-in until the first pass). */
export function sunDepthTexture(size: number): DepthTexture {
  const d = new DepthTexture(size, size);
  d.compareFunction = LessEqualCompare;
  d.minFilter = LinearFilter;
  d.magFilter = LinearFilter;
  return d;
}

/** The sun's camera: at C - F * ext[2], looking along F, up U, so that a point's NDC is (2u - 1, 2v - 1) and its depth `sunCoord`'s. */
export function sunCamera(fit: SunFit, into: OrthographicCamera = new OrthographicCamera()): OrthographicCamera {
  const [e0, e1, e2] = fit.ext;
  const cam = into;
  cam.left = -e0;
  cam.right = e0;
  cam.top = e1;
  cam.bottom = -e1;
  cam.near = 0;
  cam.far = 2 * e2;
  const at = (k: number): Vec3 => [fit.C[0] + fit.F[0] * k, fit.C[1] + fit.F[1] * k, fit.C[2] + fit.F[2] * k];
  const from = at(-e2);
  cam.position.set(...from);
  cam.up.set(...fit.U);
  cam.lookAt(...at(0));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const h21 = Fn(([p]: N[]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const vnoise = Fn(([p]: N[]) => {
  const i: N = floor(p);
  const f0: N = fract(p);
  const f: N = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
  return mix(mix(h21(i), h21(i.add(vec2(1, 0))), f.x), mix(h21(i.add(vec2(0, 1))), h21(i.add(vec2(1, 1))), f.x), f.y);
});

export function makeSunLight(): SunLight {
  const uColour = uniform(new Vector3());
  const uDir = uniform(new Vector3(0, 1, 0));
  const uRight = uniform(new Vector3(1, 0, 0));
  const uC = uniform(new Vector3());
  const uR = uniform(new Vector3(1, 0, 0));
  const uU = uniform(new Vector3(0, 1, 0));
  const uF = uniform(new Vector3(0, 0, 1));
  const uExt = uniform(new Vector3(1, 1, 1));
  const uFlip = uniform(0);
  const uShadows = uniform(0);
  const uClouds = uniform(0);
  const uDrift = uniform(new Vector2());
  const depthNode = texture(sunDepthTexture(1));

  const sunVis = (Ps: N): N => {
    const d = Ps.sub(uC);
    const u = dot(d, uR).div(uExt.x.mul(2)).add(0.5);
    const v0 = dot(d, uU).div(uExt.y.mul(2)).add(0.5);
    // v grows with U; the render target's rows run the other way round in the lookup (see `set`'s flipY).
    const v = v0.add(uFlip.mul(float(1).sub(v0.mul(2))));
    const depth = dot(d, uF).div(uExt.z.mul(2)).add(0.5);
    // Arithmetic, not a branch: the depth texture is sampled once, in uniform control flow, whatever the point.
    const inside = step(0, u).mul(step(u, 1)).mul(step(0, v)).mul(step(v, 1));
    const lit = depthNode.sample(clamp(vec2(u, v), 0, 1)).compare(depth.sub(SUN_BIAS));
    const open = mix(float(1), lit, inside);
    return mix(float(1), open, uShadows);
  };

  // Cloud shadow: the noise is read where the sun ray through P meets a cloud layer high up, so air and ground agree.
  const cloud = (P: N): N => {
    const q = P.xz.add(uDir.xz.div(max(uDir.y, 0.2)).mul(float(CLOUD.layer).sub(P.y))).mul(CLOUD.scale).sub(uDrift);
    const n = vnoise(q).mul(0.65).add(vnoise(q.mul(2.3).add(7.1)).mul(0.35));
    const c = float(1).sub(float(CLOUD.darkest).mul(smoothstep(0.47, 0.66, n)));
    return mix(float(1), c, uClouds);
  };

  return {
    dir: uDir,
    colour: uColour,
    right: uRight,
    term: (P, Ps, ndl) => vec3(uColour).mul(float(ndl)).mul(sunVis(Ps)).mul(cloud(P)),
    set(s, depth, flipY) {
      depthNode.value = depth;
      if (!s) {
        (uColour.value as Vector3).set(0, 0, 0);
        return;
      }
      (uColour.value as Vector3).set(...s.colour);
      (uDir.value as Vector3).set(...s.dir);
      const f = s.fit;
      (uC.value as Vector3).set(...f.C);
      (uR.value as Vector3).set(...f.R);
      (uU.value as Vector3).set(...f.U);
      (uF.value as Vector3).set(...f.F);
      (uExt.value as Vector3).set(...f.ext);
      uFlip.value = flipY ? 1 : 0;
      uShadows.value = s.shadows ? 1 : 0;
      uClouds.value = s.clouds ? 1 : 0;
      (uDrift.value as Vector2).set(s.wind[0] * s.t * CLOUD.drift, s.wind[1] * s.t * CLOUD.drift);
    },
  };
}

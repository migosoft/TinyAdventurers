// The air's materials in TSL (#307): specks and embers (additive), smoke, rings and drops (blended), and the haze sheets. The quads are
// camera-facing (rings flat on the water), built from `airQuads.ts`'s attributes; every material ends with the sight step.
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { Fn, attribute, float, length, max, min, mix, mx_noise_float, positionWorld, select, smoothstep, step, uniform, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import { CARD_BIAS, type ViewToward } from '../materials';
import type { Sight } from '../sightNodes';
import { PX } from './airCtx';
import { RING_PAD } from './airQuads';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The haze's colour (the 2D tint 0x8a7c6c) and how bright the light it takes from the scene is (first guess: the demo's wrap of 0.35). */
const HAZE_RGB: [number, number, number] = [0x8a / 255, 0x7c / 255, 0x6c / 255];
const HAZE_WRAP = 0.35;
/** The smoke blob, the haze texture's size (art px) and the haze's noise mapping (first guesses for the 2D blob texture). */
const HAZE_TEX_PX = 128;
const HAZE_LO = 0.2, HAZE_HI = 0.8;
/** Dust brightens with its light: full at 1 / DUST_GAIN of the scene's light above the ambient. */
const DUST_GAIN = 1.3;
/** The haze sheets draw in front of the blended air and behind the additive. */
export const AIR_ORDER = { haze: 3.4, blend: 3.5, add: 4.5 } as const;

export interface AirMaterials {
  add: MeshBasicNodeMaterial;
  blend: MeshBasicNodeMaterial;
  haze: MeshBasicNodeMaterial;
  /** The camera's right and up as unit vectors in world space (the quads spread along them); set by the view each frame. */
  right: N;
  up: N;
  /** Seconds, for the haze's drift. */
  time: N;
}

export function airMaterials(lighting: Lighting, sight: Sight, opts: { sun: boolean; toward: ViewToward }): AirMaterials {
  const right = uniform(new Vector3(1, 0, 0));
  const up = uniform(new Vector3(0, 1, 0));
  const time = uniform(0);

  // Vertex stage, shared by both air meshes.
  const centre: N = attribute('position', 'vec3');
  const corner: N = attribute('corner', 'vec2');
  const size: N = attribute('size', 'vec2');
  const kind: N = attribute('kind', 'float');
  const rgba: N = attribute('rgba', 'vec4');
  const sightXZ: N = attribute('sightXZ', 'vec2');
  const half = size.mul(0.5);
  const facing = centre.add(right.mul(corner.x.mul(half.x))).add(up.mul(corner.y.mul(half.y)));
  const flat = centre.add(vec3(corner.x.mul(half.x), 0, corner.y.mul(half.y)));
  const isRing = kind.greaterThan(2.5).and(kind.lessThan(3.5));
  const position = select(isRing, flat, facing).add(opts.toward.mul(CARD_BIAS));

  const a: N = rgba.a;
  const sunAt = opts.sun ? { Ps: centre, ndl: float(1) } : undefined;

  // The shading of the two air meshes is one function each: the sight mask is read first, in the function's own body (so at the top level of
  // the shader: the selects further down may compile to branches), the point's own xz unless the quad brings one (puffs).
  const litAt = (): N => lighting.lightAt(centre, vec3(0, 0, 0), 1, { sun: sunAt });

  // Additive: a speck is the scene's light minus the ambient, tinted halfway to white (`dustTint`); an ember is its own colour.
  const add = new MeshBasicNodeMaterial();
  {
    add.positionNode = position;
    add.colorNode = Fn(() => {
      const u: N = sight.unseenAt(sightXZ);
      const shown: N = sight.shown(u.x, 0);
      const lit: N = litAt();
      const l: N = max(lit.rgb.sub(lighting.ambient), 0);
      const b = max(l.r, max(l.g, l.b));
      const tint = l.div(max(b, 1e-4)).add(1).mul(0.5);
      const dust = tint.mul(a).mul(min(float(1), b.mul(DUST_GAIN))).mul(shown);
      const ember = rgba.rgb.mul(a).mul(shown);
      // Arithmetic, not a select: a select on a varying compiles to a branch, and the sight mask would be read inside it.
      const out: N = mix(ember, dust, step(kind, 0.5));
      return vec4(out, 1);
    })();
    add.transparent = true;
    add.blending = AdditiveBlending;
    add.depthWrite = false;
    add.forceSinglePass = true;
    add.side = DoubleSide;
  }

  // Blended: smoke is the 2D smoke blob, lit; a ring is a one-art-pixel line at its radius; a drop and a splash pixel are solid.
  const blend = new MeshBasicNodeMaterial();
  {
    blend.positionNode = position;
    blend.colorNode = Fn(() => {
      const u: N = sight.unseenAt(sightXZ);
      const shown: N = sight.shown(u.x, 0);
      const lit: N = litAt();
      const r = length(corner);
      // 1 at the centre, 0.45 at half the radius, 0 at the edge (the 2D smoke texture's gradient).
      const smoke = max(mix(float(1).sub(r.mul(1.1)), float(1).sub(r).mul(0.9), step(0.5, r)), 0);
      const reach = half.x;
      const line = step(reach.mul(r).sub(reach.sub(RING_PAD)).abs(), 0.5 * PX);
      const shape = mix(mix(float(1), line, step(2.5, kind).mul(step(kind, 3.5))), smoke, step(kind, 2.5));
      const alpha = shape.mul(a).mul(shown);
      const colour = sight.apply(lighting.finish(rgba.rgb, lit), centre, u);
      return vec4(colour, alpha);
    })();
    blend.transparent = true;
    blend.depthWrite = false;
    blend.forceSinglePass = true;
    blend.side = DoubleSide;
  }

  // The haze: two flat noise sheets, lit from above, hidden behind walls and figures by the depth test.
  const haze = new MeshBasicNodeMaterial();
  {
    const P: N = positionWorld;
    const sheet: N = attribute('sheet', 'vec4');
    haze.colorNode = Fn(() => {
      const hu: N = sight.unseenAt(P.xz);
      const scale = float(HAZE_TEX_PX).mul(sheet.y);
      const xz = P.xz.mul(1 / PX).div(scale).add(sheet.zw.mul(time).div(scale));
      const n = mx_noise_float(vec3(xz.x, xz.y, 0));
      const pattern = smoothstep(HAZE_LO, HAZE_HI, n.mul(0.5).add(0.5));
      const hl: N = lighting.lightAt(P, vec3(0, 1, 0), HAZE_WRAP, { noShadow: true });
      const colour = sight.apply(vec3(...HAZE_RGB).mul(hl.rgb), P, hu);
      return vec4(colour, sheet.x.mul(pattern).mul(sight.shown(hu.x, 0)));
    })();
    haze.transparent = true;
    haze.depthWrite = false;
    haze.forceSinglePass = true;
    haze.side = DoubleSide;
  }

  add.name = 'air add';
  blend.name = 'air blend';
  haze.name = 'air haze';
  return { add, blend, haze, right, up, time };
}

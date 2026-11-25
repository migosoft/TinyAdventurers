// The wooden bridges' materials (#360). The wood is the piece's own tone (bridge.ts) with a grain painted in art pixels along it, lit as
// the world is: the sun through its shadow map (trees and figures shade a bridge, and a bridge its own beams), the sky's ambient and
// whatever point lights are near; then the sight step at its own point, as the ground has it. The caster draws the same geometry into
// the sun's pass, depth only.
import { DoubleSide, MeshBasicNodeMaterial, type NodeMaterial } from 'three/webgpu';
import { attribute, float, floor, max, mix, positionWorld, smoothstep, step, vec2, vec4 } from 'three/tsl';
import { WATER_LEVEL } from '../dips/shape';
import type { Lighting } from '../lightNodes';
import { hash21, vnoise2 } from '../noiseNodes';
import type { Sight } from '../sightNodes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The light's wrap round the flat faces: a side turned from the sun is not black. */
const WRAP = 0.3;
/**
 * The grain, in art pixels (16 a tile) on the piece's own face: streaks this long (the inverse) and this narrow along the wood, cut
 * into `levels` tones from `dark` to `light` (shares of the piece's tone); and specks (knots, dirt): this share of the pixels, this dark.
 */
const GRAIN = { long: 0.16, across: 0.8, levels: 3, dark: 0.8, light: 1.08, specks: 0.035, speck: 0.68 } as const;
/** Wood that stands in the water is this much darker (share of its tone), from a little above the water's level down. */
const WET = 0.6, WET_ABOVE = 0.07;
/** The shadow map is read this far off the face (tiles), as the world's ground reads it. */
const SUN_OFF = 0.03;

export function bridgeMaterial(lighting: Lighting, sight: Sight): NodeMaterial {
  const P: N = positionWorld, n: N = attribute('normal', 'vec3'), g: N = attribute('grain', 'vec3');
  const cell: N = floor(g.xy.mul(16));
  const streak: N = vnoise2(vec2(cell.x.mul(GRAIN.long).add(g.z), cell.y.mul(GRAIN.across).add(g.z.mul(7.7))));
  const level: N = floor(streak.mul(GRAIN.levels)).div(GRAIN.levels - 1).min(1);
  const speck: N = step(hash21(cell.add(g.z.mul(3.1))), GRAIN.specks);
  const wet: N = mix(float(WET), float(1), smoothstep(WATER_LEVEL, WATER_LEVEL + WET_ABOVE, P.y));
  const albedo: N = attribute('colour', 'vec3').mul(mix(float(GRAIN.dark), float(GRAIN.light), level)).mul(mix(float(1), float(GRAIN.speck), speck)).mul(wet);
  // every triangle has its own three vertices with its own normal (bridge.ts): flat faces
  const sun = lighting.sun;
  const lit = lighting.lightAt(P, n, WRAP, { sun: { Ps: P.add(n.mul(SUN_OFF)), ndl: mix(max(n.dot(sun.dir), 0), float(1), WRAP) } });
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sight.apply(lighting.finish(albedo, lit), P, sight.unseenAt(P.xz)), 1);
  return m;
}

/** The bridges in the sun's pass: depth only, both sides (a thin plank shades from either). */
export function bridgeCasterMaterial(): NodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.colorWrite = false;
  m.side = DoubleSide;
  return m;
}

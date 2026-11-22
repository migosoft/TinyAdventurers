// The crystals' material (#380 part 2): a gem lit by the game's lights like any world object, plus its own glow, weighted per vertex
// (crystals.ts: bright tips and edges, a darker body) and pulsing slowly in step with its light. The glow is on the crystal only: it is
// no light, so a small or broken cluster lights nothing round it. Ends with the sight step.
import { MeshBasicNodeMaterial, type NodeMaterial } from 'three/webgpu';
import { attribute, dot, float, floor, max, mix, positionWorld, sin, uniform, varying, vec3, vec4 } from 'three/tsl';
import { LIGHT, LIGHT_KIND } from '../../generated/defs';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { CRYSTAL_RATE } from './crystals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/**
 * The gem's look (first guesses): `body` the lit colour's share of the crystal colour, `wrap` the light's wrap round the facets,
 * `glow` the self-glow at weight 1, `steps` its palette steps, `hot` how far the brightest step whitens, `pulse` the glow's swing,
 * `sat` the saturation against the light's own pale colour (1: the same) and how far a cluster's tint adds to it.
 */
export const GEM = { body: 0.6, wrap: 0.35, glow: 1.1, steps: 5, hot: 0.35, pulse: 0.16, sat: [1.25, 0.35] } as const;

export function crystalMaterial(lighting: Lighting, sight: Sight): { material: NodeMaterial; time: { value: number } } {
  const time = uniform(0);
  const P: N = positionWorld;
  const normal: N = varying(attribute('normal', 'vec3'), 'gemNormal').setInterpolation('flat');
  const gem: N = attribute('gem', 'vec3');
  const c = LIGHT[LIGHT_KIND.Crystal].colour;
  const base = vec3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
  // one colour, a little more or less saturated per cluster
  const grey = vec3(dot(base, vec3(0.3, 0.55, 0.15)));
  const colour: N = max(mix(grey, base, float(GEM.sat[0]).add(gem.y.mul(GEM.sat[1]))), 0);
  const lit = lighting.lightAt(P, normal, GEM.wrap);
  const pulse = float(1).add(sin(time.mul(CRYSTAL_RATE).add(gem.z)).mul(GEM.pulse));
  // palette steps, not a ramp
  const g: N = floor(gem.x.mul(pulse).mul(GEM.steps).add(0.5)).div(GEM.steps);
  const glow = mix(colour, vec3(1), g.mul(g).mul(GEM.hot)).mul(g).mul(GEM.glow);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sight.apply(lighting.finish(colour.mul(GEM.body), lit).add(glow), P, sight.unseenAt(attribute('foot', 'vec2'))), 1);
  return { material: m, time };
}

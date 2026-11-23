// The wall torch's two materials (#391). The holder is iron and wood lit by the game's lights like any world object. The flame is lit by
// nothing: opaque geometry (torch.ts) coloured in palette steps by its heat and moved in the vertex shader, the same at every quality.
// Both end with the sight step, read on the floor in front of the wall (`foot`).
import { MeshBasicNodeMaterial, type NodeMaterial } from 'three/webgpu';
import { attribute, cos, dot, float, mix, positionLocal, positionWorld, sin, step, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { FLAME_H } from './torch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The light's wrap round the holder's flat faces: iron in a dark hall still shows its shape. */
const HOLDER_WRAP = 0.35;

/**
 * The flame's look (first guesses). `steps`: the colours from the tips to the core (pack palette) and the heat each starts at; `flicker`:
 * how far the heat swings, so the steps' borders move. Motion, in tiles at the tip (it grows with the height share): `sway` the whole
 * flame leaning, `lick` a wave climbing it, `jitter` each vertex's own, `stretch` the height's share it grows and shrinks by.
 */
export const FLAME = {
  steps: [[0xd8442a, 0], [0xff8a2a, 0.22], [0xffd24a, 0.5], [0xfff2b0, 0.95]] as const,
  flicker: 0.1, sway: 0.03, lick: 0.022, jitter: 0.012, stretch: 0.16,
} as const;

/** No vertex of a flame is moved further than this (tiles): what a chunk's bounds are widened by. */
export const FLAME_REACH = FLAME.sway + 1.5 * (FLAME.lick + FLAME.jitter) + FLAME.stretch * FLAME_H;

const rgb =(c: number): N => vec3((c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);

export function holderMaterial(lighting: Lighting, sight: Sight): NodeMaterial {
  const P: N = positionWorld;
  // every triangle has its own three vertices with its own normal (torch.ts): flat faces
  const lit = lighting.lightAt(P, attribute('normal', 'vec3'), HOLDER_WRAP);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sight.apply(lighting.finish(attribute('colour', 'vec3'), lit), P, sight.unseenAt(attribute('foot', 'vec2'))), 1);
  return m;
}

export function flameMaterial(sight: Sight): { material: NodeMaterial; time: { value: number } } {
  const time = uniform(0);
  /** Height share, heat, phase. */
  const f: N = attribute('flame', 'vec3');
  const at: N = positionLocal, t: N = time.add(f.z), up: N = f.x;
  // two rates each, so no beat is seen; the foot stays in the basket
  const lean: N = up.mul(up.sqrt());
  const sway = vec2(sin(t.mul(5.3)).mul(0.6).add(sin(t.mul(9.1).add(1.3)).mul(0.4)), sin(t.mul(4.7).add(1.7)).mul(0.6).add(sin(t.mul(8.3)).mul(0.4))).mul(lean).mul(FLAME.sway);
  const wave: N = up.mul(9).sub(t.mul(11));
  const lick = vec2(sin(wave), cos(wave.mul(1.3))).mul(up).mul(FLAME.lick);
  // each vertex by its own place: the tongues move apart
  const own: N = dot(at.xz, vec2(91.7, 57.3)).add(at.y.mul(23.1));
  const jitter = vec2(sin(own.add(t.mul(13))), cos(own.mul(1.7).add(t.mul(10.3)))).mul(up).mul(FLAME.jitter);
  const move: N = sway.add(lick).add(jitter);
  const grow: N = sin(t.mul(7.9)).mul(0.6).add(sin(t.mul(13.3).add(2.1)).mul(0.4)).mul(FLAME.stretch * FLAME_H).mul(up);
  const m = new MeshBasicNodeMaterial();
  m.positionNode = at.add(vec3(move.x, grow, move.y));
  // palette steps, not a ramp; their borders wander up and down with the flicker
  const heat: N = f.y.add(sin(t.mul(9.7).add(up.mul(7))).mul(FLAME.flicker).mul(float(1).sub(f.y)));
  let colour: N = rgb(FLAME.steps[0][0]);
  for (const [c, from] of FLAME.steps.slice(1)) colour = mix(colour, rgb(c), step(from, heat));
  const P: N = positionWorld;
  m.colorNode = vec4(sight.apply(colour, P, sight.unseenAt(attribute('foot', 'vec2'))), 1);
  return { material: m, time };
}

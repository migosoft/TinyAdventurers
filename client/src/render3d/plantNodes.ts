// The cove's small plants in TSL (#306): the atlas card with its sway, the sight step and the see-through.
// The geometry is plants.ts's: `position` holds the plant's foot (x, 0, z).
import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { attribute, float, positionGeometry, select, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from './lightNodes';
import type { Sight } from './sightNodes';
import type { SunLight } from './sunNodes';
import { CARD_BIAS, bayerAt, cardSunAt, seeOpenNode, type SeeUniforms, type ViewToward } from './materials';
import { swayNode } from './windNodes';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The uniforms every plant material of a view shares: the wind's switch and clock, and cos(pitch) for the cards' stretch. The view sets them each frame. */
export function makePlantShared() {
  return { t: uniform(0), on: uniform(0), cosP: uniform(1) };
}
export type PlantShared = ReturnType<typeof makePlantShared>;

/** The card's point (tiles) before the stretch: standing on its foot and swaying. */
function cardPoint(sun: SunLight, shared: PlantShared): N {
  const foot = positionGeometry.xz;
  const corner = attribute('corner', 'vec2');
  const sway = attribute('sway', 'vec2');
  return vec3(foot.x, 0, foot.y).add(sun.right.mul(corner.x)).add(vec3(0, corner.y, 0)).add(swayNode(foot, corner.y, sway.y, sway.x, shared.t, shared.on));
}

/**
 * An upright plant card of the atlas. Opaque with an alpha test. The picture is lit like a card (`cardSunAt`), then ends with the sight step;
 * the plant is scenery (misted, never hidden) and opens where the see-through mask has a disc.
 */
export function plantCardMaterial(
  tex: Texture, w: number, h: number, lighting: Lighting, toward: ViewToward, sight: Sight, see: SeeUniforms, maskTex: Texture, shared: PlantShared,
): MeshBasicNodeMaterial {
  const world = cardPoint(lighting.sun, shared);
  const m = new MeshBasicNodeMaterial();
  // The screen shows a card at its full sprite height: stretch by 1 / cos(pitch).
  m.positionNode = vec3(world.x, world.y.div(shared.cosP), world.z).add(toward.mul(CARD_BIAS));

  const truePos = varying(world, 'plantPos');
  const foot = varying(positionGeometry.xz, 'plantFoot');
  const texel = texture(tex, uv().div(vec2(w, h)));
  const unseen = sight.unseenAt(foot);
  const sunAt = cardSunAt(lighting.sun, truePos, foot);
  const lit = lighting.lightAt(truePos, vec3(0, 0, 0), 1, { sun: sunAt, selfFoot: foot });
  const colour = sight.apply(lighting.finish(texel.rgb, lit), truePos, unseen);
  const shown = sight.shown(unseen.x, 1);
  const open = seeOpenNode(maskTex, truePos, uv(), see);
  m.colorNode = vec4(colour, select(open, float(0), select(bayerAt().lessThan(shown), texel.a, float(0))));
  m.alphaTest = 0.5;
  m.side = DoubleSide;
  return m;
}

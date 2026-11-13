// The woodland's plants in TSL (#306): the card with its sway, the sight step and the see-through; the trunk caster and the clump discs of the sun's pass.
// The geometry is plants.ts's: `position` holds the plant's foot (x, 0, z) for a card or trunk and the world-fixed centre for a disc.
import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { atan, attribute, cross, float, length, max, normalize, positionGeometry, select, sin, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from './lightNodes';
import type { Sight } from './sightNodes';
import type { SunLight } from './sunNodes';
import { CARD_BIAS, bayerAt, cardSunAt, seeOpenNode, turnedToLight, type SeeUniforms, type ViewToward } from './materials';
import { ROOT_LIE } from './plants';
import { swayNode } from './windNodes';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The uniforms every plant material of a view shares: the wind's switch and clock, and cos(pitch) for the cards' stretch. The view sets them each frame. */
export function makePlantShared() {
  return { t: uniform(0), on: uniform(0), cosP: uniform(1) };
}
export type PlantShared = ReturnType<typeof makePlantShared>;

/** The disc's quad covers 1.2 times its radius; the lumpy edge stays inside (1 + 0.1 + 0.06 at most). */
const DISC_QUAD = 1.2;

/** The card's point (tiles) before the stretch: standing on its foot, swaying, or (`part` 1, the root decal) lying flat toward the camera. */
function cardPoint(sun: SunLight, shared: PlantShared): N {
  const foot = positionGeometry.xz;
  const corner = attribute('corner', 'vec2');
  const sway = attribute('sway', 'vec2');
  const part = attribute('part', 'float');
  const right = sun.right;
  // The ground direction toward the camera is across the camera's right.
  const flat = vec3(foot.x, ROOT_LIE, foot.y).add(right.mul(corner.x)).add(vec3(right.z.negate(), 0, right.x).mul(corner.y.abs()));
  const up = vec3(foot.x, 0, foot.y).add(right.mul(corner.x)).add(vec3(0, corner.y, 0)).add(swayNode(foot, corner.y, sway.y, sway.x, shared.t, shared.on));
  return select(part.greaterThan(0.5), flat, up);
}

/**
 * An upright plant card of one page (or the atlas, for the cove's plants). Opaque with an alpha test. The picture is lit like a card
 * (`cardSunAt`), then ends with the sight step; the plant is scenery (misted, never hidden) and opens where the see-through mask has a disc.
 */
export function plantCardMaterial(
  tex: Texture, w: number, h: number, lighting: Lighting, toward: ViewToward, sight: Sight, see: SeeUniforms, maskTex: Texture, shared: PlantShared,
): MeshBasicNodeMaterial {
  const world = cardPoint(lighting.sun, shared);
  const isDecal = attribute('part', 'float').greaterThan(0.5);
  const m = new MeshBasicNodeMaterial();
  // The screen shows a card at its full sprite height: stretch by 1 / cos(pitch). The root decal lies on the ground and keeps its length.
  m.positionNode = vec3(world.x, select(isDecal, world.y, world.y.div(shared.cosP)), world.z).add(toward.mul(CARD_BIAS));

  const truePos = varying(world, 'plantPos');
  const foot = varying(positionGeometry.xz, 'plantFoot');
  const texel = texture(tex, uv().div(vec2(w, h)));
  const unseen = sight.unseenAt(foot);
  // The root decal lies on the ground: it reads its own point (a hair up) with the ground's cosine term; the upright card the turned-to-the-light point.
  const upright = cardSunAt(lighting.sun, truePos, foot);
  const sunAt = {
    Ps: select(isDecal, (truePos as N).add(vec3(0, 0.03, 0)), upright.Ps),
    ndl: select(isDecal, max(lighting.sun.dir.y, 0), upright.ndl),
  };
  const lit = lighting.lightAt(truePos, vec3(0, 0, 0), 1, { sun: sunAt });
  const colour = sight.apply(lighting.finish(texel.rgb, lit), truePos, unseen);
  const shown = sight.shown(unseen.x, 1);
  const open = seeOpenNode(maskTex, truePos, uv(), see);
  m.colorNode = vec4(colour, select(open, float(0), select(bayerAt().lessThan(shown), texel.a, float(0))));
  m.alphaTest = 0.5;
  m.side = DoubleSide;
  return m;
}

/**
 * The trunk caster of one page in the sun's pass: the trunk's card turned to face the light about its foot, swaying at its height; depth only, alpha tested.
 * Plants are scenery, so there is no sight step: what the picture shows (all of it, in mist) casts.
 */
export function plantTrunkMaterial(tex: Texture, w: number, h: number, sun: SunLight, shared: PlantShared): MeshBasicNodeMaterial {
  const foot = positionGeometry.xz;
  const corner = attribute('corner', 'vec2');
  const sway = attribute('sway', 'vec2');
  const p = vec3(foot.x, 0, foot.y).add(sun.right.mul(corner.x)).add(vec3(0, corner.y, 0));
  const m = new MeshBasicNodeMaterial();
  m.positionNode = turnedToLight(sun, p, foot).add(swayNode(foot, corner.y, sway.y, sway.x, shared.t, shared.on));
  m.colorNode = vec4(0, 0, 0, texture(tex, uv().div(vec2(w, h))).a);
  m.alphaTest = 0.5;
  m.colorWrite = false;
  m.side = DoubleSide;
  return m;
}

/**
 * The clump discs in the sun's pass: a disc at its world point (plus the sway at its height) facing the light exactly, with the demo's lumpy edge
 * (`1 + 0.1 sin(3a + ph) + 0.06 sin(5a + 2ph)`). Depth only.
 */
export function plantDiscMaterial(sun: SunLight, shared: PlantShared): MeshBasicNodeMaterial {
  const corner = attribute('corner', 'vec2');
  const radius = attribute('radius', 'float');
  const phase = attribute('phase', 'float');
  const foot = attribute('foot', 'vec2');
  const sway = attribute('sway', 'vec2');
  const centre = positionGeometry;
  // The disc's plane is across the light: any two axes across it do (the edge's lumps only turn with them).
  const r = normalize(cross(vec3(0, 1, 0), sun.dir));
  const u = cross(sun.dir, r);
  const m = new MeshBasicNodeMaterial();
  m.positionNode = centre.add(swayNode(foot, centre.y, sway.y, sway.x, shared.t, shared.on)).add(r.mul(corner.x).add(u.mul(corner.y)).mul(radius.mul(DISC_QUAD)));
  const q = corner.mul(DISC_QUAD);
  const a = atan(q.y, q.x);
  const edge = float(1).add(sin(a.mul(3).add(phase)).mul(0.1)).add(sin(a.mul(5).add(phase.mul(2))).mul(0.06));
  m.colorNode = vec4(0, 0, 0, select(length(q).greaterThan(edge), float(0), float(1)));
  m.alphaTest = 0.5;
  m.colorWrite = false;
  m.side = DoubleSide;
  return m;
}

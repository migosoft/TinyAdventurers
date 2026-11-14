// The tree materials in TSL (#329): a depth pre-pass with the leaf cut-outs, a colour pass at equal depth, and the sun's shadow caster.
// All three build their point from one `treePoint`, so the sway, the leaf collapse and the patch spread cannot drift apart. The colour pass
// is lit by the scene's own light (`Lighting`, shadow map included) and ends with the sight step; the light's brightness picks the ramp step.
import { DoubleSide, EqualDepth, MeshBasicNodeMaterial } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { Fn, atan, attribute, cameraWorldMatrix, clamp, dot, float, floor, fract, length, log2, max, min, mix, normalize, positionGeometry, select, sin, step, texture, uniform, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { bayerAt, seeOpenNode, type SeeUniforms } from '../materials';
import { WIND_DIR } from '../wind';
import { gustNode, swayNode } from '../windNodes';
import { FLUTTER_PX, RAMP } from './mesh';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The light's brightness (`mid`: the brightness that sits on the ramp's middle; `gain`: ramp steps per doubling), the floor under which a tree darkens with the light, and the ramp steps. */
export const TREE_LIGHT = {
  mid: 0.7, // first guess
  gain: 0.8, // first guess
  floor: 0.12, // first guess
  steps: [-0.75, -0.3, 0.2, 0.6],
  barkSteps: [-0.5, 0, 0.55],
} as const;

/** Draw order of the pre-pass and the colour pass (set on the meshes by the view): ground, tree depth, everything else, tree colour. */
export const TREE_ORDER = { depth: -1, colour: 0.5 } as const;

/** Where a collapsed vertex goes: far below the ground, out of every view. */
const GONE = [0, -50, 0] as const;
/** The outer share of a patch's radius that counts as its rim (first guess), and the cell size of the light dabs in art pixels. */
const RIM_FROM = 0.8;
const DAB_CELL = 2.3;

/** The uniforms every tree material of a view shares; the view sets them each frame. `leafOverride` -1: none; `plain` 0 or 1: one flat colour per ramp. */
export function makeTreeShared() {
  return {
    t: uniform(0), windOn: uniform(0), cosP: uniform(1),
    leafOverride: uniform(-1).setName('treeLeafOverride'), plain: uniform(0),
  };
}
export type TreeShared = ReturnType<typeof makeTreeShared>;

export interface TreeMaterials {
  depth: MeshBasicNodeMaterial;
  colour: MeshBasicNodeMaterial;
  sun: MeshBasicNodeMaterial | null;
}

const hash3 = (c: N): N => fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));

/** The per-vertex streams of a tree mesh and the per-plant ones (`plant`: foot x, z, leaf amount, dead; `look`: leaf bright, leaf warm, bark light, bark grey). */
function streams() {
  const part = attribute('part', 'vec4');
  const plant = attribute('plant', 'vec4');
  const shape = part.y;
  return {
    normal: attribute('normal', 'vec3'), grad: attribute('grad', 'vec4'), sway: attribute('sway', 'vec2'),
    part, misc: attribute('misc', 'vec4'), tuft: attribute('tuft', 'vec4'), plant, look: attribute('look', 'vec4'),
    foot: plant.xy,
    isWood: shape.lessThan(1.5),
    isSkirt: shape.greaterThan(1.5).and(shape.lessThan(2.5)),
    isTuft: shape.greaterThan(2.5).and(shape.lessThan(3.5)),
    isBall: shape.greaterThan(2.5),
    isFoliage: shape.greaterThan(1.5),
    // The wood ramps (bark, dead wood) take the bark steps and tint; the leaf ramps the leaf ones.
    isBark: part.x.greaterThan(1.5),
  };
}
type Streams = ReturnType<typeof streams>;

/** The camera's right and up in the world: the axes a leaf patch spreads across (the sun's pass renders with the sun's camera, so the same nodes give the light's axes there). */
function cameraAxes(): { right: N; up: N } {
  return { right: cameraWorldMatrix.mul(vec4(1, 0, 0, 0)).xyz, up: cameraWorldMatrix.mul(vec4(0, 1, 0, 0)).xyz };
}

/** The leaf cut-outs of a patch: the ragged edge made of art-pixel cells from the patch's seed. `rho` is 1 at the patch's full radius. */
function patchCut(s: Streams) {
  const cell = floor(s.tuft.xy.mul(s.tuft.z.mul(16)));
  const rand: N = hash3(vec3(cell, s.tuft.w));
  const rho = length(cell.add(0.5)).div(max(s.tuft.z.mul(16), 0.01));
  return { cell, rand, rho, keep: rho.lessThan(float(0.5).add(rand.mul(0.5))) };
}

/** Whether a vertex with leaf `threshold` is gone at leaf amount `leaf`: its threshold is above the amount. A conifer's or bush's foliage has threshold 0 and stays at every amount. */
export function leafGone(threshold: N, leaf: N): N {
  return threshold.greaterThan(leaf);
}

/**
 * The one place a tree vertex's point is made, for the depth, colour and sun passes:
 * - `point`: the true point (tiles): the vertex swayed with its crown, plus the leaf patches' flutter, a patch spread across the camera's axes;
 * - `position`: that point lifted by `sway.y * (1 / cosP - 1)` (the card proportions) for the camera passes; light, sight and shadows read `point`;
 * - `sunPosition`: the point for the sun's pass (not lifted; a patch marked "casts no shadow" is gone);
 * - `gone`: foliage whose leaf threshold is above the plant's leaf amount (`leafGone`) collapses out of view in all three.
 */
export function treePoint(shared: TreeShared) {
  const s = streams();
  const dead = s.plant.w.greaterThan(0.5);
  const leaf = select(shared.leafOverride.greaterThanEqual(0).and(dead.not()), shared.leafOverride, s.plant.z);
  const gone = s.isFoliage.and(leafGone(s.misc.w, leaf));
  // A dead tree does not sway; a living one with no leaves does. The factor is the vertex's own (already scaled by height).
  const offset = swayNode(s.foot, float(1), float(1), select(dead, float(0), s.sway.x), shared.t, shared.windOn);
  const alongWind = vec3(WIND_DIR[0], 0, WIND_DIR[1]);
  const acrossWind = vec3(-WIND_DIR[1], 0, WIND_DIR[0]);
  const phase = s.tuft.w;
  const gust = gustNode(positionGeometry.xz, shared.t);
  // first guess: the flutter's rates (4.1, 3.3) and the phase spread (1.7)
  const flutter = alongWind.mul(sin(shared.t.mul(4.1).add(phase)))
    .add(acrossWind.mul(sin(shared.t.mul(3.3).add(phase.mul(1.7)))))
    .mul(gust.mul(FLUTTER_PX / 16)).mul(select(s.isTuft.and(dead.not()), shared.windOn, float(0)));
  const axes = cameraAxes();
  const spread = axes.right.mul(s.tuft.x.mul(s.tuft.z)).add(axes.up.mul(s.tuft.y.mul(s.tuft.z)));
  const point = positionGeometry.add(offset).add(flutter).add(spread);
  const lifted = point.add(vec3(0, s.sway.y.mul(float(1).div(shared.cosP).sub(1)), 0));
  const away = vec3(...GONE);
  return {
    point, offset, gone,
    position: select(gone, away, lifted),
    sunPosition: select(gone.or(s.isTuft.and(s.misc.y.greaterThan(0.5))), away, point),
  };
}
export type TreePoint = ReturnType<typeof treePoint>;

/** The palette texel of ramp `row` and step `level` (a 5 x 4 nearest texture, `paletteBytes`). */
const paletteAt = (palette: Texture, level: N, row: N): N => texture(palette, vec2(level.add(0.5).div(5), row.add(0.5).div(4))).rgb;

/**
 * The depth pre-pass, the colour pass and the sun's pass of a tree mesh. The meshes carry `position`, `normal`, `grad`, `sway`, `part`, `misc`,
 * `tuft` (mesh.ts) and `plant`, `look` per vertex. `hasSun` false (a dungeon): `sun` is null and the colour shader carries no sun code.
 * All three are double sided: a mirrored tree flips its patches' winding while their corners stay screen-space.
 */
export function treeMaterials(o: {
  lighting: Lighting; sight: Sight; see: SeeUniforms; mask: Texture; palette: Texture; shared: TreeShared; hasSun: boolean;
}): TreeMaterials {
  const { lighting, sight, see, mask, palette, shared, hasSun } = o;
  const s = streams();
  const p = treePoint(shared);
  const cut = patchCut(s);
  const truePos = varying(p.point, 'treePos');
  const foot = varying(s.foot, 'treeFoot');

  // ---------------------------------------------------------------- the depth pass
  const depth = new MeshBasicNodeMaterial();
  depth.positionNode = p.position;
  depth.colorNode = Fn(() => {
    const unseen = sight.unseenAt(foot);
    const stipple = bayerAt().lessThan(sight.shown(unseen.x, 1));
    // Foliage opens where the see-through mask has a disc; wood never does.
    const open = seeOpenNode(mask, truePos, vec2(truePos.x.add(truePos.z), truePos.y).mul(16), see).toVar('treeOpen');
    return vec4(0, 0, 0, select(s.isTuft.and(cut.keep.not()).or(stipple.not()).or(s.isFoliage.and(open)), float(0), float(1)));
  })();
  depth.alphaTest = 0.5;
  depth.colorWrite = false;
  depth.side = DoubleSide;

  // ---------------------------------------------------------------- the colour pass
  const colour = new MeshBasicNodeMaterial();
  colour.positionNode = p.position;
  // One function body: its variables are written in order at the top level, so the light (and its shadow-map and sight-mask reads) is built
  // once, before any of the selects below (a select with nodes in its arms compiles to a branch).
  colour.colorNode = Fn(() => {
    const axes = cameraAxes();
    const nRaw = normalize(s.normal);
    // The ball's direction, leaning outward across a patch; a skirt leans up a little.
    const tuftN = normalize(s.normal.add(axes.right.mul(s.tuft.x.mul(0.3))).add(axes.up.mul(s.tuft.y.mul(0.3))));
    const nForm: N = varying(normalize(select(s.isTuft, tuftN, select(s.isSkirt, s.normal.add(vec3(0, 0.4, 0)), s.normal))), 'treeNormal');
    const nl = normalize(nForm);
    const rest: N = varying(positionGeometry, 'treeRest');
    const off: N = varying(p.offset, 'treeSway');
    const cell = floor(rest.mul(16));
    const noise = select(s.isTuft, cut.rand, hash3(cell)).sub(0.5).mul(0.14);

    // The sun's shadow map is read at the art-pixel cell of the point (in the tree's swaying frame), a hair off the surface toward the light.
    const sunDir = lighting.sun.dir;
    const Ps = cell.add(0.5).div(16).add(off).add(nl.mul(0.05)).add(sunDir.mul(0.05)); // first guess: both nudges
    const ndl = mix(max(dot(nl, sunDir), 0), float(1), 0.3); // first guess: the wrap
    const unseen = sight.unseenAt(foot);
    const lit0 = lighting.lightAt(truePos, nl, 0.35, { sun: hasSun ? { Ps, ndl } : undefined, selfFoot: foot }); // first guess: wrap 0.35
    // Variables: the light is written once, where it is first read (the shadow map at the top level), and every later read reuses it.
    const lit = { rgb: lit0.rgb.toVar('treeLit'), dv: lit0.dv.toVar('treeDv') };
    const b = dot(lit.rgb, vec3(0.2126, 0.7152, 0.0722)).toVar('treeBright');

    // The main light's direction for the crown's form: the sun, or straight up without one.
    const ld: N = hasSun ? sunDir : vec3(0, 1, 0);
    const lp = ld.add(vec3(0, s.misc.x, 0));
    const fromLight = log2(max(b, 1e-4).div(TREE_LIGHT.mid)).mul(TREE_LIGHT.gain).toVar('treeStep');
    const crown = select(s.isBall, float(0.75), float(0.7)).mul(dot(nl, lp)).add(dot(s.grad.xyz, lp).mul(0.45)).add(s.grad.w).add(noise).sub(select(s.isBall, float(0.2), float(0)));
    // A patch's lit rim and its dark one: the rim cells against the light's direction on the screen.
    const rimDir = cut.cell.add(0.5).div(max(length(cut.cell.add(0.5)), 1e-4));
    const nd = dot(rimDir, vec2(dot(ld, axes.right), dot(ld, axes.up)));
    const rim = s.isTuft.and(cut.rho.greaterThan(RIM_FROM));
    const l: N = fromLight.add(crown).add(select(rim.and(nd.greaterThan(0.3)), float(0.6), float(0))); // first guess: the rim's lift
    const [s0, s1, s2, s3] = TREE_LIGHT.steps;
    let lvl: N = step(s0, l).add(step(s1, l)).add(step(s2, l)).add(step(s3, l));
    lvl = select(rim.and(nd.lessThan(-0.1)), float(0), lvl);
    // A skirt's hem is its darkest tone, the row above it at most the second.
    lvl = select(s.isSkirt.and(s.misc.y.greaterThan(0.9)), float(0), select(s.isSkirt.and(s.misc.y.greaterThan(0.8)), min(lvl, 1), lvl));
    const dab = hash3(floor(rest.mul(16 / DAB_CELL)).add(17)).lessThan(0.12).and(dot(nl, ld).greaterThan(0.15)).and(lvl.greaterThan(0.5)).and(fromLight.greaterThan(0));
    lvl = min(lvl.add(select(dab, float(1), float(0))), 4);

    // Bark: three steps by the light on the side, a step darker where the bark stands in shade, and wavy dashed lines on the trunk.
    const side = dot(nRaw, ld).add(noise.mul(0.5)).add(fromLight);
    let lb: N = step(TREE_LIGHT.barkSteps[0], side).add(step(TREE_LIGHT.barkSteps[1], side)).add(step(TREE_LIGHT.barkSteps[2], side));
    lb = lb.sub(select(s.misc.y.greaterThan(0.5).and(s.isWood), float(1), float(0)));
    const around = atan(nRaw.z, nRaw.x).mul(8 / (2 * Math.PI)).add(sin(rest.y.mul(9)).mul(0.1));
    const line = s.misc.z.greaterThan(0.5).and(fract(around).lessThan(0.22)).and(hash3(vec3(floor(around), floor(rest.y.mul(16 / 3)), 3)).greaterThan(0.4));
    lb = clamp(lb.add(select(line, select(side.greaterThan(0), float(1), float(-1)), float(0))), 0, 3);

    const level = select(shared.plain.greaterThan(0.5), float(2), select(s.isBark, lb, lvl));
    // A dead plant draws its bark ramp as dead wood.
    const row = s.part.x.add(select(s.plant.w.greaterThan(0.5).and(s.part.x.equal(RAMP.bark)), float(1), float(0)));
    const pal = paletteAt(palette, level, row).toVar('treePalette');
    // The plant's own colour: leaves lighter or darker and warmer or cooler (a patch adds its own shift); bark lighter or darker and greyer or more colourful.
    const bright = s.look.x.add(select(s.isTuft, s.part.w, float(0)));
    const warm = s.look.y.add(select(s.isTuft, s.part.z, float(0)));
    const leafTint = vec3(bright.mul(warm.add(1)), bright, bright.mul(float(1).sub(warm)));
    const grey = vec3(dot(pal, vec3(0.3, 0.59, 0.11)));
    const barkTint = mix(pal, grey, s.look.w).mul(s.look.z);
    const texel = select(shared.plain.greaterThan(0.5), pal, select(s.isBark, barkTint, pal.mul(leafTint)));
    // Above the floor the step decides and the light's colour tints it; below it the tree darkens with the light.
    const albedo = texel.div(max(b, TREE_LIGHT.floor));
    // Darkvision's grey is made from the texel itself: the rescale by the light belongs to the lit colour only.
    return vec4(sight.apply(lighting.finish(albedo, lit, texel), truePos, unseen), 1);
  })();
  // Patches lie many layers deep: the pre-pass keeps the winning depth, this pass shades only the pixel that won.
  colour.depthFunc = EqualDepth;
  colour.depthWrite = false;
  colour.side = DoubleSide;

  // ---------------------------------------------------------------- the sun's pass
  let sun: MeshBasicNodeMaterial | null = null;
  if (hasSun) {
    sun = new MeshBasicNodeMaterial();
    sun.positionNode = p.sunPosition;
    // The cut-outs of the depth pass without the stipple and the see-through: plants always cast, and the shadow does not change when foliage opens.
    sun.colorNode = vec4(0, 0, 0, select(s.isTuft.and(cut.keep.not()), float(0), float(1)));
    sun.alphaTest = 0.5;
    sun.colorWrite = false;
    sun.side = DoubleSide;
  }

  for (const m of [depth, colour, sun]) if (m) m.userData.treePoint = p;
  return { depth, colour, sun };
}

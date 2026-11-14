// The tree materials in TSL (#329): a depth pre-pass with the leaf cut-outs, a colour pass at equal depth, and the sun's shadow caster.
// All three build their point from one `treePoint`, so the sway, the leaf collapse and the patch spread cannot drift apart. The colour pass
// is lit by the scene's own light (`Lighting`, shadow map included) and ends with the sight step; the light's brightness picks the ramp step.
import { DoubleSide, EqualDepth, MeshBasicNodeMaterial } from 'three/webgpu';
import type { NodeBuilder } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { Fn, atan, attribute, cameraWorldMatrix, clamp, dot, float, floor, fract, length, log2, max, min, mix, mod, normalize, positionGeometry, select, sin, step, texture, uniform, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { bayerAt, seeOpenNode, type SeeUniforms } from '../materials';
import { WIND_DIR } from '../wind';
import { gustNode, swayNode } from '../windNodes';
import { FLUTTER_PX, RAMP } from './mesh';
import { GROUND, LEAF_DRIFT, LEAF_FADE, LEAF_FALL, LEAF_FLUTTER, LEAF_FLUTTER_RATE, LEAF_HALF, LEAF_LIE, LEAF_LIFE } from './leaves';

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

/**
 * Draw order of the pre-pass and the colour pass (set on the meshes by the view): the opaque world (ground, walls, figures: order 0), the tree depth,
 * the tree colour, then the translucent passes (shadows 1, decals and the force field 2, ghosts 3, glows 4). The depth pass comes after the ground,
 * so a pixel the colour pass misses shows the ground, never the clear colour. The falling leaves come after the tree colour.
 */
export const TREE_ORDER = { depth: 0.25, colour: 0.5, leaf: 0.6 } as const;

/** Where a collapsed vertex goes: far below the ground, out of every view. */
const GONE = [0, -50, 0] as const;
/** The cell size of the light dabs in art pixels. */
const DAB_CELL = 2.3;

/** The uniforms every tree material of a view shares; the view sets them each frame. `leafOverride` -1: none; `plain` 0 or 1: one flat colour per ramp; `leafRate`: the dev page's multiplier on how often leaves fall. */
export function makeTreeShared() {
  return {
    t: uniform(0), windOn: uniform(0), cosP: uniform(1),
    leafOverride: uniform(-1).setName('treeLeafOverride'), plain: uniform(0), leafRate: uniform(1),
  };
}
export type TreeShared = ReturnType<typeof makeTreeShared>;

export interface TreeMaterials {
  depth: MeshBasicNodeMaterial;
  colour: MeshBasicNodeMaterial;
  sun: MeshBasicNodeMaterial | null;
  /** The falling leaves: drawn with their own geometry (`leafGeometry`), after the tree colour pass. */
  leaf: MeshBasicNodeMaterial;
}

/** A material whose clip position is invariant (GLSL `invariant gl_Position`, WGSL `@invariant`): the depth pass and the colour pass are two programs with different varyings, and the colour pass tests at equal depth, so both must compute the very same position. */
class TreePassMaterial extends MeshBasicNodeMaterial {
  setup(builder: NodeBuilder): void {
    (builder.context as { invariant?: boolean }).invariant = true;
    super.setup(builder);
  }
}

const hash3 = (c: N): N => fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));

/**
 * A WebGPU pipeline takes 8 vertex buffers at most, so the tree geometry has exactly 8 attributes: `position`, `nrm`, `grad`, `part`, `misc`,
 * `tuft`, `plant`, `look`. This packs the two that carry the tree's sway: `nrm` is the normal with the vertex's sway factor in w, and `plant` is
 * (foot x, foot z, leaf amount or -1 for a dead tree, the vertex's lift height). `plant` is the forest's (foot x, z, leaf, dead) per vertex.
 */
export function packTreeStreams(normal: ArrayLike<number>, sway: ArrayLike<number>, plant: ArrayLike<number>): { nrm: Float32Array; plant: Float32Array } {
  const n = normal.length / 3;
  const nrm = new Float32Array(n * 4), out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    nrm[i * 4] = normal[i * 3]; nrm[i * 4 + 1] = normal[i * 3 + 1]; nrm[i * 4 + 2] = normal[i * 3 + 2]; nrm[i * 4 + 3] = sway[i * 2];
    out[i * 4] = plant[i * 4]; out[i * 4 + 1] = plant[i * 4 + 1];
    out[i * 4 + 2] = plant[i * 4 + 3] > 0.5 ? -1 : plant[i * 4 + 2];
    out[i * 4 + 3] = sway[i * 2 + 1];
  }
  return { nrm, plant: out };
}

/** The per-vertex streams of a tree mesh and the per-plant ones (`plant` and `nrm` as `packTreeStreams` says; `look`: leaf bright, leaf warm, bark light, bark grey). */
function streams() {
  const part = attribute('part', 'vec4');
  const plant = attribute('plant', 'vec4');
  const nrm = attribute('nrm', 'vec4');
  const shape = part.y;
  return {
    normal: nrm.xyz, grad: attribute('grad', 'vec4'), sway: vec2(nrm.w, plant.w),
    part, misc: attribute('misc', 'vec4'), tuft: attribute('tuft', 'vec4'), plant, look: attribute('look', 'vec4'),
    foot: plant.xy,
    dead: plant.z.lessThan(-0.5),
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
 * The leaf amount a plant has right now, from its `plant` stream's z (-1: a dead plant): the dev page's override replaces a living plant's own amount.
 * The tree's foliage and the falling leaves both gate on this one rule.
 */
export function plantLeaf(shared: TreeShared, plantZ: N): { dead: N; leaf: N } {
  const dead = plantZ.lessThan(-0.5);
  return { dead, leaf: select(shared.leafOverride.greaterThanEqual(0).and(dead.not()), shared.leafOverride, max(plantZ, 0)) };
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
  const { dead, leaf } = plantLeaf(shared, s.plant.z);
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
 * The light on a tree surface, for the crowns and the falling leaves alike: the scene's light at `P` with normal `nl`, the sun's shadow map read at
 * `Ps` (the caller's point nudged off the surface), and the light's brightness. Each is a variable so a later read reuses it; `name` makes their names.
 */
function treeLightAt(lighting: Lighting, hasSun: boolean, o: { P: N; Ps: N; nl: N; foot: N; name: string }): { lit: { rgb: N; dv: N }; b: N } {
  const ndl = mix(max(dot(o.nl, lighting.sun.dir), 0), float(1), 0.3); // first guess: the wrap
  const lit0 = lighting.lightAt(o.P, o.nl, 0.35, { sun: hasSun ? { Ps: o.Ps, ndl } : undefined, selfFoot: o.foot }); // first guess: wrap 0.35
  const lit = { rgb: lit0.rgb.toVar(`${o.name}Lit`), dv: lit0.dv.toVar(`${o.name}Dv`) };
  return { lit, b: dot(lit.rgb, vec3(0.2126, 0.7152, 0.0722)).toVar(`${o.name}Bright`) };
}

/** The ramp steps the light alone asks for (0 at the brightness `TREE_LIGHT.mid`), as a variable. */
function lightStep(b: N): N {
  return log2(max(b, 1e-4).div(TREE_LIGHT.mid)).mul(TREE_LIGHT.gain).toVar('treeStep');
}

/** The leaf ramp's tone (0..4) a step value `l` picks. */
function leafLevel(l: N): N {
  const [s0, s1, s2, s3] = TREE_LIGHT.steps;
  return step(s0, l).add(step(s1, l)).add(step(s2, l)).add(step(s3, l));
}

/** A plant's own leaf colour factor: lighter or darker by `bright`, warmer or cooler by `warm`. */
function leafTint(bright: N, warm: N): N {
  return vec3(bright.mul(warm.add(1)), bright, bright.mul(float(1).sub(warm)));
}

/**
 * The depth pre-pass, the colour pass and the sun's pass of a tree mesh. The meshes carry `position`, `nrm` (the normal and the sway factor),
 * `grad`, `part`, `misc`, `tuft` (mesh.ts) and `plant` (foot, leaf amount, anchor height), `look` per vertex (`packTreeStreams`). `hasSun` false (a dungeon): `sun` is null and the colour shader carries no sun code.
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
  const depth = new TreePassMaterial();
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
  const colour = new TreePassMaterial();
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
    const unseen = sight.unseenAt(foot);
    // Variables: the light is written once, where it is first read (the shadow map at the top level), and every later read reuses it.
    const { lit, b } = treeLightAt(lighting, hasSun, { P: truePos, Ps, nl, foot, name: 'tree' });

    // The main light's direction for the crown's form: the sun, or straight up without one.
    const ld: N = hasSun ? sunDir : vec3(0, 1, 0);
    const lp = ld.add(vec3(0, s.misc.x, 0));
    const fromLight = lightStep(b);
    const crown = select(s.isBall, float(0.75), float(0.7)).mul(dot(nl, lp)).add(dot(s.grad.xyz, lp).mul(0.45)).add(s.grad.w).add(noise).sub(select(s.isBall, float(0.2), float(0)));
    // Leaf patches have no rim rule: their ragged edge is single cells, and a rim there reads as specks.
    const l: N = fromLight.add(crown);
    let lvl: N = leafLevel(l);
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
    const row = s.part.x.add(select(s.dead.and(s.part.x.equal(RAMP.bark)), float(1), float(0)));
    const pal = paletteAt(palette, level, row).toVar('treePalette');
    // The plant's own colour: leaves lighter or darker and warmer or cooler (a patch adds its own shift); bark lighter or darker and greyer or more colourful.
    const bright = s.look.x.add(select(s.isTuft, s.part.w, float(0)));
    const warm = s.look.y.add(select(s.isTuft, s.part.z, float(0)));
    const tint = leafTint(bright, warm);
    const grey = vec3(dot(pal, vec3(0.3, 0.59, 0.11)));
    const barkTint = mix(pal, grey, s.look.w).mul(s.look.z);
    const texel = select(shared.plain.greaterThan(0.5), pal, select(s.isBark, barkTint, pal.mul(tint)));
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
  return { depth, colour, sun, leaf: leafMaterial(o) };
}

/**
 * The falling leaves (#329): one camera-facing quad of an art pixel per leaf, from the streams `start` (x, y, z of the lobe it leaves, the lobe's sway
 * factor), `params` (period, phase, leaf threshold, seed), `plant` (foot x, z, the plant's leaf amount or -1 when dead) and `look` (the plant's colour);
 * the corner is `position`'s xy. The path is `leafAt` in leaves.ts. A leaf not falling, lying or fading, one whose lobe is above the plant's
 * leaf amount (the tree's own `plantLeaf` rule) and one of a dead plant collapse out of view. It is lit like the leaves, tone picked by the light
 * (tone 2 at the leaf ramp's reference brightness), and ends with the sight step.
 */
export function leafMaterial(o: {
  lighting: Lighting; sight: Sight; palette: Texture; shared: TreeShared; hasSun: boolean;
}): MeshBasicNodeMaterial {
  const { lighting, sight, palette, shared, hasSun } = o;
  const start = attribute('start', 'vec4'), params = attribute('params', 'vec4'), plant = attribute('plant', 'vec4'), look = attribute('look', 'vec4');
  const corner = positionGeometry.xy;

  const { dead, leaf } = plantLeaf(shared, plant.z);
  const period = max(params.x.div(max(shared.leafRate, 1e-6)), LEAF_LIFE);
  const age = mod(shared.t.add(params.y.mul(period)), period);
  const f = min(age.div(LEAF_FALL), 1);
  const landed = f.greaterThanEqual(1);
  const gone = age.greaterThanEqual(LEAF_LIFE).or(leafGone(params.z, leaf)).or(dead);

  // The path of leafAt: carried along the wind by 0.6..1.4 of LEAF_DRIFT, fluttering across it; the lobe's sway fades out over the fall.
  const drift = shared.windOn.mul(LEAF_DRIFT).mul(params.w.mul(0.8).add(0.6)).mul(f);
  const flutter = select(landed, float(0), sin(age.mul(LEAF_FLUTTER_RATE).add(params.w.mul(2 * Math.PI))).mul(LEAF_FLUTTER).mul(sin(f.mul(Math.PI))));
  const alongWind = vec3(WIND_DIR[0], 0, WIND_DIR[1]);
  const acrossWind = vec3(-WIND_DIR[1], 0, WIND_DIR[0]);
  const sway = swayNode(plant.xy, float(1), float(1), start.w, shared.t, shared.windOn).mul(float(1).sub(f));
  const y = select(landed, float(GROUND), start.y.add(f.mul(float(GROUND).sub(start.y))));
  const base = vec3(start.x, y, start.z).add(alongWind.mul(drift)).add(acrossWind.mul(flutter)).add(sway);

  // Falling, the quad faces the camera; lying, it is flat on the ground (a camera-facing quad would sink half into it).
  const axes = cameraAxes();
  const flat = normalize(vec3(axes.up.x, 0, axes.up.z));
  const upAxis = select(landed, flat, axes.up);
  const point = base.add(axes.right.mul(corner.x.mul(LEAF_HALF))).add(upAxis.mul(corner.y.mul(LEAF_HALF)));
  // The card proportions: lifted by its height, as the tree's points are, and not at all on the ground.
  const lifted = point.add(vec3(0, max(y.sub(GROUND), 0).mul(float(1).div(shared.cosP).sub(1)), 0));
  const material = new MeshBasicNodeMaterial();
  material.positionNode = select(gone, vec3(...GONE), lifted);

  const truePos = varying(point, 'leafPos');
  const foot = varying(plant.xy, 'leafFoot');
  const opacity = varying(select(age.lessThan(LEAF_FALL + LEAF_LIE), float(1), float(1).sub(age.sub(LEAF_FALL + LEAF_LIE).div(LEAF_FADE))), 'leafAlpha');
  const plantLook = varying(look, 'leafLook');
  material.colorNode = Fn(() => {
    const nl = vec3(0, 1, 0);
    const Ps = truePos.add(nl.mul(0.05)).add(lighting.sun.dir.mul(0.05)); // first guess: both nudges, as the tree's
    const unseen = sight.unseenAt(foot);
    const { lit, b } = treeLightAt(lighting, hasSun, { P: truePos, Ps, nl, foot, name: 'leaf' });
    const level = select(shared.plain.greaterThan(0.5), float(2), leafLevel(lightStep(b)));
    const pal = paletteAt(palette, level, float(RAMP.leaf)).toVar('leafPalette');
    const texel = select(shared.plain.greaterThan(0.5), pal, pal.mul(leafTint(plantLook.x, plantLook.y)));
    const albedo = texel.div(max(b, TREE_LIGHT.floor));
    // The fade: a Bayer pattern thins the leaf out (the world is pixel art, no blending).
    const a = select(bayerAt().lessThan(opacity), float(1), float(0));
    return vec4(sight.apply(lighting.finish(albedo, lit, texel), truePos, unseen), a);
  })();
  material.alphaTest = 0.5;
  material.side = DoubleSide;
  return material;
}

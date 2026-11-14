// The ground cover's materials in TSL (#330): the stacked sheets (alpha tested, leaning with the wind by reading the cover image upwind)
// and the bushel cards (camera-facing, blades made in the shader). The ground's darkening and the falling leaf read the cover through
// coverRead.ts. Geometry: coverMesh.ts (sheets: `position`, `layer`; bushels: `position` = the foot, `corner`, `info`).
import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import { Fn, attribute, float, floor, max, min, mix, positionGeometry, select, step, varying, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { CARD_BIAS, bayerAt, cardSunAt, type ViewToward } from '../materials';
import { swayNode } from '../windNodes';
import { hash3 } from '../noiseNodes';
import { GH_MAX } from './kinds';
import { bushelSwayOf, bushelTone, coverTexel, kindLook, type CoverShared } from './coverRead';

export { GH_MAX };
export { coverHeightNode, makeCoverShared, type CoverShared } from './coverRead';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The floor's sun wrap (materials.ts: floor and ground 0.35). */
const FLOOR_WRAP = 0.35;

/**
 * The sheets: `layer` (1..) is the sheet's number, `position` its cell corner at y 0. A sheet keeps the art pixels whose cover is at least
 * as high as it is, read from the image a little upwind (the lean), so the vertices never move in x or z. Lit like the floor, then the sight step.
 */
export function coverSheetMaterial(o: { lighting: Lighting; sight: Sight; shared: CoverShared }): MeshBasicNodeMaterial {
  const { lighting, sight, shared: s } = o;
  const layer: N = attribute('layer', 'float');
  const m = new MeshBasicNodeMaterial();
  const pg: N = positionGeometry;
  m.positionNode = vec3(pg.x, layer.mul(s.gh).div(16), pg.z);
  const cell: N = floor(pg.xz.mul(16));
  m.colorNode = Fn(() => {
    // The kind of the cell sets the lean; the texel it leans onto sets height and colour.
    const here = coverTexel(s, cell);
    const k = kindLook(here.id);
    const f = layer.div(k.maxH);
    const lean = swayNode(cell.div(16), float(1), float(1), f.mul(f).mul(k.sway), s.t, s.windOn); // low grass only stirs (first guess)
    const src = cell.sub(floor(lean.xz.mul(16).add(0.5)));
    const at = coverTexel(s, src);
    const foot = kindLook(at.id).footShade;
    const albedo = at.rgb.mul(mix(foot, float(1), layer.div(max(at.h, 1))));
    const grown = s.on.greaterThan(0.5).and(at.h.greaterThanEqual(layer.sub(0.5)));
    const Pc = vec3(cell.x.add(0.5).div(16), layer.mul(s.gh).div(16), cell.y.add(0.5).div(16));
    const sun = lighting.sun;
    const lit = lighting.lightAt(Pc, vec3(0, 1, 0), FLOOR_WRAP, { sun: { Ps: Pc.add(vec3(0, 0.05, 0)), ndl: mix(max(sun.dir.y, 0), float(1), FLOOR_WRAP) } });
    const unseen = sight.unseenAt(Pc.xz);
    return vec4(sight.apply(lighting.finish(albedo, lit), Pc, unseen), select(grown, float(1), float(0)));
  })();
  m.alphaTest = 0.5;
  m.side = DoubleSide;
  return m;
}

/**
 * The bushels: a card on its foot (`position` = the foot; `corner` 0..1 across the card, `info` = width px, height px, seed, fern 0/1),
 * facing the camera, as tall as `h / 16 * gh` tiles stretched by 1 / cos(pitch), swayed by `oy^2 * look.sway`. The blades are made per
 * pixel column from the seed. Stippled by the sight at the foot (scenery: misted, never hidden on daylight maps).
 */
export function bushelMaterial(o: { lighting: Lighting; sight: Sight; toward: ViewToward; shared: CoverShared }): MeshBasicNodeMaterial {
  const { lighting, sight, toward, shared: s } = o;
  const foot: N = positionGeometry;
  const corner: N = attribute('corner', 'vec2');
  const info: N = attribute('info', 'vec4');
  const w = floor(info.x.add(0.5)), h = floor(info.y.add(0.5)), seed = floor(info.z.add(0.5)), fern = info.w;
  const m = new MeshBasicNodeMaterial();

  // The kind under the foot (a fetch in the vertex shader) gives the sway and, passed on, the tones.
  const kind = varying(coverTexel(s, floor(foot.xz.mul(16))).id, 'bushelKind');
  const sway = swayNode(foot.xz, corner.y, float(1), bushelSwayOf(kind), s.t, s.windOn);
  const world = foot.add(lighting.sun.right.mul(corner.x.sub(0.5).mul(w).div(16))).add(vec3(0, corner.y.mul(h).div(16).mul(s.gh), 0)).add(sway);
  // The screen shows the card at its full height: stretch by 1 / cos(pitch); the light uses the true point.
  m.positionNode = vec3(world.x, world.y.div(s.cosP), world.z).add(toward.mul(CARD_BIAS));

  const truePos = varying(world, 'bushelPos');
  const footXZ = varying(foot.xz, 'bushelFoot');
  m.colorNode = Fn(() => {
    const px: N = min(floor(corner.x.mul(w)), w.sub(1)), py: N = min(floor(corner.y.mul(h)), h.sub(1));
    // The whole bushel leans a little (ferns more); a pixel column has a height of its own, and a blade or a gap.
    const col: N = px.sub(floor(py.mul(hash3(vec3(seed, 1, 2)).sub(0.5).mul(0.7).mul(fern.add(1))))); // ferns lean twice as much: first guess
    const bh: N = h.mul(hash3(vec3(col, seed, 3)).mul(0.6).add(0.4));
    const blade = hash3(vec3(col, seed, 4)).greaterThan(0.3).and(py.lessThan(bh));
    const lvl = step(0.55, py.div(bh)).add(step(0.6, hash3(vec3(col, seed, 5)))); // tone 0..2
    const albedo = bushelTone(kind, lvl);
    const unseen = sight.unseenAt(footXZ);
    const lit = lighting.lightAt(truePos, vec3(0, 0, 0), 1, { sun: cardSunAt(lighting.sun, truePos, footXZ) });
    const colour = sight.apply(lighting.finish(albedo, lit), truePos, unseen);
    const shown = sight.shown(unseen.x, 1);
    const keep = s.on.greaterThan(0.5).and(blade).and(bayerAt().lessThan(shown));
    return vec4(colour, select(keep, float(1), float(0)));
  })();
  m.alphaTest = 0.5;
  m.side = DoubleSide;
  return m;
}

// The demon's materials (#379) in TSL: the lit, painted body with its glow, the body's id (who is nearest at a pixel, into the view's id
// target) and the outline hull, which reads that id. The vertex stage, the light, the sight and the stipple are the lich's and the
// models' own; one demon per set of materials (its place and look are uniforms).
//
// The picture's alpha is a class, sorted by ranges because a filtered texel falls in between: below `cut` a hole (the webbing's rips),
// from `hot[0]` up to `hot[1]` more and more of a glow. How a glowing texel glows is the vertex's kind (`look.x`): 0 pulsing, a wave
// that climbs the body; 1 steady; 2 the face's heat.
import { BackSide, DoubleSide, MeshBasicNodeMaterial, Vector4 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { Fn, attribute, dot, faceDirection, float, ivec2, mix, normalize, screenCoordinate, select, sin, texture, textureLoad, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { FIGURE_SHADE, OUTLINE, keepOf, type FigureShared } from '../models/nodes';
import { vertexOf, type LichUniforms } from '../lich/nodes';
import { DEMON_GLOW } from './glow';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/**
 * The outline's colour (sRGB, used as it is): the models' own. The approved spike named 0x121013 in its description, but its line was
 * drawn by the models' material, which uses this one; the darker value draws a visibly heavier line than the approved picture.
 */
export const DEMON_OUTLINE = OUTLINE;
const LUM = [0.299, 0.587, 0.114] as const;

/** The lich's uniforms; `levels` = [the glow's phase 0..1, the glow's gain, the face's heat, spare]; `flags.z` the owner's number in the id target. */
export type DemonUniforms = LichUniforms;

export function demonMaterials(o: { lighting: Lighting; sight: Sight; shared: FigureShared; paint: Texture; idTex: Texture }):
  { body: MeshBasicNodeMaterial; hull: MeshBasicNodeMaterial; id: MeshBasicNodeMaterial; u: DemonUniforms; dispose(): void } {
  const { lighting, sight } = o;
  const root = uniform(new Vector4()), scale = uniform(1), tint = uniform(new Vector4(1, 1, 1, 0)), seen = uniform(new Vector4(1, 0, 0, -1)), flags = uniform(new Vector4()), levels = uniform(new Vector4(0, 1, 1, 0));
  const un = { root, scale, tint, seen, flags };
  const seenXY = vec2(seen.y, seen.z);
  const gate = (keep: N): N => select(keep, float(1), float(0));
  const look: N = attribute('look', 'vec2');
  const picture = (): N => texture(o.paint, uv()).setName('demonPicture');

  // ---------------------------------------------------------------- the body
  const body = new MeshBasicNodeMaterial();
  body.side = DoubleSide;
  const p = vertexOf(o.shared, un, body, true);
  const col: N = attribute('colour', 'vec3');
  const kind: N = varying(look.x, 'demonKind'), height: N = varying(attribute('position', 'vec3').y, 'demonY');
  const isStone: N = tint.w.greaterThan(0.5);
  body.colorNode = Fn(() => {
    // the picture and the light once, at the top level (a sample needs uniform control flow); the selects below pick between plain values
    const tex: N = picture().toVar('demonPaint');
    // the webbing is seen from both sides: its far side is lit as a surface that faces the other way
    const Nn: N = normalize(p.N).mul(faceDirection);
    const lit0 = lighting.lightAt(p.P, Nn, 1 - FIGURE_SHADE, { self: seen.w.add(0.5).floor(), darkOnly: flags.x });
    const lit = { rgb: lit0.rgb.toVar('figLit'), dv: lit0.dv.toVar('figDv') };
    const painted: N = col.mul(tex.rgb);
    const albedo: N = select(isStone, vec3(dot(painted, vec3(...LUM))), painted.mul(tint.xyz));
    const wave: N = sin(levels.x.sub(height.div(DEMON_GLOW.wave)).mul(2 * Math.PI)).mul(0.5).add(0.5);
    const gain: N = select(kind.lessThan(0.5), levels.y.mul(mix(float(DEMON_GLOW.dark), float(1), wave)), select(kind.lessThan(1.5), float(1), levels.z));
    // a stone demon does not glow
    const hot: N = select(isStone, float(0), tex.a.sub(DEMON_GLOW.hot[0]).div(DEMON_GLOW.hot[1] - DEMON_GLOW.hot[0]).clamp(0, 1));
    const colour: N = mix(lighting.finish(albedo, lit), albedo.mul(gain), hot);
    const keep: N = keepOf(p, sight, { bySight: true }).and(tex.a.greaterThan(DEMON_GLOW.cut));
    return vec4(sight.apply(colour, p.P, seenXY), gate(keep));
  })();
  body.alphaTest = 0.5;

  // ---------------------------------------------------------------- the id pass and the outline, as the models' (models/nodes.ts)
  const stage = (): N => varying(look.y, 'figStage').setInterpolation('flat');
  const owner: N = flags.z.add(0.5).floor();
  const ownerLo: N = owner.mod(256), ownerHi: N = owner.div(256).floor();

  // The body a second time: the same stipple, sight, cut and holes, so the id target matches the picture's body pixels. A part the
  // world hides (below `groundY`, the flags' fourth float) must not cover the hull there.
  const id = new MeshBasicNodeMaterial();
  id.side = DoubleSide;
  const q = vertexOf(o.shared, un, id, false);
  id.colorNode = vec4(ownerLo.div(255), ownerHi.div(255), stage().add(1).div(255),
    gate(keepOf(q, sight, { bySight: true }).and(q.P.y.greaterThanEqual(flags.w)).and(picture().a.greaterThan(DEMON_GLOW.cut))));
  id.alphaTest = 0.5;

  // The hull: the outlined parts pushed out, their inside shown (the buffer has the body's winding). Not lit by the lamps but dimmed by
  // the ambient light; hidden where the nearest body pixel is this demon's with a stage at or above the hull vertex's.
  const hull = new MeshBasicNodeMaterial();
  hull.side = BackSide;
  const h = vertexOf(o.shared, un, hull, false);
  const outline: N = lighting.finish(vec3((DEMON_OUTLINE >> 16) / 255, ((DEMON_OUTLINE >> 8) & 255) / 255, (DEMON_OUTLINE & 255) / 255), { rgb: lighting.ambient, dv: float(0) });
  const bytes: N = textureLoad(o.idTex, ivec2(screenCoordinate.xy)).mul(255).add(0.5).floor();
  const own: N = bytes.x.equal(ownerLo).and(bytes.y.equal(ownerHi)).and(bytes.z.greaterThan(0.5));
  const covered: N = o.shared.idOn.greaterThan(0.5).and(own).and(bytes.z.sub(1).greaterThanEqual(stage()));
  hull.colorNode = vec4(sight.apply(outline, h.P, seenXY), gate(keepOf(h, sight, { bySight: true }).and(covered.not())));
  hull.alphaTest = 0.5;

  return { body, hull, id, u: { root, scale, tint, seen, flags, levels } as DemonUniforms, dispose: () => { body.dispose(); hull.dispose(); id.dispose(); } };
}

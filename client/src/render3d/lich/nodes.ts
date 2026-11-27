// The lich's materials (#358) in TSL: a lit opaque body painted from the lich's picture, and the ghostly claws, which add light.
// One vertex stage for both: the built buffer's point in the model frame, turned by the yaw, scaled and placed from uniforms (one lich per
// material pair). The light, the sight and the stipple are the 3D models' own (`Lighting`, `Sight`, `keepOf`). The glow maths and the
// colours are the spike's (`lichSpike.ts` at dd751c0), except that its own light is replaced by the view's lighting.
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial, Vector4 } from 'three/webgpu';
import type { Texture } from 'three/webgpu';
import { Fn, abs, attribute, clamp, cos, dot, float, mix, normalize, select, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { FIGURE_SHADE, SEE_ORDER, keepOf, type FigurePoint, type FigureShared } from '../models/nodes';
import { LICH_PAINT } from './paint';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The render order of the claws: after the see-through draws. */
export const CLAW_ORDER = SEE_ORDER + 0.1;
/** The turn by the yaw, as `builtPoint` has it: world x = c·x + xFromZ·s·z, world z = zFromX·s·x + c·z. */
export const YAW_TURN = { xFromZ: -1, zFromX: 1 } as const;
/** Luminance weights of r, g, b. */
const LUM = [0.299, 0.587, 0.114] as const;

export interface LichUniforms {
  /** x, lift (the foot's height), z, yaw. */
  root: { value: Vector4 };
  /** Tiles per builder unit. */
  scale: { value: number };
  /** tint rgb, stone 0|1 (`packLook`'s first texel). */
  tint: { value: Vector4 };
  /** alpha, sight hard, sight soft, caster slot. */
  seen: { value: Vector4 };
  /** dark, cut, owner number, groundY. */
  flags: { value: Vector4 };
  /** rune, staff rune, wave, spare. */
  levels: { value: Vector4 };
}

export interface LichMaterials { body: MeshBasicNodeMaterial; claws: MeshBasicNodeMaterial; u: LichUniforms; dispose(): void }

/** The vertex stage shared by both materials (and by the demon's, #379, #442), and the figure point the models' `keepOf` reads. */
export function vertexOf(shared: FigureShared, u: { root: N; scale: N; tint: N; seen: N; flags: N }, m: MeshBasicNodeMaterial, normals: boolean, from?: { P: N; N: N }): FigurePoint {
  // `from`: a skinned figure's point and normal, already in the model frame (the demon's, nodes.ts there); else the attributes are
  const position = from ? from.P : attribute('position', 'vec3');
  const c: N = cos(u.root.w), s: N = sin(u.root.w);
  const turn = (v: N): N => vec3(c.mul(v.x).add(s.mul(v.z).mul(YAW_TURN.xFromZ)), v.y, s.mul(v.x).mul(YAW_TURN.zFromX).add(c.mul(v.z)));
  const world: N = turn(position).mul(u.scale).add(vec3(u.root.x, u.root.y, u.root.z));
  // The camera passes stretch y by 1 / cos(pitch); the light, the sight and `keepOf` use the true point.
  m.positionNode = vec3(world.x, world.y.div(shared.cosP), world.z);
  // The claws are not lit and carry no normals.
  const normal: N = normals ? turn(from ? from.N : attribute('normal', 'vec3')) : vec3(0, 1, 0);
  const none: N = vec4(0, 0, 0, 0);
  return { world, screen: m.positionNode as N, P: varying(world, 'figPos') as N, N: varying(normal, 'figNormal') as N, tint: u.tint, seen: u.seen, flags: u.flags, extra: none };
}

export function lichMaterials(o: { lighting: Lighting; sight: Sight; shared: FigureShared; paint: Texture }): LichMaterials {
  const { lighting, sight } = o;
  const root = uniform(new Vector4()), scale = uniform(1), tint = uniform(new Vector4(1, 1, 1, 0)), seen = uniform(new Vector4(1, 0, 0, -1)), flags = uniform(new Vector4()), levels = uniform(new Vector4());
  const un = { root, scale, tint, seen, flags };
  const seenXY = vec2(seen.y, seen.z);
  const lum = (c: N): N => dot(c, vec3(...LUM));

  // ---------------------------------------------------------------- the body
  const body = new MeshBasicNodeMaterial();
  const p = vertexOf(o.shared, un, body, true);
  const col: N = attribute('colour', 'vec3'), look: N = attribute('look', 'vec2'), uvA: N = uv();
  const isStone: N = tint.w.greaterThan(0.5);
  const unlit: N = look.x.greaterThan(0.5);
  const AW = LICH_PAINT.w, AH = LICH_PAINT.h;
  body.colorNode = Fn(() => {
    // The picture and the light are computed once, at the top level (a sample needs uniform control flow, and `lightAt` is big); the
    // selects below only pick between plain values.
    const tex: N = texture(o.paint, uvA).setName('lichPicture').toVar('lichPaint');
    const Nn: N = normalize(p.N);
    const lit0 = lighting.lightAt(p.P, Nn, 1 - FIGURE_SHADE, { self: seen.w.add(0.5).floor(), darkOnly: flags.x });
    const lit = { rgb: lit0.rgb.toVar('figLit'), dv: lit0.dv.toVar('figDv') };
    // As the models: the tint multiplies the albedo (and so the glow's base), a stone albedo is its luminance and untinted, an unlit
    // vertex shows its own colour untinted (a stone lich's is lit grey).
    const painted: N = col.mul(tex.rgb);
    const albedo: N = select(isStone, vec3(lum(painted)), painted.mul(tint.xyz));
    // The picture's alpha classes (antialiased, so thresholds): the staff's runes (170), the skull's (255).
    const glowing: N = smoothstep(0.45, 0.62, tex.a), onHead: N = smoothstep(0.75, 0.9, tex.a);
    // How far up the staff a texel is (0 foot, 1 under the gem): a wave of light climbs it.
    const upStaff: N = uvA.x.mul(AW).sub(16).div(256).add(smoothstep(175.5 / AH, 176.5 / AH, uvA.y)).mul(0.5);
    const crest: N = float(1).sub(smoothstep(0, 0.22, abs(upStaff.sub(levels.z))));
    const glowColour: N = albedo.mul(mix(levels.y.add(crest.mul(crest).mul(1.1)), levels.x, onHead));
    const ownUnlit: N = unlit.and(isStone.not());
    const toLight: N = select(unlit, select(isStone, vec3(lum(col)), col), albedo.mul(look.y));
    const finished: N = lighting.finish(toLight, lit);
    const glows: N = select(unlit.or(isStone), float(0), glowing);
    const colour: N = select(ownUnlit, col, mix(finished, glowColour, glows));
    const keep: N = keepOf(p, sight, { bySight: true }).and(tex.a.greaterThan(0.2));
    return vec4(sight.apply(colour, p.P, seenXY), select(keep, float(1), float(0)));
  })();
  body.alphaTest = 0.5;
  body.side = DoubleSide;

  // ---------------------------------------------------------------- the claws
  const claws = new MeshBasicNodeMaterial();
  const q = vertexOf(o.shared, un, claws, false);
  const shown: N = sight.shown(seen.y, float(0));
  const above: N = flags.y.lessThan(0.5).or(q.P.y.greaterThanEqual(0));
  const a: N = clamp(seen.x, 0, 1).mul(shown).mul(select(above, float(1), float(0)));
  claws.colorNode = vec4(sight.apply(attribute('colour', 'vec3'), q.P, seenXY), a);
  claws.transparent = true;
  claws.depthWrite = false;
  claws.blending = AdditiveBlending;
  claws.side = DoubleSide;

  return { body, claws, u: { root, scale, tint, seen, flags, levels } as LichUniforms, dispose: () => { body.dispose(); claws.dispose(); } };
}
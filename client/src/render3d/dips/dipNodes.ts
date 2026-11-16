// The ground of the dips in TSL (#324): the floor's own texel above the lip, the bank rock below it (mud for water, basalt for lava,
// jagged slabs of chasm rock), lit like the world, with the lava's band of glow and the chasm's depth fade. The mesh (dipMesh.ts) carries the
// world material's `kind` and `rect` plus a per-vertex `dip` kind; the rock reads the world position only, so it looks the same on the
// sloped ground and on the vertical skirts along walls. The numbers are first guesses from the mockup, to be tuned by eye.
import type { NodeMaterial, Texture } from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { abs, attribute, exp, float, floor, fract, max, min, mix, positionWorld, select, sign, smoothstep, sqrt, step, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { flatTexel } from '../materials';
import { coverTexel, kindLook, type CoverShared } from '../cover/coverRead';
import { fbm2, hash21, vnoise2 } from '../noiseNodes';
import { LAVA_LEVEL } from './shape';

/** The light's wrap on a dip surface (like a floor's). */
const WRAP = 0.35;

/** The chasm rock's albedo (lit by the game light), and its own cool light per unit of slab shading, which makes the shape read with no torch near. Dark charcoal: a slab's face is about a tenth of full brightness at the rim, its lit lip up to a fifth. */
const CHASM_ROCK = vec3(0.07, 0.069, 0.068);
const CHASM_SELF = vec3(0.155, 0.162, 0.178);
/** The ledges: the tilt of the layers (cos, sin of about 25 degrees, rising to the right), layers per world unit across them (a chasm shows only its top two or three tiles, so the layers are a third to half a tile), and the low-frequency warp that keeps them from running parallel (frequency, amount in world units). */
const LEDGE_COS = 0.906, LEDGE_SIN = 0.423, LEDGE_ACROSS = 2.3, LEDGE_WARP_FREQ = 0.6, LEDGE_WARP = 0.4;
/** A layer's lower edge, in layers: a long angular swing and a shorter one (frequency along the layer, range), and chipped notches (steps). The ranges sum to under 1, so layers never cross; a layer's thickness varies from a sliver to nearly two layers. */
const EDGE_F1 = 0.8, EDGE_A1 = 0.42, EDGE_F2 = 2.6, EDGE_A2 = 0.3, EDGE_F3 = 5, EDGE_A3 = 0.09;
/** A layer is broken into slabs along its length: slabs per world unit, how far the breaks slant, a break's width (most are hairline, a few are wide recesses) and its darkness. */
const SLAB_FREQ = 0.9, SLAB_SLANT = 0.9, BREAK_NARROW = 0.015, BREAK_WIDE = 0.16, BREAK_DARK = 0.12;
/**
 * A slab's look: the darkest tone a slab takes (the lightest is 1); the undercut at its foot (depth, and its width in layers: some slabs
 * overhang deeply, some barely); the black line under it; the lip at its top that catches the light (strength, width); how much a slab,
 * a flat plate, is turned to or from the light along its length.
 */
const SLAB_TONE_LOW = 0.38, UNDERCUT = 0.95, UNDERCUT_NARROW = 0.12, UNDERCUT_WIDE = 0.85, LEDGE_LINE = 0.05, LIP = 0.5, LIP_WIDTH = 0.1, SLAB_FACET = 0.45;
/** The mottling, the broad variation of tone across the face and the fine grain (frequency, range each). */
const ROCK_MOTTLE_FREQ = 4.5, ROCK_MOTTLE = 0.35, ROCK_BROAD_FREQ = 0.4, ROCK_BROAD = 0.5, ROCK_GRAIN_FREQ = 21, ROCK_GRAIN = 0.3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
/** Angular 1D noise of layer `k` at `x`: the lattice values joined by straight lines (no smoothing), so an edge drawn with it has corners. */
const lin = (x: N, k: N): N => {
  const i = floor(x);
  return mix(hash21(vec2(i, k)), hash21(vec2(i.add(1), k)), x.sub(i));
};
/** The lower edge of layer `k` at `u` along it, as an offset in layers: a long angular swing, a shorter one, and chipped notches. Each layer has its own, so the layers pinch and swell. */
const ledgeEdge = (u: N, k: N): N =>
  lin(u.mul(EDGE_F1).add(k.mul(13.7)), k).sub(0.5).mul(EDGE_A1)
    .add(lin(u.mul(EDGE_F2).add(k.mul(5.1)).add(3), k.add(57)).sub(0.5).mul(EDGE_A2))
    .add(hash21(vec2(floor(u.mul(EDGE_F3).add(k.mul(9.3))), k.add(113))).sub(0.5).mul(EDGE_A3));
/**
 * The chasm rock's shading (0 to about 1.2) at (s, y), s along the wall and y up it: overlapping jagged slabs of layered rock. The face is
 * a stack of tilted layers, each with its own angular lower edge; the layer over a point is the highest one whose edge lies below it
 * (four candidates, unrolled: no shader loop). A layer is broken along its length into slabs, each a flat plate with its own tone and
 * turn; every slab has a lit lip at its top and a dark undercut at its foot, where it overhangs the layer below. Mottling, a broad
 * variation and fine grain lie over it. Sine-free hashes only.
 */
function slabs(s: N, y: N): N {
  const p = vec2(s, y);
  const u = s.mul(LEDGE_COS).add(y.mul(LEDGE_SIN));
  const v = y.mul(LEDGE_COS).sub(s.mul(LEDGE_SIN)).add(vnoise2(p.mul(LEDGE_WARP_FREQ).add(vec2(2, 9))).sub(0.5).mul(LEDGE_WARP));
  const a = v.mul(LEDGE_ACROSS), K = floor(a);
  const e0 = K.sub(1).add(ledgeEdge(u, K.sub(1))), e1 = K.add(ledgeEdge(u, K)), e2 = K.add(1).add(ledgeEdge(u, K.add(1))), e3 = K.add(2).add(ledgeEdge(u, K.add(2)));
  // Which layer covers the point: the one above (in2), the point's own (in1) or the one below; its own edge and the edge of the layer over it.
  const in2 = step(e2, a), in1 = float(1).sub(in2).mul(step(e1, a));
  const own = mix(mix(e0, e1, in1), e2, in2), over = mix(mix(e1, e2, in1), e3, in2);
  const k = K.sub(1).add(in1).add(in2.mul(2));
  const t = a.sub(own), up = over.sub(a);
  // The slabs of the layer: breaks along it, slanted by the layer's own amount.
  const sc = u.mul(SLAB_FREQ).add(hash21(vec2(k, 7.7)).mul(9)).add(t.mul(hash21(vec2(k, 91.3)).sub(0.5)).mul(2 * SLAB_SLANT));
  const m = floor(sc), fu = sc.sub(m);
  const id = hash21(vec2(k.mul(3.17).add(0.5), m.mul(5.31).add(0.5)));
  const id2 = hash21(vec2(k.mul(7.3).add(2.5), m.mul(1.9).add(4.5)));
  const id3 = hash21(vec2(k.mul(1.3).add(8.5), m.mul(9.7).add(1.5)));
  const tone = float(SLAB_TONE_LOW).add(id.mul(1 - SLAB_TONE_LOW));
  const breakWidth = float(BREAK_NARROW).add(id3.mul(id3).mul(id3).mul(BREAK_WIDE - BREAK_NARROW));
  const broken = float(BREAK_DARK).add(smoothstep(0, breakWidth, min(fu, float(1).sub(fu))).mul(1 - BREAK_DARK));
  const undercutWidth = float(UNDERCUT_NARROW).add(id2.mul(id2).mul(UNDERCUT_WIDE - UNDERCUT_NARROW));
  const shadow = float(1).sub(float(1).sub(smoothstep(0, undercutWidth, t)).mul(UNDERCUT));
  const line = smoothstep(0, LEDGE_LINE, t);
  const lip = float(1).sub(smoothstep(0, LIP_WIDTH, up)).mul(LIP);
  const facet = float(1).add(fu.sub(0.5).mul(mix(float(-SLAB_FACET), float(SLAB_FACET), step(0.5, id2))));
  const mottle = float(1 - ROCK_MOTTLE / 2).add(vnoise2(p.mul(ROCK_MOTTLE_FREQ).add(5)).mul(ROCK_MOTTLE));
  const broad = float(1 - ROCK_BROAD / 2).add(vnoise2(p.mul(ROCK_BROAD_FREQ).add(11)).mul(ROCK_BROAD));
  const grain = float(1 - ROCK_GRAIN / 2).add(vnoise2(p.mul(ROCK_GRAIN_FREQ)).mul(ROCK_GRAIN));
  return tone.mul(facet).mul(shadow).mul(broken).add(lip.mul(tone)).mul(line).mul(mottle).mul(broad).mul(grain);
}

/**
 * The broken pieces of the floor along a rim: pieces per world unit. A chasm's cracks: how far they run from the chasm's cells (tiles),
 * how unevenly (a share of that, by the piece), their width at the rim (in pieces: about 1.5 art pixels), their darkness; how deep into
 * the outline's mask the pieces at the rim break off; and the dust that dulls the floor at the rim.
 */
const SHARD_FREQ = 1.35, CRACK_REACH = 0.9, CRACK_RAGGED = 0.5, CRACK_WIDTH = 0.11, CRACK_DARK = 0.95, CHIP = 0.3, RIM_DUST = 0.3;
/** The floor by lava: how far the scorching runs (tiles) and how dark it makes the floor, the soot's colour and cover, how far the glow in the tile joints and cracks runs, its colour and the cracks' width (in pieces). */
const SCORCH_REACH = 0.9, SCORCH_DARK = 0.3, SOOT_COVER = 0.45, EMBER_REACH = 0.5, EMBER_WIDTH = 0.07;
const SOOT = vec3(0.045, 0.03, 0.026), EMBER = vec3(0.85, 0.24, 0.04);
/**
 * The piece of a jittered grid `q` lies in (a Voronoi cell: a shard with straight edges): its random id 0..1 and how far `q` is inside
 * its border (0 on the border). Nine cells, unrolled at build time (no shader loop); sine-free hashes only.
 */
function shards(q: N): { id: N; edge: N } {
  const ip: N = floor(q), fp: N = fract(q);
  let f1: N = float(8), f2: N = float(8), id: N = float(0);
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const c = ip.add(vec2(ox, oy));
      const rx = float(ox).add(hash21(c)).sub(fp.x), ry = float(oy).add(hash21(c.add(vec2(37.2, 17.7)))).sub(fp.y);
      const dd = rx.mul(rx).add(ry.mul(ry));
      const near = step(dd, f1);
      f2 = mix(min(f2, dd), f1, near);
      f1 = min(f1, dd);
      id = mix(id, hash21(c.add(vec2(5.3, 71.9))), near);
    }
  }
  return { id, edge: sqrt(f2).sub(sqrt(f1)) };
}

export interface DipMaterial {
  material: NodeMaterial;
  /** 0 or 1: the floor texel above the lip reads the linear texture at a sharpened position. */
  smooth: { value: number };
  /** Seconds, set by the view each frame: the lava band's flicker. */
  time: { value: number };
  /** Points the ground kind at a new image (nearest and linear copies of it) and marks it ready. */
  setGround(nearest: Texture, linear: Texture): void;
}

/**
 * The dip ground: `mix(floor texel, rock, bank)` by the depth below the floor, lit with `lightAt` (without the lava cell's own glow: the
 * material draws a band of it at the lava's level), then the sight step. Opaque. `time` drives the band.
 */
export function dipMaterial(atlas: Texture, linearAtlas: Texture, atlasW: number, atlasH: number, lighting: Lighting, groundStart: Texture, sight: Sight, cover: CoverShared): DipMaterial {
  const kind = attribute('kind', 'float');
  const dip = attribute('dip', 'float');
  const normal = attribute('normal', 'vec3');
  const flat = flatTexel(atlas, linearAtlas, atlasW, atlasH, groundStart, kind);
  const time = uniform(0);

  const wp = positionWorld;
  const y = wp.y;
  const d = y.negate();
  // The rock is drawn in a plane that slides with depth, so the pattern does not smear on steep banks.
  const pp = wp.xz.add(vec2(y.mul(0.8), y.mul(-0.5)));
  const bank = smoothstep(0.02, 0.12, d);

  // The kinds, by ranges of the vertex attribute (0 none, 1 water, 2 lava, 3 chasm).
  const isLava = dip.greaterThan(1.5).and(dip.lessThan(2.5));
  const isChasm = dip.greaterThan(2.5);

  // All the noise is evaluated here, at the top level; the kinds only pick between the results.
  const rough = fbm2(pp.mul(5));
  const mud = vec3(0.10, 0.085, 0.055).mul(float(0.6).add(rough.mul(0.8)));
  const pebbles = smoothstep(0.66, 0.72, vnoise2(pp.mul(4.3).add(3.1)));
  const stones = vec3(0.20, 0.19, 0.16).mul(float(0.7).add(vnoise2(pp.mul(9)).mul(0.5)));
  const waterRock = mix(mix(mud, stones, pebbles), vec3(0.03, 0.07, 0.04), smoothstep(0.4, 2.0, d).mul(0.7));

  const lavaRock = vec3(0.045, 0.038, 0.036).mul(float(0.6).add(rough.mul(0.9))).mul(float(0.75).add(vnoise2(pp.mul(23)).mul(0.5)));

  // The chasm's rock: jagged slabs, in the wall's own frame (along it, to the right seen from inside the chasm, and up it). A wall that
  // runs along x takes x, one along z takes z, a rounded corner blends the two by the normal (a single coordinate would mirror there).
  const nx2 = normal.x.mul(normal.x), nz2 = normal.z.mul(normal.z);
  const alongZ = smoothstep(0.3, 0.7, nx2.div(nx2.add(nz2).add(1e-4)));
  const ridges = mix(slabs(wp.x.mul(sign(normal.z)), y), slabs(wp.z.mul(sign(normal.x)).negate(), y), alongZ);
  const chasmRock = CHASM_ROCK.mul(ridges);

  const glowNoise = fbm2(wp.xz.mul(3).add(vec2(0, time.mul(0.2))));

  // The floor along a rim is marked by what lies beside it: moss by water, soot and glowing cracks by lava, cracks and broken-off
  // pieces by a chasm.
  // `near` (1 on the dip's cells, 0 one tile away) says how far a mark runs, `rim` (the outline's own mask) where the outline is.
  const rim = attribute('rim', 'vec3');
  const near = attribute('near', 'vec3');
  const sh = shards(wp.xz.mul(SHARD_FREQ));
  const cellXZ: N = fract(wp.xz);
  const joint = float(1).sub(smoothstep(0.02, 0.09, min(min(cellXZ.x, float(1).sub(cellXZ.x)), min(cellXZ.y, float(1).sub(cellXZ.y)))));
  const patchy = vnoise2(wp.xz.mul(2.6).add(7)).sub(0.5);

  // By water the rim is the game's own moss (the ground cover, #330: `cover/moss.ts` grows it along every pool). The floor under it is
  // drawn as the world material draws it: darkened under standing cover, or the cover's colour flat while the layer is off.
  const grown = coverTexel(cover, floor(wp.xz.mul(16)));
  const covered = grown.h.greaterThan(0.5);
  const floorTexel = select(covered, select(cover.on.greaterThan(0.5), flat.texel.rgb.mul(kindLook(grown.id).darken), grown.rgb), flat.texel.rgb);

  const scorch = smoothstep(1 - SCORCH_REACH, 1, near.y.add(patchy.mul(0.35)));
  const byLava = mix(floorTexel.mul(mix(float(1), float(SCORCH_DARK), scorch)), SOOT, scorch.mul(SOOT_COVER));
  const emberLine = max(joint.mul(0.6), float(1).sub(smoothstep(0, EMBER_WIDTH, sh.edge)));
  const ember = EMBER.mul(emberLine).mul(smoothstep(1 - EMBER_REACH, 0.98, near.y.add(patchy.mul(0.3)))).mul(float(0.55).add(glowNoise.mul(0.6))).mul(float(1).sub(bank));

  // Cracks run out from the chasm along the edges of the floor's pieces, each piece as far as its own id lets them, widening toward
  // the rim; the pieces at the rim have broken off (the dark rock under the floor shows), which makes the break line jagged.
  const reach = smoothstep(1 - CRACK_REACH, 0.95, near.z.add(sh.id.sub(0.5).mul(CRACK_RAGGED)));
  const crackWidth = max(reach.mul(CRACK_WIDTH), 1e-3);
  const crack = float(1).sub(smoothstep(crackWidth.mul(0.5), crackWidth, sh.edge)).mul(step(1e-3, reach));
  const brokenOff = step(float(0.5).sub(smoothstep(0.25, 0.75, sh.id).mul(CHIP)), rim.z);
  const dusty = float(1).sub(smoothstep(0.5, 1, near.z).mul(RIM_DUST));
  const byChasm = mix(byLava.mul(float(1).sub(crack.mul(CRACK_DARK))).mul(dusty), CHASM_ROCK.mul(0.35), brokenOff);

  const rock = select(dip.lessThan(1.5), waterRock, select(dip.lessThan(2.5), lavaRock, chasmRock));
  const albedo = mix(byChasm, rock, bank);

  const lit = lighting.lightAt(wp, normal, WRAP, { selfLit: false });
  const base = lighting.finish(albedo, lit).add(ember);

  // The lava's glowing band at its own level, and the chasm's cool self-light, then its fade with depth (the twin of `depthFade`).
  const band = vec3(1.1, 0.22, 0.02)
    .mul(exp(abs(y.sub(LAVA_LEVEL)).mul(-7)))
    .mul(float(0.5).add(glowNoise.mul(0.8)))
    .mul(smoothstep(0, 0.08, d));
  const cool = CHASM_SELF.mul(ridges).mul(bank);
  const fade = float(0.03).add(exp(min(y, 0).mul(0.55)).mul(0.97));
  // `base` (every light and shadow loop) is built once; only these cheap terms are picked by float weights (a colour `select` would emit `base` per branch).
  const lavaW = select(isLava, float(1), float(0));
  const chasmW = select(isChasm, float(1), float(0));
  const colour = mix(base.add(band.mul(lavaW)), base.add(cool).mul(fade), chasmW);

  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sight.apply(colour, wp, sight.unseenAt(wp.xz)), 1);
  return { material: m, smooth: flat.smooth, time, setGround: flat.setGround };
}

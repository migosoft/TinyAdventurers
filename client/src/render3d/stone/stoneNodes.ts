// SPIKE (#380), throwaway: stonework for the dungeon's floor and walls, made in the shader per stone pixel (1/32 tile by default).
// Laid stone (courses of blocks with mortar joints, bevels, chips, tilted and sunken blocks), natural rock (faceted cells with
// cracks), ornaments (a summoning circle of masonry, a carved wall frieze, glowing rune slabs), a height per pixel that bends the
// normal so the lights catch the relief. Nothing here is tested or final.
import { DataTexture, NearestFilter, NoColorSpace, RedFormat, UnsignedByteType, Vector2 } from 'three/webgpu';
import { Fn, If, abs, atan, attribute, clamp, float, floor, fract, length, max, min, mix, mod, normalize, select, texture, time, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { hash21, hash22, vnoise2 } from '../noiseNodes';
import { CRACK_RES, GRATE, MOSAIC, STONE_LEVEL, crackMask } from './stoneMap';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The spike's switches. `enabled` is read when the world material is built; the rest are uniforms. */
export const STONE_SPIKE = {
  enabled: false,
  /** Relief strength: how far a height step bends the normal. */
  depth: uniform(1),
  /** Block size factor. */
  block: uniform(1),
  /** Stone pixels per tile. */
  res: uniform(32),
  /** The summoning circle's centre (world x, z) and radius in tiles. */
  circle: uniform(new Vector2(STONE_LEVEL.circle.x, STONE_LEVEL.circle.z)),
  circleR: uniform(STONE_LEVEL.circle.r),
};

const MAP_SIZE = vec2(STONE_LEVEL.map.w, STONE_LEVEL.map.h);

/** The floor cracks' mask: 255 inside a crack, nearest, so a crack has a hard pixel edge. */
function crackTexture(): DataTexture {
  const m = crackMask();
  const t = new DataTexture(m.data, m.w, m.h, RedFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
const CRACK_TEX = crackTexture();
const BISECT = false;
void CRACK_RES;

const F4 = (name: string, inputs: string[]) => ({ name, type: 'vec4', inputs: inputs.map((n) => ({ name: n, type: n === 's' || n === 'pd' ? 'vec2' : 'float' })) });

/** Laid stone at the surface pixel `s`: (height 0..1, the block's tone hash, the block centre x, y in surface px). Height 0 is a joint or a chip, 0.02 a crack. */
const laid: N = Fn(([s, bw, bh, seed]: N[]) => {
  const row = floor(s.y.div(bh));
  const shift = floor(hash21(vec2(row, seed)).mul(bw));
  const ux = s.x.add(shift);
  const col = floor(ux.div(bw));
  const id = vec2(col, row);
  const lx = ux.sub(col.mul(bw));
  const ly = s.y.sub(row.mul(bh));
  const half = floor(bw.div(2));
  const isSplit = hash21(id.add(vec2(seed, 0.5))).greaterThan(0.62);
  const sub = select(isSplit.and(lx.greaterThanEqual(half)), float(1), float(0));
  const w: N = select(isSplit, select(sub.greaterThan(0.5), bw.sub(half), half), bw);
  const lx2 = lx.sub(sub.mul(half));
  const bid = id.mul(vec2(1.7, 3.1)).add(vec2(sub.mul(13.7).add(seed), 4.4));
  const tone = hash21(bid);
  const joint = lx2.lessThan(1).or(ly.lessThan(1));
  const d = min(min(lx2.sub(1), w.sub(1).sub(lx2)), min(ly.sub(1), bh.sub(1).sub(ly)));
  const bevel = select(d.lessThan(0.5), float(0.7), float(1));
  const corner = floor(hash21(bid.add(7.7)).mul(4));
  const cx = select(mod(corner, 2).lessThan(0.5), lx2.sub(1), w.sub(1).sub(lx2));
  const cy = select(corner.lessThan(1.5), ly.sub(1), bh.sub(1).sub(ly));
  const chipped = hash21(bid.add(9.1)).lessThan(0.35).and(cx.add(cy).lessThan(2.5));
  const pit = select(hash21(s.mul(1.3).add(seed)).lessThan(0.02), float(-0.2), float(0));
  const grain = hash21(s.add(vec2(seed, 17))).sub(0.5).mul(0.06);
  // A crack through a few blocks: a jagged line from the lower to the upper edge, one pixel wide.
  const crackX = w.mul(float(0.3).add(hash21(bid.add(6.6)).mul(0.4))).add(ly.sub(bh.mul(0.5)).mul(hash21(bid.add(8.8)).sub(0.5).mul(1.2))).add(floor(hash21(vec2(floor(ly.div(3)), seed).add(bid)).mul(3)).sub(1));
  const cracked = hash21(bid.add(5.5)).lessThan(0.09).and(abs(lx2.sub(crackX)).lessThan(0.6));
  // Each block lies a little differently: its own level (some sunk well below the others) and its own slight tilt.
  const lv = hash21(bid.add(11.3));
  const isSunk = lv.lessThan(0.18), isRaised = lv.greaterThan(0.86);
  const level = select(isSunk, float(0.22), select(isRaised, float(1), float(0.5).add(hash21(bid.add(2.2)).mul(0.25))));
  // A sunk block's left and upper edges lie in its neighbours' shadow; a raised block's right and lower edges catch the light. Carried in the tone slot: + 2 and + 4.
  const inShade = lx2.lessThan(4.5).or(ly.lessThan(4.5));
  const inLight = w.sub(lx2).lessThan(3.5).or(bh.sub(ly).lessThan(3.5));
  const edgeMark = select(joint, float(0), select(isSunk.and(inShade), float(2), select(isRaised.and(inLight), float(4), float(0))));
  const tilt = lx2.sub(w.mul(0.5)).div(w).mul(hash21(bid.add(12.1)).sub(0.5).mul(0.5)).add(ly.sub(bh.mul(0.5)).div(bh).mul(hash21(bid.add(13.7)).sub(0.5).mul(0.5)));
  const h = select(joint.or(chipped), float(0), select(cracked, float(0.02), clamp(level.add(tilt).mul(bevel).add(grain).add(pit), 0.08, 1)));
  const centre: N = vec2(col.mul(bw).add(sub.mul(half)).add(w.mul(0.5)).sub(shift), row.mul(bh).add(bh.mul(0.5)));
  return vec4(h, tone.add(edgeMark), centre.x, centre.y);
}).setLayout(F4('stoneLaid', ['s', 'bw', 'bh', 'seed']));

/** Natural rock at the surface pixel `s`: (height 0..1, the facet's tone hash, 1 in a crack, 0). `stretch` widens the facets along x (strata on walls). */
const rock: N = Fn(([s, cell, stretch, seed]: N[]) => {
  // The cells are bent by a slow noise so the facets are not a regular honeycomb.
  const warp = vec2(vnoise2(s.div(cell.mul(1.2)).add(seed)), vnoise2(s.div(cell.mul(1.2)).add(vec2(31.7, seed)))).sub(0.5).mul(0.7);
  const g: N = s.div(vec2(cell.mul(stretch), cell)).add(warp);
  const i = floor(g);
  const f = fract(g);
  const f1 = float(9).toVar();
  const f2 = float(9).toVar();
  const near: N = vec2(0).toVar();
  const off: N = vec2(0).toVar();
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = i.add(vec2(dx, dz));
    const site = vec2(dx, dz).add(hash22(c.add(vec2(seed, seed.mul(1.3)))));
    const dist = length(site.sub(f));
    If(dist.lessThan(f1), () => {
      near.assign(c);
      off.assign(f.sub(site));
    });
    f2.assign(min(f2, max(f1, dist)));
    f1.assign(min(f1, dist));
  }
  const tone = hash21(near.add(vec2(seed.add(3.3), 1.1)));
  const tilt: N = hash22(near.add(vec2(5.5, seed))).sub(0.5);
  // Cracks only in a few patches, thin: most facets meet as plain edges that the light picks out.
  const crack = f2.sub(f1).lessThan(0.05).and(vnoise2(s.div(cell.mul(1.55)).add(seed.add(9))).greaterThan(0.62));
  const bulge = vnoise2(s.div(cell.mul(2.4)).add(seed)).mul(0.5);
  const grain = hash21(s.add(vec2(seed, 31))).sub(0.5).mul(0.06);
  const h = select(crack, float(0.05), clamp(float(0.2).add(tone.mul(0.35)).add(off.dot(tilt).mul(1.1)).add(bulge).add(grain), 0.12, 1));
  return vec4(h, tone, select(crack, float(1), float(0)), float(0));
}).setLayout(F4('stoneRock', ['s', 'cell', 'stretch', 'seed']));

/**
 * The summoning circle as masonry: wedge-shaped stones in rings round a centre disc. `pd` is the offset from the centre in 1/16
 * tile, `jw` a joint's width in the same unit, `R` the radius. Returns (height, tone, ring 0..4 or -1 outside, flag: 1 joint, 2 a carved rune).
 */
const circleStone: N = Fn(([pd, jw, R]: N[]) => {
  const r = length(pd);
  const k = r.div(R);
  // Ring edges as shares of the radius, and the number of stones per ring.
  const ring = select(k.lessThan(0.14), float(0), select(k.lessThan(0.36), float(1), select(k.lessThan(0.58), float(2), select(k.lessThan(0.84), float(3), select(k.lessThan(1), float(4), float(-1))))));
  const rin = R.mul(select(ring.lessThan(0.5), float(0), select(ring.lessThan(1.5), float(0.14), select(ring.lessThan(2.5), float(0.36), select(ring.lessThan(3.5), float(0.58), float(0.84))))));
  const rout = R.mul(select(ring.lessThan(0.5), float(0.14), select(ring.lessThan(1.5), float(0.36), select(ring.lessThan(2.5), float(0.58), select(ring.lessThan(3.5), float(0.84), float(1))))));
  const count = select(ring.lessThan(0.5), float(1), select(ring.lessThan(1.5), float(6), select(ring.lessThan(2.5), float(10), select(ring.lessThan(3.5), float(14), float(30)))));
  const seg = atan(pd.y, pd.x).div(6.2832).add(0.5).mul(count).add(ring.mul(0.37));
  const si = floor(seg);
  const u = fract(seg);
  const v = r.sub(rin).div(rout.sub(rin));
  const arc = r.mul(6.2832).div(count);
  const joint = r.sub(rin).lessThan(jw).and(ring.greaterThan(0.5)).or(u.mul(arc).lessThan(jw).and(ring.greaterThan(0.5)));
  const tone = hash21(vec2(si, ring.mul(7.7).add(3)));
  // The rune ring (3): a glyph of 3 x 5 cells carved into each stone.
  const gx = floor(u.mul(7)), gy = floor(v.mul(9));
  const rune = ring.greaterThan(2.5).and(ring.lessThan(3.5)).and(gx.greaterThan(1.5)).and(gx.lessThan(4.5)).and(gy.greaterThan(1.5)).and(gy.lessThan(6.5))
    .and(hash21(vec2(si.mul(3).add(gx), gy.add(si.mul(1.7)))).greaterThan(0.42));
  const h = select(joint, float(0), select(rune, float(0.25), float(0.7).add(tone.mul(0.3))));
  return vec4(h, tone, ring, select(joint, float(1), select(rune, float(2), float(0))));
}).setLayout(F4('stoneCircle', ['pd', 'jw', 'R']));

/** The stone of a world surface: its colour, the bent normal, the point the light is read at (the stone pixel's centre), whether it is rock, and its own glow. */
export function stoneSurface(wp: N, isTop: N): { albedo: N; normal: N; P: N; rock: N; glow: N } {
  const RES = STONE_SPIKE.res;
  const n: N = normalize(attribute('normal', 'vec3'));
  // The pattern is laid on the plane the surface faces most (a sloped rock face picks one of the three).
  const ax = abs(n.x).greaterThan(abs(n.z));
  const up = abs(n.y).greaterThan(0.6);
  // The surface's two axes in the world: along the wall and up for a face, x and z for a floor or a top.
  const T = select(up, vec3(1, 0, 0), select(ax, vec3(0, 0, 1), vec3(1, 0, 0)));
  const B = select(up, vec3(0, 0, 1), vec3(0, 1, 0));
  const s0 = vec2(wp.dot(T), wp.dot(B)).mul(RES);
  const q = floor(s0);
  // The point of the stone pixel's centre: one pixel is one colour and one light.
  const P = wp.add(T.mul(q.x.add(0.5).sub(s0.x).div(RES))).add(B.mul(q.y.add(0.5).sub(s0.y).div(RES)));
  // Each wall plane has its own pattern: the seed is the plane's coordinate.
  const A = select(up, vec3(0, 1, 0), select(ax, vec3(1, 0, 0), vec3(0, 0, 1)));
  const plane = floor(wp.dot(A).add(0.5));
  const wall = select(up, float(0), float(1));
  const seed = select(up.not(), plane.mul(3.7).add(select(ax, float(40), float(0))), select(isTop, float(77), float(11)));
  const unit = RES.div(16);
  const k = STONE_SPIKE.block.mul(unit);
  const bw = max(floor(mix(float(22), float(14), wall).mul(k)), 4);
  const bh = max(floor(mix(float(15), float(6), wall).mul(k)), 3);
  const cell = mix(float(11), float(8), wall).mul(max(k, 0.5));
  const stretch = mix(float(1), float(1.7), wall);
  const onFloor = up.and(abs(wp.y).lessThan(0.05));
  const circleR16 = STONE_SPIKE.circleR.mul(16);

  /** The level's kind at a world point: r = rock share, g = rune chamber share. */
  // Rock where x is left of 18 or z is below 16 (the spike level's layout), with a band a tile wide between. A formula, not a texture: the world material is at WebGL's limit of 16 textures.
  const kindAt = (Wp: N): N => vec4(max(clamp(float(18.5).sub(Wp.x), 0, 1), clamp(Wp.z.sub(15.5), 0, 1)), 0, 0, 0);
  const wobble = (Wp: N): N => vnoise2(vec2(Wp.x.mul(0.9).add(Wp.y.mul(0.2)), Wp.z.mul(0.9).add(Wp.y.mul(0.7)))).sub(0.5).mul(0.9);

  /** (height, tone, kind: 0 laid, 1 rock, 2 circle, 3 frieze; flag: 1 joint or crack, 2 carved rune) and the laid block's centre in the world, at the surface pixel `q + (dx, dy)`. */
  const sample = (dx: number, dy: number): { v: N; centre: N } => {
    const sq = q.add(vec2(dx, dy));
    const l = laid(sq, bw, bh, seed);
    const r = rock(sq, cell, stretch, seed);
    const centreW = P.add(T.mul(l.z.sub(q.x.add(0.5)).div(RES))).add(B.mul(l.w.sub(q.y.add(0.5)).div(RES)));
    // A block is laid when its centre is on the laid side of the wobbling border, so blocks stay whole.
    const isRock = kindAt(centreW).r.add(wobble(centreW)).greaterThan(0.5);
    // The rock floor is flatter than a rock wall, so it reads as ground to walk on.
    const rh = r.x.mul(mix(float(0.4), float(1), wall));
    const base = vec4(select(isRock, rh, l.x), select(isRock, r.y, l.y), select(isRock, float(1), float(0)), select(isRock, r.z, select(l.x.lessThan(0.03), float(1), float(0))));
    // The circle replaces the floor inside its radius.
    const Ps = P.add(T.mul(float(dx).div(RES))).add(B.mul(float(dy).div(RES)));
    const pd: N = Ps.xz.sub(STONE_SPIKE.circle).mul(16);
    const cs = circleStone(pd, float(16).div(RES), circleR16);
    const inCircle = onFloor.and(cs.z.greaterThan(-0.5));
    // The frieze: a carved band of square blocks round every laid wall, 1.25 to 1.5 tiles up.
    const fy = sq.y.div(unit).sub(20), fx = mod(sq.x.div(unit), 8);
    const inFrieze = up.not().and(isRock.not()).and(fy.greaterThanEqual(0)).and(fy.lessThan(4));
    const fJoint = fx.lessThan(float(1).div(unit)).or(fy.lessThan(float(1).div(unit))).or(fy.greaterThanEqual(float(4).sub(float(1).div(unit))));
    const dia = abs(fx.sub(4.25)).add(abs(fy.sub(2)));
    const fCarve = dia.greaterThan(0.7).and(dia.lessThan(1.5));
    const fr = vec4(select(fJoint, float(0.35), select(fCarve, float(0.45), float(1))), float(0.5), float(3), select(fCarve, float(1), float(0)));
    // The mosaic: small tesserae in diamond bands of three colours inside a dark border. The tone slot carries the colour (0..3).
    const tess = max(floor(unit.mul(1.5)), 1);
    const mp: N = floor(Ps.xz.sub(vec2(MOSAIC.x, MOSAIC.z)).mul(RES));
    const mi: N = floor(mp.div(tess));
    const inMosaic = onFloor.and(abs(Ps.x.sub(MOSAIC.x)).lessThan(MOSAIC.hx)).and(abs(Ps.z.sub(MOSAIC.z)).lessThan(MOSAIC.hz));
    const grout = mod(mp.x, tess).lessThan(0.5).or(mod(mp.y, tess).lessThan(0.5));
    const edgeDist = min(float(MOSAIC.hx).sub(abs(Ps.x.sub(MOSAIC.x))), float(MOSAIC.hz).sub(abs(Ps.z.sub(MOSAIC.z)))).mul(RES).div(tess);
    const band = select(edgeDist.lessThan(2), float(3), select(edgeDist.lessThan(3), float(1), mod(floor(abs(mi.x.add(0.5)).add(abs(mi.y.add(0.5))).div(3)), 3)));
    const mo = vec4(select(grout, float(0.45), float(0.75).add(hash21(mi).mul(0.2))), band.add(hash21(mi.add(3.3)).mul(0.9)), float(4), float(0));
    // The drain grate: an iron frame with bars over a black hole.
    const gp: N = Ps.xz.sub(vec2(GRATE.x, GRATE.z));
    const inGrate = onFloor.and(abs(gp.x).lessThan(GRATE.half)).and(abs(gp.y).lessThan(GRATE.half));
    const gFrame = max(abs(gp.x), abs(gp.y)).greaterThan(GRATE.half - 0.0625);
    const gBar = mod(gp.x.add(GRATE.half).mul(16), 3).lessThan(1.5);
    const gr = vec4(select(gFrame.or(gBar), float(1), float(0)), float(0.5), float(5), select(gFrame.or(gBar), float(0), float(1)));
    const v = BISECT ? select(inCircle, vec4(cs.x, cs.y, float(2), cs.w), select(inFrieze, fr, base)) : select(inCircle, vec4(cs.x, cs.y, float(2), cs.w), select(inMosaic, mo, select(inGrate, gr, select(inFrieze, fr, base))));
    return { v, centre: centreW };
  };
  const cS = sample(0, 0);
  const c = cS.v;
  // Forward differences: three samples per pixel, not five (the shader is near what the WebGL path of the dev notebook's card compiles).
  const e = sample(1, 0).v, s4 = sample(0, 1).v;
  const hx = e.x.sub(c.x);
  const hy = s4.x.sub(c.x);
  const nearGap = max(e.w, s4.w);
  const normal = normalize(n.sub(T.mul(hx).add(B.mul(hy)).mul(STONE_SPIKE.depth.mul(1.6))));

  const isRock = c.z.greaterThan(0.5).and(c.z.lessThan(1.5));
  const isCircle = c.z.greaterThan(1.5).and(c.z.lessThan(2.5));
  const isFrieze = c.z.greaterThan(2.5).and(c.z.lessThan(3.5));
  const isMosaic = c.z.greaterThan(3.5).and(c.z.lessThan(4.5));
  const isGrate = c.z.greaterThan(4.5);
  const isLaid = c.z.lessThan(0.5);
  // A laid block's tone slot also carries its edge mark (+ 2 sunk, + 4 raised).
  const mark = select(isLaid, floor(c.y.div(2)), float(0));
  const t01 = select(isLaid, mod(c.y, 2), select(isMosaic, fract(c.y), c.y));
  const tone = float(0.8).add(floor(t01.mul(4)).div(3).mul(0.34));
  const warm = mix(vec3(1.06, 1, 0.93), vec3(0.94, 1, 1.07), fract(t01.mul(7.13)));
  // Laid blocks come in three stones: the brown one, a grey one and a sandstone.
  const pick = fract(t01.mul(13.7));
  const laidBase = mix(vec3(0.4, 0.38, 0.37), vec3(0.6, 0.5, 0.42), wall);
  const laidCol = select(pick.lessThan(0.27), mix(vec3(0.36, 0.37, 0.4), vec3(0.47, 0.47, 0.5), wall), select(pick.greaterThan(0.76), mix(vec3(0.58, 0.48, 0.33), vec3(0.74, 0.6, 0.4), wall), laidBase));
  const mIdx = floor(c.y);
  const mosaicCol = select(mIdx.lessThan(0.5), vec3(0.62, 0.28, 0.18), select(mIdx.lessThan(1.5), vec3(0.78, 0.7, 0.52), select(mIdx.lessThan(2.5), vec3(0.22, 0.3, 0.42), vec3(0.16, 0.14, 0.14))));
  const rockCol = mix(vec3(0.4, 0.37, 0.35), vec3(0.52, 0.47, 0.44), wall);
  // The circle: dark basalt and pale limestone, ring by ring.
  const ringIdx = circleStone(P.xz.sub(STONE_SPIKE.circle).mul(16), float(16).div(RES), circleR16).z;
  const circleCol = select(mod(ringIdx, 2).greaterThan(0.5), vec3(0.27, 0.29, 0.36), vec3(0.6, 0.56, 0.48));
  const baseCol = select(isCircle, circleCol, select(isFrieze, vec3(0.66, 0.58, 0.47), select(isMosaic, mosaicCol, select(isGrate, vec3(0.2, 0.18, 0.18), select(isRock, rockCol, laidCol)))));
  // Veins of pale quartz run through the rock in a few places.
  const veinLine = abs(vnoise2(s0.div(cell.mul(3.1)).add(seed.add(50))).sub(0.5)).lessThan(0.012);
  const vein = isRock.and(veinLine).and(vnoise2(s0.div(cell.mul(6)).add(seed.add(80))).greaterThan(0.63));
  const edgeShade = select(mark.greaterThan(1.5), float(1.22), select(mark.greaterThan(0.5), float(0.62), float(1)));
  const stoneCol0 = baseCol.mul(tone).mul(warm).mul(float(0.6).add(c.x.mul(0.4))).mul(edgeShade);
  const stoneCol = select(vein, vec3(0.8, 0.76, 0.62), stoneCol0);
  // A joint is mortar; a crack (in rock, or through a laid block) and a carving are the stone in shadow.
  const mortar = c.w.greaterThan(0.5).and(c.w.lessThan(1.5)).and(isRock.not()).and(isFrieze.not()).and(isGrate.not()).and(c.x.lessThan(0.01));
  const gapCol = select(isGrate, vec3(0.01, 0.01, 0.015), select(mortar, vec3(0.2, 0.17, 0.16), stoneCol.mul(0.42)));
  const bare = mix(stoneCol, gapCol, select(c.w.greaterThan(0.5), float(1), float(0)));
  // Moss in damp patches: it fills the joints and cracks there and creeps onto some pixels beside them; more of it low on a wall.
  const damp = vnoise2(P.xz.mul(0.8).add(vec2(P.y.mul(0.7), 3.1))).add(wall.mul(clamp(float(0.6).sub(P.y), 0, 0.6)).mul(0.25));
  const creep = nearGap.greaterThan(0.5).and(hash21(q.add(vec2(seed, 5))).lessThan(0.4));
  const mossy = damp.greaterThan(0.66).and(isCircle.not()).and(isFrieze.not()).and(isMosaic.not()).and(isGrate.not()).and(c.w.greaterThan(0.5).or(creep));
  const mossCol = mix(vec3(0.17, 0.3, 0.12), vec3(0.3, 0.43, 0.17), hash21(q.add(vec2(3, seed))));
  const body = mix(bare, mossCol, select(mossy, float(1), float(0)));

  // A crack in the floor: black, with the mask's hard edge.
  const inCrack = wp.y.lessThan(0.05).and(texture(CRACK_TEX, P.xz.div(MAP_SIZE)).level(0).r.greaterThan(0.5));
  // A puddle stands in a basin of the rock floor: dark still water, and now and then a drop from the ceiling sends a ring across it.
  const wet = up.and(wp.y.lessThan(-0.038)).and(inCrack.not()).and(isRock);
  const pc: N = floor(P.xz.mul(1.3));
  const drop: N = pc.add(vec2(0.2, 0.2)).add(hash22(pc).mul(0.6)).div(1.3);
  const phase = fract(time.div(float(2.2).add(hash21(pc.add(4.1)).mul(2.5))).add(hash21(pc)));
  const ringD = abs(length(P.xz.sub(drop)).sub(phase.mul(0.42)));
  const ring = select(ringD.lessThan(float(0.7).div(RES)).and(phase.lessThan(0.75)), float(1).sub(phase.div(0.75)), float(0));
  const water = vec3(0.07, 0.1, 0.13).add(vec3(0.3, 0.36, 0.4).mul(ring));
  const glow = vec3(0, 0, 0);
  // A wall top is the same stone seen from above, cooler and darker, so it still reads as the top.
  const topped = mix(body, body.mul(vec3(0.5, 0.47, 0.62)), select(isTop, float(1), float(0)));
  const albedo = select(inCrack, vec3(0.012, 0.012, 0.016), select(wet, water, topped));
  const flat = select(wet, float(1), float(0));
  return { albedo, normal: normalize(mix(normal, n, flat)), P, rock: isRock, glow };

}

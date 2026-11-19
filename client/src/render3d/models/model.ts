// The assembled 3D model of a figure (#338): the base parts, the add-ons, the legs and arms of one description, flattened into
// one vertex stream in the figure's rest pose (sprite pixels, the front along +x, the feet at y 0). Every vertex names the bone
// that moves it, and `pivots` / `parents` say where the bones turn, so the pose can rebuild the page's scene graph from them.
// Plain typed arrays (no three.js objects), so it runs in a Web Worker and under node.

import { armMesh, band, hatParts, hull, legMesh, ring, shell, spike } from './addons';
import type { FigureDesc, PartRef } from './desc';
import { skelet } from './descs/skelet';
import { FH } from './grid';
import { buildPart, type Mesh3 } from './part';
import type { SpectreSpec } from './tubeDesc';

import { BONES, MAX_BENDS, MAX_BONES, STAGES, type Bone, type Stage } from './bones';

// The names live in bones.ts (no builder code); re-exported so the builder's importers keep working.
export { BONES, MAX_BENDS, MAX_BONES, STAGES };

/** A run of triangles of `FigureModel.index`: the hulls (`line`) or the pieces of one stage. */
export interface ModelRange { stage: number; line: boolean; start: number; count: number }

/**
 * A loose piece (beard, plume, quiff, mane, tail) that bends: each point turns about `origin` (the fixed end, rest pose) by more
 * the further along `dir` it lies (`skin.w`, 0 to 1 over `len`); `k` is the page's sway, `up` which way it trails, `wag` how much it wags.
 */
export interface BendDef {
  bone: number; origin: [number, number, number]; dir: [number, number, number]; len: number; k: number; up: 1 | -1; wag: number;
  /** A tube model's neck: it bends as a whole about `origin`, more the nearer the head (`skin.w`). */
  neck?: true;
  /** The bend also flutters (a wing, a pennant): `rate` in Hz, `angle` in rad at the tip; `axis` (a unit vector, rest pose) is what the beat turns about, absent: x, the two sides opposite ways. */
  flutter?: { rate: number; angle: number; axis?: readonly [number, number, number] };
}

export interface FigureModel {
  key: string;
  position: Float32Array; normal: Float32Array; uv: Float32Array; // uv into `paint`
  /** 4 per vertex: bone index, 1 on a hull vertex (written, but no shader reads it today), bend index (-1 none, -2 the robe), how far along the bend (0..1; the robe's weight). */
  skin: Float32Array;
  /** 4 per vertex: r, g, b (sRGB, 0 to 1) of a flat colour, or -1 to read the paint; then 0 lit, 1 polished steel, 2 unlit (the seams), 3 glowing (its own colour in any light: a tube model's `glow` pieces). */
  look: Float32Array;
  index: Uint32Array; ranges: ModelRange[];
  pieceIndex: Uint32Array; lineIndex: Uint32Array; // the same triangles as two unbroken lists (the piece index serves the piece, id and sun draws; the line index serves the hull)
  pivots: Float32Array; // MAX_BONES x 3: where each bone turns, sprite px
  parents: Int8Array;   // MAX_BONES: hips -1, body 0, head 1, hat 2, arms 1, hands their arm, legs 0, weapons their hand
  bends: BendDef[]; robeTop: number | null;
  paint: { w: number; h: number; data: Uint8Array };
  /** Sprite px from the ground to the top of the head part, times `scale`: add-ons do not count. */
  baseHeight: number;
  /** Tiles: the largest reach from the foot axis, add-ons and the stretched arm included (a held weapon is not known here). */
  radius: number;
  /** How much the hat rocks (the description's `hat.sway`; 0 without a hat). */
  hatSway: number;
  /** The description's `size`: how big the model is against its card (1 = as tall). The model path scales the card's weapon, anchors, shadow and light caster by it. */
  size: number;
  shoulderY: number; handY: number; armLength: number; armRadius: number; quad: boolean; scale: number; hipY: number; neck: [number, number];
  // The fields below are set by tube models (tubeModel.ts) only.
  /** The legs as bone indices (`lower` -1: none), front legs first. */
  legs?: { upper: number; lower: number; front: boolean; /** 1 (default) or -1: the knee bends the other way. */ knee?: 1 | -1 }[];
  /** 'walk': the legs swing in turn (two-legged tube models). */
  gait?: 'walk' | 'float';
  /** 'float' only: a melee swings the arm from its limp hang. */
  swipe?: true;
  /** The description's spectre look (the Ghost, the Shade). */
  spectre?: SpectreSpec;
  /** A factor on the size of the held weapon (default 1). */
  weaponScale?: number;
  /** The share of a blow's arm lengthening this model takes (default 1: the whole of it, as the short-armed figures). */
  armStretch?: number;
  /** The upper arm's length, model px: the hand bones turn about an elbow that far below the shoulders (their pivots), and carry the forearms. */
  elbow?: number;
  /** With an elbow: how far forward (rad) the forearm of an empty hand is held (the description's `arms.free`); absent: `ELBOW.free`. */
  elbowFree?: number;
  /** With an elbow: in a shot the bow arm points straight ahead from its shoulder (the description's `arms.bowAhead`). */
  bowAhead?: true;
  /** How high the model hops, in model px per unit of the hop. */
  hop?: number;
  /** The index in `bends` of the neck. */
  neckBend?: number;
  /** Some piece is on the hat bone (antlers): the animal butts. */
  butt?: boolean;
  /** Size, coat tone and the like vary from one animal to the next. */
  varies?: boolean;
  /** Standing height in model px (the highest point of the pieces, the hulls not counted). */
  stands?: number;
  /** Half length and half width of the ground oval, model px. */
  footprint?: [number, number];
}

/** The triangles of `index` as two unbroken lists: the pieces' and the hulls' (copied into preallocated arrays: no spread, so no call-stack limit). */
export function splitIndex(index: Uint32Array, ranges: ModelRange[]): { pieceIndex: Uint32Array; lineIndex: Uint32Array } {
  let lines = 0;
  for (const r of ranges) if (r.line) lines += r.count;
  const lineIndex = new Uint32Array(lines), pieceIndex = new Uint32Array(index.length - lines);
  let l = 0, p = 0;
  for (const r of ranges) {
    const part = index.subarray(r.start, r.start + r.count);
    if (r.line) { lineIndex.set(part, l); l += r.count; } else { pieceIndex.set(part, p); p += r.count; }
  }
  return { pieceIndex, lineIndex };
}

const stageOf =(n: Stage): number => STAGES.indexOf(n);
const boneOf = (n: Bone): number => BONES.indexOf(n);
const rgb = (hex: number): [number, number, number] => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** One mesh of the figure: where it hangs, how it is coloured, and what it bends or sways with. */
interface Piece {
  stage: number;
  line: boolean;
  mesh: Mesh3;
  bone: number;
  /** Added to every point (the placement the page gives the piece's group). */
  at: [number, number, number];
  /** A flat colour, or null to read the paint of part `paint`. */
  flat: [number, number, number] | null;
  paint: 0 | 1;
  steel: boolean;
  /** Not shaded (the seams). */
  unlit?: boolean;
  bend: number;
  robe: boolean;
}

function figurePieces(d: FigureDesc): { pieces: Piece[]; bends: BendDef[]; pivots: Float32Array; parents: Int8Array; head: ReturnType<typeof buildPart>; body: ReturnType<typeof buildPart>; hipY: number; neck: [number, number]; handY: number; robeTop: number | null } {
  const cx = d.centre, pow = d.parts[0].pow || 1, bpow = 1;   // the head may be squarer than the body; hair, shells, collar and seams follow the head's
  const head = buildPart(d, 0), body = buildPart(d, 1);
  const hipY = FH - (d.legs ? d.legs.top : 25) + 1, neckY = d.neck ? FH - d.neck[1] : FH - d.parts[0].rows![1], neckX = d.neck ? d.neck[0] : 0, headAt = d.headAt || 0;
  const pieces: Piece[] = [], bends: BendDef[] = [];
  const pivots = new Float32Array(MAX_BONES * 3), parents = new Int8Array(MAX_BONES);
  const pivot = (b: Bone, x: number, y: number, z: number): void => { pivots.set([x, y, z], boneOf(b) * 3); };
  // Whatever hangs on the head turns about the neck; the page moves it (in x) so that the head sits `headAt` in front of the body's middle.
  const onHead = [headAt, 0, 0] as [number, number, number], none = [0, 0, 0] as [number, number, number];
  const col = (c: string): [number, number, number] => rgb(d.colours[c]);

  const add = (stage: Stage, mesh: Mesh3, w: number, bone: Bone, at: [number, number, number], flat: [number, number, number] | null, o: { paint?: 0 | 1; steel?: boolean; bend?: number; robe?: boolean } = {}): void => {
    const base = { stage: stageOf(stage), bone: boneOf(bone), at, flat, paint: o.paint ?? 0, steel: !!o.steel, bend: o.bend ?? -1, robe: !!o.robe };
    pieces.push({ ...base, line: true, mesh: hull(mesh, w), flat: rgb(d.outline), steel: false });
    pieces.push({ ...base, line: false, mesh });
  };

  // The base parts. A part may bring its own paint (and is then not polished); the robe is the body of an open part.
  const parts = [head, body];
  parts.forEach((p, i) => {
    const own = !!d.parts[i].side;
    add(i ? 'body' : 'head', p.mesh, 0.45, i ? 'body' : 'head', i ? none : onHead, null, { paint: i as 0 | 1, steel: !!d.metal && !own, robe: !!i && !!d.parts[1].open });
  });
  const geos: Partial<Record<PartRef, Mesh3>> = { head: head.mesh, body: body.mesh };
  // How far a piece reaches forwards (0) or sideways (2) at a sprite row.
  const reach = (name: PartRef, row: number, axis: 0 | 2): number => {
    const m = geos[name];
    if (!m) throw new Error(`${d.name}: nothing called ${name} to measure from`);
    const y = FH - row;
    let r = 0;
    for (let i = 0; i < m.position.length; i += 3) if (Math.abs(m.position[i + 1] - y) < 0.5) r = Math.max(r, m.position[i + axis]);
    return r;
  };

  if (d.hair) {
    geos.hair = shell(head.rows, cx, pow, d.hair);
    add('hair', geos.hair, 0.4, 'head', onHead, col(d.hair.colour));
  }
  // Further layers round the head, like a beard along the jaw.
  for (const s of d.shells || []) add('hair', shell(head.rows, cx, pow, s), s.line || 0.4, 'head', onHead, col(s.colour));
  if (d.collar) add('collar', band(body.rows, cx, pow, d.collar), 0.3, 'body', none, col(d.collar.colour));
  // A dark line between two parts of the base is a thin ring of its own, unlit, in the outline colour (a hull only draws round a piece's outer edge).
  for (const s of d.seams || []) {
    pieces.push({ stage: stageOf('collar'), bone: boneOf('body'), at: none, flat: rgb(d.outline), paint: 0, steel: false, unlit: true, bend: -1, robe: false, line: false, mesh: ring(body.rows, cx, pow, { row: s.row, like: s.like, out: -0.1, thick: 0.4, high: 0.35 }) });
  }
  // Rings round the body that stand clear of it, like ribs round a spine.
  for (const s of d.rings || []) add('collar', ring(body.rows, cx, bpow, s), s.line || 0.3, 'body', none, col(s.colour));

  if (d.hat) {
    const H = d.hat, h = hatParts(H), y = FH - H.row;
    add('hat', h.brim, 0.4, 'hat', onHead, col(H.colour));
    add('hat', h.cone, 0.4, 'hat', onHead, col(H.colour));
    add('hat', h.band, 0.12, 'hat', onHead, col(H.band));
    pivot('hat', headAt, y, 0);   // the whole hat is one loose piece that rocks about the top of the head
  }

  for (const s of d.spikes || []) {
    const on: Bone = s.on || 'head', sink = s.sink === undefined ? 0.8 : s.sink;
    for (const sd of s.side ? [1, -1] : [1]) {
      const dir: [number, number, number] = [s.dir[0], s.dir[1], s.dir[2] * sd], g = spike(s, dir);
      const x = s.front ? reach(s.front.of, s.row, 0) - s.front.inset : s.x || 0, z = s.side ? sd * (reach(s.side.of, s.row, 2) - s.side.inset) : 0;
      const at: [number, number, number] = [x + (on === 'head' ? headAt : 0), FH - s.row, z];
      let bend = -1;
      if (s.sway) {
        const l = Math.hypot(...dir);
        bend = bends.length;
        bends.push({ bone: boneOf(on), origin: at, dir: [dir[0] / l, dir[1] / l, dir[2] / l], len: s.length - sink, k: s.sway, up: s.dir[1] > 0 ? 1 : -1, wag: s.wag || 0 });
      }
      add('spikes', g, s.line || 0.4, on, at, col(s.colour), { bend });
    }
  }

  if (d.legs) {
    const L = d.legs, g = legMesh(L, hipY);
    let n = 0;
    for (const lx of L.at || [0]) for (const sd of [1, -1]) {
      const bone = `leg${n++}` as Bone;
      add('legs', g, 0.4, bone, [lx, hipY, sd * L.apart], col(L.colour));
      pivot(bone, lx, hipY, sd * L.apart);
    }
  }

  let handY = 0;
  if (d.arms) {
    const A = d.arms, y = FH - A.row, z = reach('body', A.row + 1.5, 2) + A.radius * 0.55 + (A.out || 0), m = armMesh(A);
    handY = -A.length + A.radius * 0.8;
    for (const sd of [1, -1]) {
      const s = sd === 1 ? 'R' : 'L', at: [number, number, number] = [0, y, sd * z];
      add('arms', m.arm, 0.4, `arm${s}`, at, col(A.colour), { steel: !!A.metal });
      add('arms', m.hand, 0.4, `hand${s}`, at, col(A.hand), { steel: !!A.metal });
      for (const b of [`arm${s}`, `hand${s}`] as Bone[]) pivot(b, 0, y, sd * z);
      pivot(`weapon${s}`, 0, y + handY, sd * z);   // a weapon lies in the hand, `handY` below the shoulder
    }
  }

  pivot('body', 0, hipY, 0);
  pivot('head', neckX, neckY, 0);
  const parent: Record<Bone, Bone | null> = { hips: null, body: 'hips', head: 'body', hat: 'head', armR: 'body', handR: 'armR', armL: 'body', handL: 'armL', leg0: 'hips', leg1: 'hips', leg2: 'hips', leg3: 'hips', weaponR: 'handR', weaponL: 'handL' };
  for (const b of BONES) parents[boneOf(b)] = parent[b] ? boneOf(parent[b]!) : -1;

  const robeTop = d.parts[1].open ? FH - (d.parts[1].taper ? d.parts[1].taper.from : (d.parts[1].rows || [0])[0]) : null;
  if (bends.length > MAX_BENDS) throw new Error(`${d.name}: ${bends.length} bending pieces, at most ${MAX_BENDS} fit the GPU's bend array`);
  return { pieces, bends, pivots, parents, head, body, hipY, neck: [neckX, neckY], handY, robeTop };
}

/** How a point is moved after placing it (the skull is tipped), or nothing. */
interface Place { pos(p: [number, number, number]): [number, number, number]; nor(n: [number, number, number]): [number, number, number] }

function assemble(key: string, d: FigureDesc, built: ReturnType<typeof figurePieces>, only: ((p: Piece) => boolean) | null, place: Place | null, height?: number): FigureModel {
  const { bends, robeTop } = built;
  // Draw order: by stage, the hulls first (the sort is stable, so the page's order within a stage stays).
  const pieces = built.pieces.filter((p) => !only || only(p)).sort((a, b) => a.stage - b.stage || Number(b.line) - Number(a.line));
  let n = 0;
  for (const p of pieces) n += p.mesh.position.length / 3;
  const position = new Float32Array(n * 3), normal = new Float32Array(n * 3), uv = new Float32Array(n * 2), skin = new Float32Array(n * 4), look = new Float32Array(n * 4);
  const all: number[] = [], ranges: ModelRange[] = [];
  // The paint: one for the figure, or the head's above the body's when the two bring their own.
  const [pa, pb] = [built.head.paint, built.body.paint];
  const same = pa.w === pb.w && pa.h === pb.h && pa.data.every((v, i) => v === pb.data[i]);
  const paint = same ? { w: pa.w, h: pa.h, data: pa.data } : { w: pa.w, h: pa.h * 2, data: Uint8Array.from([...pa.data, ...pb.data]) };
  let v0 = 0;
  for (const p of pieces) {
    const m = p.mesh, c = m.position.length / 3, last = ranges[ranges.length - 1];
    if (last && last.stage === p.stage && last.line === p.line) last.count += m.index.length;
    else ranges.push({ stage: p.stage, line: p.line, start: all.length, count: m.index.length });
    for (const i of m.index) all.push(v0 + i);
    const B = p.bend >= 0 ? bends[p.bend] : null;
    for (let i = 0; i < c; i++) {
      const o = v0 + i;
      const lx = m.position[i * 3], ly = m.position[i * 3 + 1], lz = m.position[i * 3 + 2];
      let P: [number, number, number] = [lx + p.at[0], ly + p.at[1], lz + p.at[2]], N: [number, number, number] = [m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2]];
      if (place) { P = place.pos(P); N = place.nor(N); }
      position.set(P, o * 3); normal.set(N, o * 3);
      let along = 0, bendIdx = p.bend;
      if (B) along = Math.max(0, Math.min(1, (lx * B.dir[0] + ly * B.dir[1] + lz * B.dir[2]) / B.len));
      else if (p.robe && robeTop !== null) {
        const g = Math.max(0, Math.min(1, (robeTop - ly) / robeTop));   // 0 at the chest, 1 at the hem
        bendIdx = -2; along = g * g * (3 - 2 * g);
      }
      skin.set([p.bone, p.line ? 1 : 0, bendIdx, along], o * 4);
      const mat = p.unlit ? 2 : p.steel ? 1 : 0;
      if (p.flat) look.set([...p.flat, mat], o * 4); else look.set([-1, -1, -1, mat], o * 4);
      if (!p.flat && m.uv) {
        const u = m.uv[i * 2], v = m.uv[i * 2 + 1];
        uv[o * 2] = u; uv[o * 2 + 1] = same ? v : p.paint === 0 ? 0.5 + v / 2 : v / 2;
      }
    }
    v0 += c;
  }
  const index = Uint32Array.from(all);
  const { pieceIndex, lineIndex } = splitIndex(index, ranges);
  // The base height: the head part's top; the radius: the furthest point from the foot axis, plus the arm stretched to 2.3 times.
  let top = 0, reachPx = 0;
  for (let i = 0; i < built.head.mesh.position.length; i += 3) top = Math.max(top, built.head.mesh.position[i + 1]);
  for (let i = 0; i < n; i++) if (skin[i * 4 + 1] === 0) reachPx = Math.max(reachPx, Math.hypot(position[i * 3], position[i * 3 + 2]));
  // The fit: the standing figure (every piece, the outline hulls included; not a weapon) is `height` px tall once scaled.
  let full = 0;
  for (let i = 1; i < n * 3; i += 3) full = Math.max(full, position[i]);
  // `size` is a share of the target: without a fit (no target, or an unusable one; the skull) there is nothing to take a share of,
  // so the scale is 1 and the size recorded is the one applied: 1.
  const fitted = height !== undefined && height > 0 && full > 0;
  const size = fitted ? d.size ?? 1 : 1;
  const scale = fitted ? (height * size) / full : 1, armLength = d.arms ? d.arms.length : 0;
  return {
    key, position, normal, uv, skin, look, index, ranges,
    pieceIndex, lineIndex,
    pivots: built.pivots, parents: built.parents, bends: only ? [] : bends, robeTop,
    paint,
    baseHeight: top * scale,
    radius: (reachPx + armLength * 2.3) / 16 * scale,
    shoulderY: d.arms ? FH - d.arms.row : built.neck[1] + 1, handY: built.handY, armLength, armRadius: d.arms ? d.arms.radius : 0,
    hatSway: d.hat ? d.hat.sway ?? 0 : 0,
    quad: !!d.quad, scale, size, hipY: built.hipY, neck: built.neck,
  };
}

/**
 * The 3D model of the figure a description tells of. `height` (sprite px, the target): the model's `scale` is fitted so that its full
 * standing height times `scale` equals the target times the description's `size`; without one (tests, node) `scale` and `size` are 1.
 */
export function buildFigure(key: string, d: FigureDesc, height?: number): FigureModel {
  return assemble(key, d, figurePieces(d), null, null, height);
}

/**
 * What a fallen figure leaves: the skeleton's skull (the head pieces alone) tipped as on the page (turned 0.15, 0, 0.22 radians,
 * lifted 0.9), on one bone (the hips) with the pivot at the origin.
 */
export function buildSkull(): FigureModel {
  const built = figurePieces(skelet), head = boneOf('head');
  const [px, py] = [built.pivots[head * 3], built.pivots[head * 3 + 1]];
  // Three's XYZ order: the vector is turned about z first, then y, then x.
  const rx = Math.cos(0.15), sx = Math.sin(0.15), rz = Math.cos(0.22), sz = Math.sin(0.22);
  const turn = ([x, y, z]: [number, number, number]): [number, number, number] => {
    const x1 = x * rz - y * sz, y1 = x * sz + y * rz;
    return [x1, y1 * rx - z * sx, y1 * sx + z * rx];
  };
  const place: Place = { pos: ([x, y, z]) => { const [a, b, c] = turn([x - px, y - py, z]); return [a, b + 0.9, c]; }, nor: turn };
  const m = assemble('skull', skelet, built, (p) => p.bone === head && p.bend < 0 && !p.robe, place);
  // One bone for the whole skull.
  for (let i = 0; i < m.skin.length; i += 4) m.skin[i] = 0;
  m.pivots = new Float32Array(MAX_BONES * 3);
  m.parents = new Int8Array(MAX_BONES).fill(-1);
  return m;
}

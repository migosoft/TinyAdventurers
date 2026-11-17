// The builder of the tube models (#357): the pieces of a `TubeDesc` flattened into one `FigureModel`, in the rest pose (page px,
// the front along +x, the feet at y 0). Same streams, bones and bends as the figure builder in model.ts. Pure typed arrays.

import { hull } from './addons';
import { BONES, MAX_BENDS, MAX_BONES, STAGES, type Bone } from './bones';
import { splitIndex, type BendDef, type FigureModel, type ModelRange } from './model';
import type { Mesh3 } from './part';
import type { Shape, TubeDesc, TubePiece } from './tubeDesc';
import { ball, drop, tube } from './tubes';

/** The Dire Wolf model's fitted `scale` (card height 19 px x size 0.87 / full height 15.226 px): one page px in game px at size 1. */
export const PAGE_TO_GAME = 1.0856;

const PAINT_W = 128, PAINT_H = 64;
const rgb = (hex: number): [number, number, number] => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

function meshOf(s: Shape): Mesh3 {
  if ('tube' in s) return tube(s.tube, s.opts);
  if ('ball' in s) return ball(s.ball[0], s.ball[1], s.ball[2], s.pow, s.turnZ);
  return drop(s.drop.r, s.drop.len, s.drop.sink, s.drop.wide, s.drop.dir);
}

/** The mesh turned about z (positions and normals); the same mesh when the angle is 0. */
function turned(m: Mesh3, a: number | undefined): Mesh3 {
  if (!a) return m;
  const c = Math.cos(a), s = Math.sin(a), position = new Float32Array(m.position), normal = new Float32Array(m.normal);
  for (const arr of [position, normal]) for (let i = 0; i < arr.length; i += 3) { const x = arr[i], y = arr[i + 1]; arr[i] = x * c - y * s; arr[i + 1] = x * s + y * c; }
  return { position, normal, uv: m.uv, index: m.index };
}

/** The direction and length a loose piece sways along: a drop's own, or a tube's first point to its last. */
function swayAxis(name: string, s: Shape): { dir: [number, number, number]; len: number } {
  if ('drop' in s) {
    const [x, y, z] = s.drop.dir, l = Math.hypot(x, y, z);
    return { dir: [x / l, y / l, z / l], len: s.drop.len - s.drop.sink };
  }
  if ('tube' in s) {
    const a = s.tube[0].p, b = s.tube[s.tube.length - 1].p, d = [b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0)], l = Math.hypot(d[0], d[1], d[2]);
    return { dir: [d[0] / l, d[1] / l, d[2] / l], len: l };
  }
  throw new Error(`${name}: a ball cannot sway`);
}

interface Built { piece: TubePiece; stage: number; line: boolean; mesh: Mesh3; uv: Float32Array | null; bend: number }

function check(d: TubeDesc): void {
  const bending = d.pieces.filter((p) => p.bend).length;
  if (bending > MAX_BENDS) throw new Error(`${d.name}: ${bending} bending pieces, at most ${MAX_BENDS} fit the GPU's bend array`);
  if (d.pieces.filter((p) => typeof p.colour === 'function').length > 1) throw new Error(`${d.name}: more than one painted piece`);
  for (const [child, parent] of Object.entries(d.parents) as [Bone, Bone][]) {
    if (BONES.indexOf(parent) >= BONES.indexOf(child)) throw new Error(`${d.name}: the parent ${parent} of ${child} must come before it in BONES`);
  }
}

export function buildTubeFigure(key: string, d: TubeDesc): FigureModel {
  check(d);
  const scale = d.size * PAGE_TO_GAME, bends: BendDef[] = [], built: Built[] = [];
  for (const p of d.pieces) {
    const src = turned(meshOf(p.shape), p.turn), at = p.at ?? [0, 0, 0];
    let bend = -1;
    if (p.bend) {
      bend = bends.length;
      if ('neck' in p.bend) bends.push({ bone: BONES.indexOf(p.bone), origin: [p.bend.neck.origin[0], p.bend.neck.origin[1], 0], dir: [0, 1, 0], len: 1, k: 0, up: 1, wag: 0, neck: true });
      else {
        const { dir, len } = swayAxis(d.name, p.shape);
        bends.push({ bone: BONES.indexOf(p.bone), origin: [at[0], at[1], at[2]], dir, len, k: p.bend.sway, up: dir[1] > 0 ? 1 : -1, wag: p.bend.wag ?? 0 });
      }
    }
    const stage = STAGES.indexOf(p.stage);
    if (p.line > 0) built.push({ piece: p, stage, line: true, mesh: hull(src, p.line / d.size), uv: src.uv, bend });
    built.push({ piece: p, stage, line: false, mesh: src, uv: src.uv, bend });
  }
  // Draw order: by stage, the hulls first (the sort is stable).
  built.sort((a, b) => a.stage - b.stage || Number(b.line) - Number(a.line));

  let n = 0;
  for (const b of built) n += b.mesh.position.length / 3;
  const position = new Float32Array(n * 3), normal = new Float32Array(n * 3), uv = new Float32Array(n * 2), skin = new Float32Array(n * 4), look = new Float32Array(n * 4);
  const all: number[] = [], ranges: ModelRange[] = [], outline = rgb(d.outline);
  let v0 = 0, stands = 0, headTop = 0, reach = 0;
  for (const b of built) {
    const m = b.mesh, c = m.position.length / 3, p = b.piece, at = p.at ?? [0, 0, 0], boneIdx = BONES.indexOf(p.bone), last = ranges[ranges.length - 1];
    if (last && last.stage === b.stage && last.line === b.line) last.count += m.index.length;
    else ranges.push({ stage: b.stage, line: b.line, start: all.length, count: m.index.length });
    for (const i of m.index) all.push(v0 + i);
    const B = b.bend >= 0 ? bends[b.bend] : null, painted = typeof p.colour === 'function';
    const flat = b.line ? outline : rgb(painted ? 0 : (p.colour as number));
    for (let i = 0; i < c; i++) {
      const o = v0 + i, lx = m.position[i * 3], ly = m.position[i * 3 + 1], lz = m.position[i * 3 + 2];
      const x = lx + at[0], y = ly + at[1], z = lz + at[2];
      position.set([x, y, z], o * 3);
      normal.set([m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2]], o * 3);
      let along = 0;
      if (B?.neck) {
        const nb = (p.bend as { neck: { from: number; to: number } }).neck;
        along = smooth((b.uv![i * 2] - nb.from) / (nb.to - nb.from));
      } else if (B) along = Math.max(0, Math.min(1, (lx * B.dir[0] + ly * B.dir[1] + lz * B.dir[2]) / B.len));
      skin.set([boneIdx, b.line ? 1 : 0, b.bend, along], o * 4);
      if (painted && !b.line) { look.set([-1, -1, -1, 0], o * 4); uv[o * 2] = b.uv![i * 2]; uv[o * 2 + 1] = b.uv![i * 2 + 1]; } else look.set([...flat, 0], o * 4);
      if (!b.line) {
        stands = Math.max(stands, y);
        if (b.stage === STAGES.indexOf('head')) headTop = Math.max(headTop, y);
        reach = Math.max(reach, Math.hypot(x, z));
      }
    }
    v0 += c;
  }
  const index = Uint32Array.from(all), { pieceIndex, lineIndex } = splitIndex(index, ranges);

  const paint = new Uint8Array(PAINT_W * PAINT_H * 4), pick = d.pieces.map((p) => p.colour).find((c) => typeof c === 'function');
  for (let y = 0; y < PAINT_H; y++) for (let x = 0; x < PAINT_W; x++) {
    const dd = 1 - Math.abs(1 - 2 * ((y + 0.5) / PAINT_H)), k = pick ? pick((x + 0.5) / PAINT_W, dd) : 0, i = (y * PAINT_W + x) * 4;
    paint.set([k >> 16, (k >> 8) & 255, k & 255, 255], i);
  }

  const pivots = new Float32Array(MAX_BONES * 3), parents = new Int8Array(MAX_BONES);
  for (const [b, at] of Object.entries(d.pivots) as [Bone, readonly [number, number, number]][]) pivots.set(at, BONES.indexOf(b) * 3);
  BONES.forEach((b, i) => { parents[i] = i === 0 ? -1 : BONES.indexOf(d.parents[b] ?? 'hips'); });
  const head = d.pivots.head ?? [0, 0, 0], body = d.pivots.body ?? [0, 0, 0];
  return {
    key, position, normal, uv, skin, look, index, ranges, pieceIndex, lineIndex, pivots, parents,
    bends, robeTop: null, paint: { w: PAINT_W, h: PAINT_H, data: paint },
    baseHeight: headTop * scale, radius: reach / 16 * scale, hatSway: 0, size: 1,
    shoulderY: head[1] + 1, handY: 0, armLength: 0, armRadius: 0, quad: true, scale, hipY: body[1], neck: [head[0], head[1]],
    legs: d.legs.map((l) => ({ upper: BONES.indexOf(l.upper), lower: l.lower ? BONES.indexOf(l.lower) : -1, front: l.front })),
    hop: d.hop, neckBend: bends.findIndex((b) => b.neck), butt: d.pieces.some((p) => p.bone === 'hat'), varies: true,
    stands, footprint: [d.footprint[0], d.footprint[1]],
  };
}

/** The server's circle for this body: max(4, round(mean of the torso's half length and half width in game px)). */
export function hitRadius(d: TubeDesc): number {
  const t = d.pieces.find((p) => p.torso);
  if (!t) throw new Error(`${d.name}: no torso piece`);
  const m = turned(meshOf(t.shape), t.turn), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], m.position[i]); hi[a] = Math.max(hi[a], m.position[i]); }
  return Math.max(4, Math.round(((hi[0] - lo[0]) / 2 + (hi[2] - lo[2]) / 2) / 2 * d.size * PAGE_TO_GAME));
}

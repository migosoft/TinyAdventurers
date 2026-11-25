// The woodland pond's wooden bridges as geometry (#360): a hand-built deck of planks laid across the travel axis on beams, the beams on
// cross logs between posts driven into the bed, a sloping plank down to the ground at both ends. A road bridge (as wide as the road) has
// a kerb log on both sides, a pond's footbridge a low rail on one side. Every piece is a little off (length, width, tone, skew, lean),
// seeded from the deck's place, so a bridge looks the same every time. Built once per deck, like the torch holders (torch.ts), but with
// its own streams: no `warm`, no `foot` (a bridge reads the sight at its own point), and `grain` for the wood the material paints.
// Pure numbers; every one a first guess until the look is judged.
import type { Deck, PondField } from '../pond/pondField';
import { faceNormal } from '../stone/crystals';

export interface BridgeArrays {
  position: Float32Array; normal: Float32Array; /** rgb 0..1: the piece's own tone */ colour: Float32Array;
  /** Along the wood and across it on the face (tiles), and the piece's seed: the material paints the grain in art pixels from it. */
  grain: Float32Array;
  index: Uint32Array;
}
/** The vertex streams and their widths, for the view's geometry and the tests. */
export const BRIDGE_ATTRS: [keyof Omit<BridgeArrays, 'index'>, number][] = [['position', 3], ['normal', 3], ['colour', 3], ['grain', 3]];

/** Wood (the cove plants' wood ramp, pack colours): planks, the darker timber of beams and posts, the kerb and rail, a fresh cut. */
const PLANK = 0xb0704a, TIMBER = 0x62352b, POLE = 0x8f4029, CUT = 0xc28a5c;
/** A plank's tone strays this much (share, both ways); every plank is bleached toward WORN_TONE by a share between WORN's two, but one in DARK, which is of darker wood. */
const TONE_VARY = 0.08, WORN = [0.1, 0.65], WORN_TONE = 0xbfa48e, DARK = 0.18;
/** End grain is this much darker than the face; the underside of a piece darker still. */
const END = 0.72, UNDER = 0.55;
/** Planks: width along the way (least, most), thickness, the gap to the next (least, most), how far a plank's top may lie under the deck's height. */
const PLANK_W = [0.17, 0.27], PLANK_TH = 0.04, GAP = [0.012, 0.03], DROP = 0.006;
/** A plank's ends lie this far outside the deck's rect (least, most), and it is turned by up to this (rad). */
const OVER = [0.0, 0.05], SKEW = 0.035;
/** A road bridge's rows are two boards that meet over an inner beam (this share of the width from the middle, either side); one row in WHOLE is a single board. */
const JOINT = 1 / 6, WHOLE = 0.2;
/** The sloping plank at each end: how far it reaches past the deck's end (least, most), how far under the last plank it starts, its top's height where it meets the ground. */
const RAMP = [0.27, 0.34], RAMP_UNDER = 0.04, RAMP_TOE = 0.012;
/** Beams along the way: width, height, how far inside the rect's edge the outer two lie. */
const BEAM_W = 0.07, BEAM_H = 0.07, BEAM_IN = 0.17;
/** Cross logs under the beams, one at every pair of posts: width, height. */
const LOG_W = 0.08, LOG_H = 0.06;
/** Posts: half-width, how far outside the rect's edge they stand, how far from the deck's ends the first pair, about how many tiles between pairs (a road bridge over a brook has no pair in the water), how deep they reach (below the deepest bed a deck crosses). */
const POST_R = 0.045, POST_OUT = 0.095, POST_IN = 0.1, POST_STEP = 1.6, POST_FOOT = -1.6;
/** How high a post stands over the deck: a corner post (least, most), one between; and how far its top leans off its foot (tiles, either way). */
const STUB = [0.1, 0.15], STUB_MID = [0.03, 0.07], LEAN = 0.035;
/** A road bridge's kerb log: half-width, height, how far it stops short of the deck's ends. */
const KERB_R = 0.04, KERB_H = 0.07, KERB_IN = 0.08;
/** A footbridge's rail: its height over the deck (low: it hides no hero), how far its posts stand above it, the pole's half-width, how much an end of a pole strays in height, how far it reaches past its posts. */
export const RAIL_Y = 0.26;
const RAIL_POST = 0.05, RAIL_R = 0.028, RAIL_VARY = 0.018, RAIL_PAST = 0.07;

type V3 = [number, number, number];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const rgbOf = (c: number): V3 => [(c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const blend = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** A seeded stream of numbers in 0..1 (mulberry32). */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The bridge of a deck, in world tiles. The planks' tops lie at the deck's height (at most DROP under it) over the rect grown by half
 * a tile at both ends of the travel axis, where `deckAt` lifts the feet.
 */
export function buildBridge(deck: Deck): BridgeArrays {
  const position: number[] = [], normal: number[] = [], colour: number[] = [], grain: number[] = [];
  const rnd = stream(Math.imul(deck.x0 + 1, 73856093) ^ Math.imul(deck.z0 + 1, 19349663) ^ (deck.alongX ? 0x9e37 : 0));
  const between = (r: number[]): number => r[0] + (r[1] - r[0]) * rnd();
  const either = (far: number): number => (rnd() * 2 - 1) * far;
  // The builder's frame: [along the way, up, across it]. T0..T1 the deck with its half tile at both ends, C0..C1 the rect across.
  const world = (p: V3): V3 => (deck.alongX ? p : [p[2], p[1], p[0]]);
  const T0 = (deck.alongX ? deck.x0 : deck.z0) - 0.5, T1 = (deck.alongX ? deck.x1 : deck.z1) + 0.5;
  const C0 = deck.alongX ? deck.z0 : deck.x0, C1 = deck.alongX ? deck.z1 : deck.x1, mid = (C0 + C1) / 2, top = deck.y;

  /**
   * A piece of wood round `c`: half its length `u` (the grain runs along it), half its height `v`, half its width `w`, any three
   * vectors. Six flat faces; the two across the grain are end grain, the one facing -v is the underside. `post`: it stands, so it has
   * no underside and its far end is a fresh cut.
   */
  const piece = (c: V3, u: V3, v: V3, w: V3, tone: V3, post = false): void => {
    const cap = post, seed = rnd() * 64, lu = len(u), lv = len(v), lw = len(w);
    const faces: [n: V3, a: V3, b: V3, la: number, lb: number, shade: V3][] = [
      [v, u, w, lu, lw, tone], [add([0, 0, 0], v, -1), u, w, lu, lw, blend([0, 0, 0], tone, post ? 1 : UNDER)],
      [w, u, v, lu, lv, tone], [add([0, 0, 0], w, -1), u, v, lu, lv, tone],
      [u, w, v, lw, lv, cap ? rgbOf(CUT) : blend([0, 0, 0], tone, END)], [add([0, 0, 0], u, -1), w, v, lw, lv, blend([0, 0, 0], tone, END)],
    ];
    for (const [n, a, b, la, lb, shade] of faces) {
      const corner = (sa: number, sb: number): { p: V3; g: [number, number] } => ({ p: world(add(add(add(c, n), a, sa), b, sb)), g: [sa * la, sb * lb] });
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], out = world(n);
      for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) {
        // wound so the face looks out of the piece, whichever way the frame is turned
        let tri = [q[i], q[j], q[k]], fn = faceNormal(tri[0].p, tri[1].p, tri[2].p);
        if (fn[0] * out[0] + fn[1] * out[1] + fn[2] * out[2] < 0) {
          tri = [tri[0], tri[2], tri[1]];
          fn = [-fn[0], -fn[1], -fn[2]];
        }
        for (const t of tri) {
          position.push(...t.p);
          normal.push(...fn);
          colour.push(...shade);
          grain.push(t.g[0], t.g[1], seed);
        }
      }
    }
  };

  const plankTone = (): V3 => {
    // the bleach is squared: most planks are a little worn, a few pale
    const base = rnd() < DARK ? blend(rgbOf(PLANK), rgbOf(TIMBER), 0.35) : blend(rgbOf(PLANK), rgbOf(WORN_TONE), WORN[0] + (WORN[1] - WORN[0]) * rnd() ** 2);
    return blend([0, 0, 0], base, Math.min(1 / Math.max(...base), 1 + either(TONE_VARY)));
  };
  /** The boards of one row across the way: one on a footbridge, mostly two butted over an inner beam on a road bridge. */
  const boards = (): [number, number][] => {
    const a = C0 - between(OVER), b = C1 + between(OVER);
    if (!deck.road || rnd() < WHOLE) return [[a, b]];
    const joint = mid + (rnd() < 0.5 ? -1 : 1) * (C1 - C0) * JOINT;
    return [[a, joint], [joint, b]];
  };

  // The planks: widths drawn until the way is full, then fitted to it.
  const widths: number[] = [];
  for (let sum = 0; sum < T1 - T0;) sum += widths[widths.length] = between(PLANK_W);
  const fit = (T1 - T0) / widths.reduce((s, w) => s + w, 0);
  let t = T0;
  for (const w0 of widths) {
    const w = w0 * fit, gap = between(GAP);
    for (const [a, b] of boards()) {
      // turned a little, never so far that its end closes the gap or doubles it
      const half = (b - a) / 2, turn = either(Math.min(SKEW, (0.4 * gap) / half)), y = top - rnd() * DROP - PLANK_TH / 2;
      piece([t + w / 2, y, (a + b) / 2], [Math.sin(turn) * half, 0, Math.cos(turn) * half], [0, PLANK_TH / 2, 0], [(Math.cos(turn) * (w - gap)) / 2, 0, (-Math.sin(turn) * (w - gap)) / 2], plankTone());
    }
    t += w;
  }
  // The sloping plank at each end: from under the last plank down to the ground.
  for (const [edge, out] of [[T0, -1], [T1, 1]]) {
    const reach = between(RAMP), hi = top - DROP - 0.004, run = reach + RAMP_UNDER, fall = RAMP_TOE - hi, l = Math.hypot(run, fall);
    // the slope's direction and the normal of its top
    const s: V3 = [(out * run) / l, fall / l, 0], n: V3 = [(-out * fall) / l, run / l, 0];
    for (const [a, b] of boards()) {
      const c = add(add([edge - out * RAMP_UNDER, hi, (a + b) / 2], s, l / 2), n, -PLANK_TH / 2);
      piece(c, [0, 0, (b - a) / 2 - 0.01], add([0, 0, 0], n, PLANK_TH / 2), add([0, 0, 0], s, l / 2), plankTone());
    }
  }

  // The beams the planks lie on: one inside each edge, a road bridge two more where its boards meet.
  const beamTop = top - DROP - PLANK_TH, beams = [C0 + BEAM_IN, C1 - BEAM_IN];
  if (deck.road) beams.push(mid - (C1 - C0) * JOINT, mid + (C1 - C0) * JOINT);
  const timber = rgbOf(TIMBER);
  for (const c of beams) piece([(T0 + T1) / 2, beamTop - BEAM_H / 2, c + either(0.015)], [(T1 - T0) / 2 - 0.02, 0, 0], [0, BEAM_H / 2, 0], [0, 0, BEAM_W / 2], timber);

  // Pairs of posts with a cross log under the beams: at both ends and at even steps between.
  const pairs = Math.max(2, Math.round((T1 - T0 - 2 * POST_IN) / POST_STEP) + 1);
  // The rail of a footbridge stands on the far side from the camera's home (north) where the way runs east; else on a seeded side.
  const railSide = deck.road ? 0 : deck.alongX ? -1 : rnd() < 0.5 ? -1 : 1;
  const railTops: V3[] = [];
  for (let k = 0; k < pairs; k++) {
    const at = T0 + POST_IN + ((T1 - T0 - 2 * POST_IN) * k) / (pairs - 1), corner = k === 0 || k === pairs - 1;
    piece([at, beamTop - BEAM_H - LOG_H / 2, mid], [0, 0, (C1 - C0) / 2 + POST_OUT], [0, LOG_H / 2, 0], [LOG_W / 2, 0, 0], timber);
    for (const side of [-1, 1]) {
      const c = side < 0 ? C0 - POST_OUT : C1 + POST_OUT, rail = side === railSide;
      const head = top + (rail ? RAIL_Y + RAIL_POST : between(corner ? STUB : STUB_MID));
      // a rail's post leans less: the pole holds it
      const foot: V3 = [at, POST_FOOT, c], tip: V3 = [at + either(LEAN) * (rail ? 0.4 : 1), head, c + either(LEAN) * (rail ? 0.4 : 1)];
      const turn = either(0.5), r = POST_R * (1 + either(0.12)), c0 = blend(foot, tip, 0.5);
      piece(c0, add(tip, c0, -1), [Math.cos(turn) * r, 0, Math.sin(turn) * r], [-Math.sin(turn) * r, 0, Math.cos(turn) * r], blend(timber, rgbOf(POLE), rnd() * 0.5), true);
      if (rail) railTops.push([tip[0], top + RAIL_Y + either(RAIL_VARY), tip[2] - side * (POST_R + RAIL_R * 0.6)]);
    }
  }
  // The rail: a pole from post to post on the deck's side of them, each reaching a little past its posts.
  for (let k = 0; k + 1 < railTops.length; k++) {
    const a = railTops[k], b = railTops[k + 1], d: V3 = add(b, a, -1), l = len(d), half: V3 = [d[0] / 2 + (d[0] / l) * RAIL_PAST, d[1] / 2, d[2] / 2 + (d[2] / l) * RAIL_PAST];
    // poles that share a post lie over each other there, not in each other
    piece(add(blend(a, b, 0.5), [0, (k % 2) * RAIL_R * 1.2, 0]), half, [0, RAIL_R, 0], [0, 0, RAIL_R], blend(rgbOf(POLE), rgbOf(PLANK), rnd() * 0.5));
  }
  // The kerb logs of a road bridge: on the planks' ends, between the corner posts.
  if (deck.road) for (const c of [C0, C1]) {
    const lift = either(0.012);
    piece([(T0 + T1) / 2, top + KERB_H / 2 - 0.004, c], [(T1 - T0) / 2 - KERB_IN, lift, either(0.02)], [0, KERB_H / 2, 0], [0, 0, KERB_R], blend(rgbOf(POLE), timber, rnd() * 0.6));
  }

  const count = position.length / 3;
  return { position: new Float32Array(position), normal: new Float32Array(normal), colour: new Float32Array(colour), grain: new Float32Array(grain), index: Uint32Array.from({ length: count }, (_, i) => i) };
}

/** The bridges of a map's pond, one a deck; none without a pond. */
export function bridgesOf(field: PondField | undefined): BridgeArrays[] {
  return field ? field.decks.map(buildBridge) : [];
}

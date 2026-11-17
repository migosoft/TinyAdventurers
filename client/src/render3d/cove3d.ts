// The nymph's cove in the 3D dungeon (#306, #329, #330): the willow and the bushes as grown 3D trees that sway in the wind, a shadow
// caster for each so the dungeon's lights throw their shadows, the tufts and ferns as bushel spots for the cover layer, and the pixies: glows with wing cards that also
// light the ground. The grass carpet is cover/cove.ts. Layout and paths come from covemath.ts and pixieMath.ts.
import type { CoveInfo } from '../generated/CoveInfo';
import { LIGHT_KIND } from '../generated/defs';
import { COVE_TREE_FOOT, coveLayout, placeCovePlants } from '../game/covemath';
import { CANOPY_UP, PIXIE_COLOURS, PIXIE_RX, PIXIE_RY, PIXIE_COUNT, PIXIE_GLOW_ALPHA, PIXIE_WING_ALPHA, pixieAt } from '../game/pixieMath';
import type { Cam } from './camera';
import { pushCard, pushGlow, type CardBuf, type GlowBuf } from './cards';
import type { Cand, ShadowCaster } from './lights';
import type { BushelSpot } from './cover/source';
import { hiddenAt, type SightMask } from './sightmask';
import { CanvasEdgeError } from '../game/vegetation/canvas';
import { buildTree, type BuiltTree } from './trees/build';
import { lookKey, type TreeSpec } from './trees/spec';
import type { FrameRects } from './worldMesh';

const TILE = 16;
/** The first caster id of the cove's plants; the others count down from it (the figures' ids are positive). */
export const CAST_ID0 = -1000;
/** A pixie's glow is 9 px across, its bright core 3 px. */
const GLOW_HALF = 4.5 / TILE;
const CORE_HALF = 1.5 / TILE;
/** A pixie's light: reach (tiles) and strength next to the glow colour (*first guess*). */
export const PIXIE_LIGHT = { radius: 2, gain: 0.6 } as const;
/** The solid pixel the wings are cut from. */
const PX_FRAME = 'floor_1';

const rgbOf = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const GLOW = rgbOf(PIXIE_COLOURS.glow);
const CORE = rgbOf(PIXIE_COLOURS.core);

/** The pixies of one place: `count` of them on `pixieAt` paths around `centre` (px), their 3D point from the path. */
export class Pixies3d {
  constructor(
    private readonly centre: { x: number; y: number },
    /** The ground the paths are drawn over: its z in px. */
    private readonly groundPx: number,
    private readonly count: number,
    private readonly seed: number,
    /** The height of the path's centre above the ground (px). */
    private readonly up: number = CANOPY_UP,
    /** Another path than the default ellipse: pixie `i` at time `t` from the ellipse's unit position (u, v, each -1..1), as a point in tiles. */
    private readonly orbit?: (i: number, t: number, u: number, v: number) => { x: number; y: number; z: number },
  ) {}

  /** Pixie `i` at time `t` (s): its point (tiles) and whether its wings are up. */
  at(i: number, t: number): { x: number; y: number; z: number; wingUp: boolean } {
    const p = pixieAt(i, t, this.centre, this.seed);
    if (this.orbit) return { ...this.orbit(i, t, (p.x - this.centre.x) / PIXIE_RX, (p.y - this.centre.y) / PIXIE_RY), wingUp: p.wingUp };
    const dy = p.y - this.centre.y;
    // The ellipse is the canopy seen from above at a tilt: its vertical axis is mostly depth, a little height.
    return { x: p.x / TILE, z: this.groundPx / TILE + (0.6 * dy) / TILE, y: this.up / TILE - (0.4 * dy) / TILE, wingUp: p.wingUp };
  }

  /** Pushes each pixie's glow and core into `glows` and its two wing pixels into `ghosts` (on the frames the wings are up they sit a pixel higher); none on an unseen texel (`mask` null: all seen). */
  push(t: number, cam: Cam, glows: GlowBuf, ghosts: CardBuf, frames: FrameRects, mask: SightMask | null): void {
    for (let i = 0; i < this.count; i++) {
      const p = this.at(i, t);
      if (mask && hiddenAt(mask, p.x, p.z)) continue;
      pushGlow(glows, p.x, p.y, p.z, GLOW_HALF, [GLOW[0] * PIXIE_GLOW_ALPHA, GLOW[1] * PIXIE_GLOW_ALPHA, GLOW[2] * PIXIE_GLOW_ALPHA], cam);
      pushGlow(glows, p.x, p.y, p.z, CORE_HALF, [CORE[0] * 1.5, CORE[1] * 1.5, CORE[2] * 1.5], cam);
      const oy = p.wingUp ? -1 : 0;
      // A glow is not stretched, a card's height is (by 1 / cos(pitch), `cardMaterial`): the lift is shrunk by cos(pitch) so the
      // stretched pixel lands at the orb's own point; the half-px offset centres the 1 px crop (it hangs right of and below its anchor),
      // one art px to each side of the orb (#340).
      const lift = p.y * Math.cos(cam.pitch);
      for (const ox of [-1, 1]) {
        pushCard(ghosts, {
          frame: PX_FRAME, crop: { x: 0, y: 0, w: 1, h: 1 }, x: p.x, z: p.z, lift, flip: false, originX: 0, footY: 0, scale: 1, offset: [ox - 0.5, oy - 0.5],
          tint: [1, 1, 1], mode: 1, alpha: PIXIE_WING_ALPHA,
        }, frames, cam);
      }
    }
  }

  /** The pixies' lights at time `t`: ids `x<i>`, no shadows. */
  lights(t: number): Cand[] {
    const out: Cand[] = [];
    const [r, g, b] = [GLOW[0] * PIXIE_LIGHT.gain, GLOW[1] * PIXIE_LIGHT.gain, GLOW[2] * PIXIE_LIGHT.gain];
    for (let i = 0; i < this.count; i++) {
      const p = this.at(i, t);
      out.push({ id: `x${i}`, kind: LIGHT_KIND.Magic, x: p.x, y: p.y, z: p.z, radius: PIXIE_LIGHT.radius, r, g, b, shadow: false, skip: -1, base: Math.max(r, g, b) });
    }
    return out;
  }
}

/** The cove willow's sizes (percent of the spike's big willow; the cove's is a special, larger one, about the old tree's 100 px at 200). */
const WILLOW_SCALE = { min: 60, max: 200, step: 5 } as const; // first guess
/**
 * The 3D cove's pixies (first guesses): the first `above` circle above the crown (their path `aboveLift` tiles over the willow's height,
 * bobbing `aboveBob` tiles, on an ellipse `aboveSpan` times the willow's reach), the others circle the trunk outside the curtains
 * (`ringGap` tiles beyond the willow's reach, wobbling `ringWobble` tiles, at `ringHeight` times its height, one lap in about `ringPeriod` s),
 * all inside the room's walls.
 */
export const COVE_PIXIES = { above: 3, aboveLift: 0.5, aboveBob: 0.25, aboveSpan: 0.7, ringGap: 1, ringWobble: 0.4, ringHeight: [0.15, 0.45], ringPeriod: 45 } as const;
/** The room's wall keeps this far (tiles) from the willow's reach. */
const WALL_GAP = 0.5; // first guess

/** The cove's willow, with the shape it builds into (its radius and height decide the casters and the pixies' height). */
function fitWillow(c: CoveInfo, build: (s: TreeSpec) => BuiltTree = buildTree): { spec: TreeSpec; built: BuiltTree; reach: number } {
  const { foot } = coveLayout(c);
  const x = foot.x / TILE, z = foot.y / TILE;
  // The room in tiles; the reach is measured from the foot to every wall.
  const room = Math.min(x - (c.x + WALL_GAP), c.x + c.w - WALL_GAP - x, z - (c.y + WALL_GAP), c.y + c.h - WALL_GAP - z);
  // From the largest size down: the first that fits the room. The generator's drawing canvas is finite, so a size it cannot draw counts as too large.
  for (let pct = WILLOW_SCALE.max; ; pct -= WILLOW_SCALE.step) {
    const spec: TreeSpec = { form: 'willow', x, z, seed: c.seed, scalePct: pct, mirrored: false, leaf: 1, dead: false };
    const last = pct - WILLOW_SCALE.step < WILLOW_SCALE.min;
    let built: BuiltTree;
    try {
      built = build(spec);
    } catch (e) {
      if (!(e instanceof CanvasEdgeError) || last) throw e;
      continue;
    }
    if (built.radius <= room || last) return { spec, built, reach: room };
  }
}

/** The cove's tree in the 3D view: a willow of the grown-tree system at the trunk's foot, the largest size whose curtains stay 0.5 tiles inside the room. */
export function coveWillow(c: CoveInfo, build?: (s: TreeSpec) => BuiltTree): TreeSpec {
  return fitWillow(c, build).spec;
}

/** The pixies' paths round the willow (`COVE_PIXIES`): above its crown, or in a ring outside its curtains, never past the room's walls. */
function coveOrbit(w: { spec: TreeSpec; built: BuiltTree; reach: number }): (i: number, t: number, u: number, v: number) => { x: number; y: number; z: number } {
  const { spec, built, reach } = w;
  const P = COVE_PIXIES;
  const ring0 = Math.min(built.radius + P.ringGap, reach - P.ringWobble);
  return (i, t, u, v) => {
    if (i < P.above) {
      const rx = P.aboveSpan * built.radius;
      return { x: spec.x + u * rx, z: spec.z + v * rx * 0.5, y: built.height + P.aboveLift + v * P.aboveBob };
    }
    const k = i - P.above;
    const angle = k * 2.399963 + ((k % 2 === 0 ? 1 : -1) * 2 * Math.PI * t) / (P.ringPeriod * (1 + 0.15 * (k % 3)));
    const r = ring0 + u * P.ringWobble;
    const f = (v + 1) / 2;
    return { x: spec.x + r * Math.cos(angle), z: spec.z + r * Math.sin(angle), y: built.height * (P.ringHeight[0] + (P.ringHeight[1] - P.ringHeight[0]) * f) };
  };
}

/** How many bushels a tuft (3..5) or a fern (2..3) grows, from a hash of its seed (*first guess*). */
function bushelCount(seed: number, fern: boolean): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  const u = (h >>> 0) / 4294967296;
  return fern ? 2 + Math.floor(u * 2) : 3 + Math.floor(u * 3);
}

/** A small plant: its foot (tiles) and its frame (atlas rect, and the foot in the frame's px). */
interface SmallPlant { place: { x: number; z: number }; sprite: { rect: { x: number; y: number; w: number; h: number }; foot: { x: number; y: number } }; bush: boolean }

export class Cove3d {
  /** Every small plant in the order of `placeCovePlants`: bushes, tufts and ferns (the bushes are 3D and cast; the rest are bushel spots and atlas sprites). */
  private readonly small: SmallPlant[] = [];
  private readonly spots: BushelSpot[] = [];
  private readonly willow: { spec: TreeSpec; built: BuiltTree; reach: number };
  private readonly pixies: Pixies3d;
  private readonly bushSpecs: TreeSpec[] = [];

  constructor(c: CoveInfo, private readonly frames: FrameRects) {
    const { spec, origin, foot } = coveLayout(c);
    this.willow = fitWillow(c);
    // The plants stand with the bottom centre of their frame on the spot.
    placeCovePlants(spec).forEach((p, i) => {
      const r = frames[p.frame];
      if (!r) return;
      const x = (origin.x + p.x) / TILE, z = (origin.y + p.y) / TILE, bush = p.frame.startsWith('cove_bush');
      this.small.push({ place: { x, z }, sprite: { rect: r, foot: { x: r.w / 2, y: r.h } }, bush });
      // A bush's width is 32 px at scale 100.
      if (!bush) this.spots.push({ x, z, fern: p.frame === 'cove_fern', count: bushelCount(c.seed + i + 1, p.frame === 'cove_fern') });
      if (bush) this.bushSpecs.push({ form: 'bush', x, z, seed: c.seed + i + 1, scalePct: (r.w / 32) * 100, mirrored: false, leaf: 1, dead: false });
    });
    this.pixies = new Pixies3d({ x: foot.x, y: foot.y - CANOPY_UP }, foot.y, PIXIE_COUNT, c.seed, CANOPY_UP, coveOrbit(this.willow));
  }

  /** The cove's tree. */
  tree(): TreeSpec {
    return this.willow.spec;
  }

  /** The forest's tree builder: the willow comes from the fit that already built it, every other tree from `base`. */
  builder(base: (s: TreeSpec) => BuiltTree = buildTree): (s: TreeSpec) => BuiltTree {
    const key = lookKey(this.willow.spec);
    return (s) => (lookKey(s) === key ? this.willow.built : base(s));
  }

  /** The bushes, as grown bushes at their spots. */
  bushes(): TreeSpec[] {
    return this.bushSpecs;
  }

  /** The tufts and ferns as bushel spots for the cover layer: a spot at each one's foot. */
  bushelSpots(): BushelSpot[] {
    return this.spots;
  }

  /**
   * The casters for the lights' shadows: the willow first (id `CAST_ID0`; the atlas tree picture above its foot, as wide as its reach and as
   * tall as it is: a stand-in), then one per bush (its card above its foot; the tufts and ferns cast nothing). A bush's id is `CAST_ID0 - 1 - i` for its place `i` among the small plants.
   */
  casters(): ShadowCaster[] {
    const out: ShadowCaster[] = [];
    const tree = this.frames.cove_tree;
    const { spec, built } = this.willow;
    if (tree) out.push({ id: CAST_ID0, x: spec.x, z: spec.z, w: 2 * built.radius, y0: 0, y1: built.height, u0: tree.x, v0: tree.y, u1: tree.x + tree.w, v1: tree.y + COVE_TREE_FOOT.y });
    this.small.forEach(({ place, sprite, bush }, i) => {
      if (!bush) return;
      const { rect, foot } = sprite;
      out.push({
        id: CAST_ID0 - 1 - i, x: place.x, z: place.z, w: rect.w / TILE, y0: 0, y1: foot.y / TILE,
        u0: rect.x, v0: rect.y, u1: rect.x + rect.w, v1: rect.y + foot.y,
      });
    });
    return out;
  }

  /** The pixies' glows and wings for this frame. */
  push(t: number, cam: Cam, glows: GlowBuf, ghosts: CardBuf, mask: SightMask | null): void {
    this.pixies.push(t, cam, glows, ghosts, this.frames, mask);
  }

  /** The pixies' lights. */
  lights(t: number): Cand[] {
    return this.pixies.lights(t);
  }
}

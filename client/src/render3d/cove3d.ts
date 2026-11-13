// The nymph's cove in the 3D dungeon (#306): the tree and the bushes, tufts and ferns as atlas sprites that sway in the wind, a shadow
// caster for each so the dungeon's lights throw their shadows, and the pixies: glows with wing cards that also light the ground.
// The grass carpet and the stone floor are not here (the floor stays stone until #330). Layout and paths are the 2D view's (covemath.ts,
// pixieMath.ts), so both views agree.
import type { CoveInfo } from '../generated/CoveInfo';
import { LIGHT_KIND } from '../generated/defs';
import { COVE_TREE_FOOT, coveLayout, placeCovePlants } from '../game/covemath';
import { CANOPY_UP, PIXIE_COLOURS, PIXIE_COUNT, PIXIE_GLOW_ALPHA, PIXIE_WING_ALPHA, pixieAt } from '../game/pixieMath';
import type { Cam } from './camera';
import { pushCard, pushGlow, type CardBuf, type GlowBuf } from './cards';
import type { Cand, ShadowCaster } from './lights';
import type { PlantPlace, PlantSprite } from './plants';
import { hiddenAt, type SightMask } from './sightmask';
import { SWAY } from './wind';
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

/** The pixies of one place: `count` of them on `pixieAt` paths around `centre` (px, as in 2D), their 3D point from the path. */
export class Pixies3d {
  constructor(
    private readonly centre: { x: number; y: number },
    /** The ground the paths are drawn over: its z in px. */
    private readonly groundPx: number,
    private readonly count: number,
    private readonly seed: number,
    /** The height of the path's centre above the ground (px). */
    private readonly up: number = CANOPY_UP,
  ) {}

  /** Pixie `i` at time `t` (s): its point (tiles) and whether its wings are up. */
  at(i: number, t: number): { x: number; y: number; z: number; wingUp: boolean } {
    const p = pixieAt(i, t, this.centre, this.seed);
    const dy = p.y - this.centre.y;
    // The 2D ellipse is the canopy seen from above at a tilt: its vertical axis is mostly depth, a little height.
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
      for (const ox of [-1, 1]) {
        pushCard(ghosts, {
          frame: PX_FRAME, crop: { x: 0, y: 0, w: 1, h: 1 }, x: p.x, z: p.z, lift: p.y, flip: false, originX: 0, footY: 0, scale: 1, offset: [ox, oy],
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

export class Cove3d {
  private readonly items: { place: PlantPlace; sprite: PlantSprite }[] = [];
  private readonly pixies: Pixies3d;

  constructor(c: CoveInfo, private readonly frames: FrameRects) {
    const { spec, origin, foot } = coveLayout(c);
    // The tree: its foot (trunk base) is COVE_TREE_FOOT in the 96 x 100 frame.
    const tree = frames.cove_tree;
    if (tree) this.items.push({ place: { x: foot.x / TILE, z: foot.y / TILE, mirrored: false, amp: SWAY.coveTree, seed: c.seed }, sprite: { page: -1, rect: tree, foot: COVE_TREE_FOOT, shape: null } });
    // The plants stand with the bottom centre of their frame on the spot.
    placeCovePlants(spec).forEach((p, i) => {
      const r = frames[p.frame];
      if (!r) return;
      this.items.push({ place: { x: (origin.x + p.x) / TILE, z: (origin.y + p.y) / TILE, mirrored: false, amp: SWAY.small, seed: c.seed + i + 1 }, sprite: { page: -1, rect: r, foot: { x: r.w / 2, y: r.h }, shape: null } });
    });
    this.pixies = new Pixies3d({ x: foot.x, y: foot.y - CANOPY_UP }, foot.y, PIXIE_COUNT, c.seed);
  }

  /** Every plant as an atlas sprite with its place. */
  plants(): { place: PlantPlace; sprite: PlantSprite }[] {
    return this.items;
  }

  /** One caster per plant, for the lights' shadows: the card above its foot, its atlas rect. Ids count down from `CAST_ID0`. */
  casters(): ShadowCaster[] {
    return this.items.map(({ place, sprite }, i) => {
      const { rect, foot } = sprite;
      return {
        id: CAST_ID0 - i, x: place.x, z: place.z, w: rect.w / TILE, y0: 0, y1: foot.y / TILE,
        u0: rect.x, v0: rect.y, u1: rect.x + rect.w, v1: rect.y + foot.y,
      };
    });
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

// The woodland's critters in the 3D view (#306): bees looping around the flower patches and butterflies wandering over the grass, as
// in 2D (game/woodland/critters.ts; the same seeds, order and maths from critterMath.ts). Each is a few solid pixel rects drawn as
// opaque cards, so the sun lights them and their tiny shadows fall through the cards' sun twin. Shown only where the viewer sees.
import { BEE_COLOURS, BEES_PER_PATCH, beeParams, beePos, butterflyHomes, flowerPatches, flyParams, flyPos, type BeeParams, type Butterfly, type FlyParams, type Pt, type Rect } from '../game/woodland/critterMath';
import { flowerSpots } from '../game/woodland/ground';
import { TILE, type TileMap } from '../sim/map';
import type { Cam } from './camera';
import { pushCard, type CardBuf } from './cards';
import type { Footprint } from './lights';
import { footSight, thingHard, type SightMask } from './sightmask';
import type { FrameRects } from './worldMesh';

/** A solid pixel rect is this opaque atlas frame cropped to w x h px, in fill mode, the tint the colour. */
export const PX_FRAME = 'floor_1';
/** A bee's height above the ground (tiles; *first guess*). */
export const BEE_LIFT = 0.35;
/** A butterfly's height in flight above its ground height, and landed (tiles; *first guess*). */
const FLIGHT_LIFT = 0.25;
const LANDED_LIFT = 0.02;
/** The rects hang below a critter's anchor (offsets are y down): the lowest pixel row is this many px under it, so the lift is raised by it and the lowest pixel sits at the lift. */
const BEE_LOW = 1;
const FLY_LOW = 2;
/** Pushes the second rect of a critter a hair toward the viewer so it wins over the rect it overlaps. */
const OVER = 0.003;
/** Critters this far outside the view box (tiles) are skipped. */
const MARGIN = 1;

/** A butterfly's height (tiles): its flap lift over the ground plus 0.25 in flight, 0.02 landed. */
export const butterflyLift = (b: Butterfly): number => (b.landed ? LANDED_LIFT : (b.ground - b.y) / TILE + FLIGHT_LIFT);

const rgbOf = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

interface Flyer { bounds: Rect; colour: number; q: FlyParams }
interface Bee { f: Pt; q: BeeParams }

export class Critters3d {
  private readonly bees: Bee[] = [];
  private readonly flyers: Flyer[] = [];
  private readonly pos: Butterfly = { x: 0, y: 0, open: false, landed: false, ground: 0 };
  private readonly pt: Pt = { x: 0, y: 0 };

  constructor(map: TileMap, seed: number) {
    flowerPatches(flowerSpots(map, seed)).forEach((f, p) => {
      for (let b = 0; b < BEES_PER_PATCH; b++) this.bees.push({ f, q: beeParams(p * BEES_PER_PATCH + b, seed) });
    });
    butterflyHomes(map, seed).forEach(({ bounds, colour }, i) => this.flyers.push({ bounds, colour, q: flyParams(i, seed, bounds) }));
  }

  /** The bees and butterflies. */
  get count(): number {
    return this.bees.length + this.flyers.length;
  }

  /**
   * Pushes the critters at time `t` (s) into `cards`; nothing before `day` 0.5, none outside `view` or on an unseen texel (`mask` null: all
   * seen). Returns how many critters it drew.
   */
  push(cards: CardBuf, frames: FrameRects, cam: Cam, t: number, day: number, mask: SightMask | null, view: Footprint): number {
    if (day < 0.5) return 0;
    let n = 0;
    const shown = (x: number, z: number): boolean =>
      x >= view.x0 - MARGIN && x <= view.x1 + MARGIN && z >= view.z0 - MARGIN && z <= view.z1 + MARGIN && (!mask || thingHard(mask, footSight(mask, x, z, 0).hard) > 0);
    // A rect `w` x `h` px whose top-left is (ox, oy) px right and down of the critter's point.
    const rect = (x: number, z: number, lift: number, ox: number, oy: number, w: number, h: number, colour: number, bias: number): void => {
      pushCard(cards, {
        frame: PX_FRAME, crop: { x: 0, y: 0, w, h }, x, z, lift, flip: false, originX: 0, footY: 0, scale: 1, offset: [ox, oy],
        tint: rgbOf(colour), mode: 1, alpha: 1, bias,
      }, frames, cam);
    };
    for (const bee of this.bees) {
      beePos(bee.q, t, bee.f, this.pt);
      const x = this.pt.x / TILE, z = this.pt.y / TILE;
      if (!shown(x, z)) continue;
      const lift = BEE_LIFT + BEE_LOW / TILE;
      rect(x, z, lift, -1, -1, 2, 2, BEE_COLOURS.yellow, 0);
      rect(x, z, lift, 0, -1, 1, 2, BEE_COLOURS.dark, OVER);
      n++;
    }
    for (const fl of this.flyers) {
      const b = flyPos(fl.q, t, fl.bounds, this.pos);
      const x = b.x / TILE, z = b.ground / TILE;
      if (!shown(x, z)) continue;
      const lift = butterflyLift(b) + FLY_LOW / TILE;
      if (b.open) { rect(x, z, lift, -3, -2, 2, 3, fl.colour, 0); rect(x, z, lift, 1, -2, 2, 3, fl.colour, 0); }
      else { rect(x, z, lift, -1, -2, 1, 3, fl.colour, 0); rect(x, z, lift, 0, -2, 1, 3, fl.colour, 0); }
      rect(x, z, lift, 0, -1, 1, 3, BEE_COLOURS.body, OVER);
      n++;
    }
    return n;
  }
}

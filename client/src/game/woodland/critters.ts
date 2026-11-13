// Woodland critters (#203): bees looping around flower patches and butterflies wandering over the grass. Cosmetic and
// client-only. Every position is a pure function of time and seed (no state). Each critter is a few reused pixel
// images, depth-sorted like figures (canopies and trunks cover them), shown only where the viewer sees (seenLit).
import type Phaser from 'phaser';
import { TILE, type TileMap } from '../../sim/map';
import { DEPTH } from '../effects';
import { BEE_COLOURS, BEES_PER_PATCH, beeParams, beePos, butterflyHomes, flowerPatches, flyParams, flyPos, type BeeParams, type Butterfly, type FlyParams, type Pt, type Rect } from './critterMath';

export { beeAt, butterflyAt, flowerPatches, WING_COLOURS, type Butterfly, type Pt, type Rect } from './critterMath';

/** A bee's draw depth: sorted by its own ground point like every figure (bees fly at no height, so that is its drawn y), not by its flower's. */
export function beeDepth(pos: Pt): number {
  return DEPTH.entityBase + pos.y;
}

interface Flyer { bounds: Rect; colour: number; q: FlyParams; left: Phaser.GameObjects.Image; right: Phaser.GameObjects.Image; body: Phaser.GameObjects.Image }
interface Bee { f: Pt; q: BeeParams; body: Phaser.GameObjects.Image; stripe: Phaser.GameObjects.Image }

const PX_TEX = 'critter-px';
type Px = Phaser.GameObjects.Image;

export class Critters {
  /** Whether the bees fly. */
  beesOn = true;
  /** Whether the butterflies fly. */
  butterfliesOn = true;
  private patches: Pt[];
  private flyers: Flyer[] = [];
  private bees: Bee[] = [];
  private pos: Butterfly = { x: 0, y: 0, open: false, landed: false, ground: 0 };

  /** `map`: the walkable tiles (floor and road) decide how many butterflies there are and where they live. */
  constructor(private scene: Phaser.Scene, flowers: Pt[], seed: number, map: TileMap) {
    if (!scene.textures.exists(PX_TEX)) {
      const c = scene.textures.createCanvas(PX_TEX, 1, 1)!;
      c.getContext().fillStyle = '#fff';
      c.getContext().fillRect(0, 0, 1, 1);
      c.refresh();
    }
    this.patches = flowerPatches(flowers);
    this.patches.forEach((f, p) => {
      for (let b = 0; b < BEES_PER_PATCH; b++) this.bees.push({ f, q: beeParams(p * BEES_PER_PATCH + b, seed), body: this.px(BEE_COLOURS.yellow), stripe: this.px(BEE_COLOURS.dark) });
    });
    butterflyHomes(map, seed).forEach(({ bounds, colour }, i) => {
      this.flyers.push({ bounds, colour, q: flyParams(i, seed, bounds), left: this.px(colour), right: this.px(colour), body: this.px(BEE_COLOURS.body) });
    });
  }

  /** A 1x1 white pixel object, tinted and stretched into a shape; created once and reused. */
  private px(tint: number): Px {
    return this.scene.add.image(0, 0, PX_TEX).setOrigin(0).setTint(tint).setVisible(false);
  }

  private seen(seenLit: Uint8Array, mapW: number, x: number, y: number): boolean {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return tx >= 0 && tx < mapW && ty >= 0 && ty * mapW + tx < seenLit.length && seenLit[ty * mapW + tx] === 1;
  }

  private static rect(o: Px, x: number, y: number, w: number, h: number, depth: number): void {
    o.setPosition(x, y).setScale(w, h).setDepth(depth).setVisible(true);
  }

  /** `cam`: when given, critters outside it are skipped. */
  update(t: number, seenLit: Uint8Array, mapW: number, cam?: Phaser.Geom.Rectangle): void {
    const pos = this.pos;
    for (const bee of this.bees) {
      bee.body.setVisible(false);
      bee.stripe.setVisible(false);
      if (!this.beesOn) continue;
      if (cam && (bee.f.x < cam.x - 16 || bee.f.x > cam.right + 16 || bee.f.y < cam.y - 16 || bee.f.y > cam.bottom + 16)) continue;
      beePos(bee.q, t, bee.f, pos);
      if (!this.seen(seenLit, mapW, pos.x, pos.y)) continue;
      const x = Math.round(pos.x), y = Math.round(pos.y), d = beeDepth(pos);
      Critters.rect(bee.body, x - 1, y - 1, 2, 2, d);
      Critters.rect(bee.stripe, x, y - 1, 1, 2, d + 0.01);
    }
    for (const fl of this.flyers) {
      fl.left.setVisible(false);
      fl.right.setVisible(false);
      fl.body.setVisible(false);
      if (!this.butterfliesOn) continue;
      const b = flyPos(fl.q, t, fl.bounds, pos);
      if (cam && (b.x < cam.x - 16 || b.x > cam.right + 16 || b.y < cam.y - 16 || b.y > cam.bottom + 16)) continue;
      if (!this.seen(seenLit, mapW, b.x, b.ground)) continue;
      const x = Math.round(b.x), y = Math.round(b.y), d = DEPTH.entityBase + b.ground;
      if (b.open) { Critters.rect(fl.left, x - 3, y - 2, 2, 3, d); Critters.rect(fl.right, x + 1, y - 2, 2, 3, d); }
      else { Critters.rect(fl.left, x - 1, y - 2, 1, 3, d); Critters.rect(fl.right, x, y - 2, 1, 3, d); }
      Critters.rect(fl.body, x, y - 1, 1, 3, d + 0.01);
    }
  }

  destroy(): void {
    for (const b of this.bees) { b.body.destroy(); b.stripe.destroy(); }
    for (const f of this.flyers) { f.left.destroy(); f.right.destroy(); f.body.destroy(); }
    if (this.scene.textures.exists(PX_TEX)) this.scene.textures.remove(PX_TEX);
  }
}

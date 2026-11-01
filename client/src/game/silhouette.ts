// Silhouette (#202): while the own hero stands behind an occluder (the cove's big tree), a pale copy of the
// hero's body sprite shows through it. The copy is drawn just above the occluder and cut to the occluder's
// shape with a BitmapMask, so it appears only where the tree covers the hero and never doubles the visible
// part. No weapon; teammates and enemies get none. Without WebGL (no BitmapMask) there is no silhouette.
import type Phaser from 'phaser';

interface Box { left: number; right: number; top: number; footY: number }

const FILL = 0xcae6f5;
const ALPHA = 0.4;
/** Phaser.WEBGL (the enum is not imported at runtime here). */
const WEBGL = 2;

/** True when the hero is north of the occluder's foot (so the occluder is drawn over it) and the boxes overlap. */
export function behindOccluder(hero: Box, occ: Box): boolean {
  if (hero.footY >= occ.footY) return false;
  return hero.left < occ.right && hero.right > occ.left && hero.footY > occ.top && hero.top < occ.footY;
}

/** What the copy takes from the hero every update; flipX and origin keep a mirrored hero from showing mirrored or shifted. */
export function copyProps(h: { x: number; y: number; flipX: boolean; originX: number; originY: number; scaleX: number; scaleY: number }) {
  return { x: h.x, y: h.y, flipX: h.flipX, originX: h.originX, originY: h.originY, scaleX: h.scaleX, scaleY: h.scaleY };
}

export class Silhouette {
  /** Hidden and not updated while false. */
  on = true;
  private copy: Phaser.GameObjects.Image;
  private mask?: Phaser.Display.Masks.BitmapMask;

  constructor(scene: Phaser.Scene, private occluder: Phaser.GameObjects.Image, private occluderFootY: number) {
    this.copy = scene.add.image(0, 0, '__DEFAULT').setVisible(false).setAlpha(ALPHA).setTintFill(FILL).setDepth(occluder.depth + 0.01);
    if (scene.sys.renderer.type === WEBGL) {
      this.mask = occluder.createBitmapMask();
      this.copy.setMask(this.mask);
    }
  }

  update(hero: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null): void {
    const c = this.copy;
    if (!this.on || !hero || !this.mask) { c.setVisible(false); return; }
    // world-px boxes from getBounds(), which already folds in origin, scale and flip
    const hb = hero.getBounds();
    const ob = this.occluder.getBounds();
    const behind = behindOccluder(
      { left: hb.left, right: hb.right, top: hb.top, footY: hb.bottom },
      { left: ob.left, right: ob.right, top: ob.top, footY: this.occluderFootY },
    );
    if (!behind) { c.setVisible(false); return; }
    const p = copyProps(hero);
    c.setTexture(hero.texture.key, hero.frame.name).setPosition(p.x, p.y).setOrigin(p.originX, p.originY).setScale(p.scaleX, p.scaleY).setFlipX(p.flipX).setVisible(true);
  }

  destroy(): void {
    this.copy.clearMask();
    this.copy.destroy();
    this.mask?.destroy();
  }
}

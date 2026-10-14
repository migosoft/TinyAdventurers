// An explosive barrel. Until CC0 barrel art is chosen, the pack's crate stands in.
// Server anim: 0 resting, 1 fuse burning (anim_ms since lit), 2 falling into a
// chasm, 3 sinking in deep water (anim_ms since it started).
import Phaser from 'phaser';
import { CONST } from '../generated/defs';
import { DEPTH } from './effects';

const FRAME = 'crate';

export class BarrelView {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene) {
    this.shadow = scene.add.ellipse(0, 0, 13, 5, 0x000000, 0.4);
    this.body = scene.add.sprite(0, 1, 'atlas', FRAME).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [this.shadow, this.body]);
  }

  update(x: number, y: number, anim: number, animMs: number): void {
    const t = animMs / 1000;
    this.root.setPosition(Math.round(x), Math.round(y)).setDepth(DEPTH.entityBase + y);
    this.body.clearTint().setScale(1).setAlpha(1).setY(1);
    this.shadow.setVisible(true);
    if (anim === 1) {
      // The fuse: flashes faster as it burns down.
      const rate = 6 + (t / CONST.BARREL_FUSE) * 18;
      if (Math.floor(t * rate) % 2 === 0) this.body.setTintFill(0xfff0c0);
      this.root.x += Math.round(Math.sin(t * 90));
    } else if (anim === 2) {
      const k = Math.min(1, t / CONST.FALL_TIME);
      this.body.setScale(1 - 0.8 * k).setAlpha(1 - k);
      this.shadow.setVisible(false);
    } else if (anim === 3) {
      const k = Math.min(1, t / CONST.DROWN_TIME);
      this.body.setY(1 + 10 * k).setAlpha(1 - k);
      this.shadow.setVisible(false);
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}

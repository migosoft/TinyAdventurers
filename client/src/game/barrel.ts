// An explosive barrel (atlas frame `barrel_explosive`, red lid and band; see
// scripts/barrel-frames.ts; the plain `barrel` frame is for non-exploding ones).
// Server anim: 0 resting, 1 fuse burning (anim_ms since lit), 2 falling into a
// chasm, 3 sinking in deep water (anim_ms since it started).
import Phaser from 'phaser';
import { DEPTH } from './effects';
import { barrelPose, CHEST_HEIGHT } from './objectPose';

export class BarrelView {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Ellipse;
  readonly height = CHEST_HEIGHT;

  constructor(scene: Phaser.Scene, frame = 'barrel_explosive') {
    this.shadow = scene.add.ellipse(0, 0, 13, 5, 0x000000, 0.4);
    this.body = scene.add.sprite(0, 1, 'atlas', frame).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [this.shadow, this.body]);
  }

  update(x: number, y: number, anim: number, animMs: number): void {
    const p = barrelPose(anim, animMs);
    this.root.setPosition(Math.round(x) + p.dx, Math.round(y)).setDepth(DEPTH.entityBase + y);
    this.body.clearTint().setScale(p.scale).setAlpha(p.alpha).setY(1 + p.dy);
    if (p.fill !== null) this.body.setTintFill(p.fill);
    this.shadow.setVisible(p.shadow);
  }

  destroy(): void {
    this.root.destroy();
  }
}

// A treasure chest on the board (pack chest_full/empty_open, 3 frames each).
// The server sends anim 1 once it is opened, with the time since then: the
// lid opens over the gold, then the gold is gone (the coins fly out as an
// effect from the Coins event).
import Phaser from 'phaser';
import { DEPTH } from './effects';

const OPEN_T = 0.3;
const EMPTY_AFTER = 0.5;

export class ChestView {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Sprite;

  constructor(scene: Phaser.Scene) {
    const shadow = scene.add.ellipse(0, 0, 13, 5, 0x000000, 0.4);
    this.body = scene.add.sprite(0, 1, 'atlas', 'chest_full_open_anim_f0').setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [shadow, this.body]);
  }

  /** `opened`: seconds since it was opened, or -1 while closed. */
  update(x: number, y: number, opened: number): void {
    this.root.setPosition(Math.round(x), Math.round(y)).setDepth(DEPTH.entityBase + y);
    let frame = 'chest_full_open_anim_f0';
    if (opened >= EMPTY_AFTER) frame = 'chest_empty_open_anim_f2';
    else if (opened >= 0) frame = `chest_full_open_anim_f${Math.min(2, Math.floor((opened / OPEN_T) * 3))}`;
    this.body.setFrame(frame);
  }

  destroy(): void {
    this.root.destroy();
  }
}

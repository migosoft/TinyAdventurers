import type Phaser from 'phaser';
import { FONT_TEXT } from '../fonts';
import { DEPTH } from './effects';
import { smoothText, TEXT_RESOLUTION, WORLD_TEXT } from './worldText';

const W = 11;
const H = 11;

/** The use hint: a gold key cap with a dark 'E' and an optional white label ('Wake') to its right. */
export class KeyCap {
  private g: Phaser.GameObjects.Graphics;
  private e: Phaser.GameObjects.Text;
  private label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.numbers).setVisible(false);
    this.g
      .fillGradientStyle(0xf1cf63, 0xf1cf63, 0xc9962c, 0xc9962c, 1)
      .fillRoundedRect(-W / 2, -H, W, H, 2);
    this.g.lineStyle(1, 0x000000, 1).strokeRoundedRect(-W / 2, -H, W, H, 2);
    this.e = smoothText(
      scene.add
        .text(0, 0, 'E', {
          fontFamily: FONT_TEXT,
          fontStyle: WORLD_TEXT.mark.style,
          fontSize: `${WORLD_TEXT.mark.size}px`,
          color: '#2a1806',
          resolution: TEXT_RESOLUTION,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH.numbers)
        .setVisible(false),
    );
    this.label = smoothText(
      scene.add
        .text(0, 0, '', {
          fontFamily: FONT_TEXT,
          fontStyle: WORLD_TEXT.tag.style,
          fontSize: `${WORLD_TEXT.tag.size}px`,
          color: '#ffffff',
          resolution: TEXT_RESOLUTION,
        })
        .setStroke('#000000', 2)
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.numbers)
        .setVisible(false),
    );
  }

  /** Shows the cap (bottom centre at x, y); `label` is the text to its right, or null for the bare cap. */
  set(label: string | null, x: number, y: number): void {
    this.setShown(true, label, x, y);
  }

  /** Hides the cap. */
  hide(): void {
    this.setShown(false, null, 0, 0);
  }

  private setShown(
    on: boolean,
    label: string | null,
    x: number,
    y: number,
  ): void {
    this.g.setVisible(on).setPosition(x, y);
    this.e.setVisible(on).setPosition(x, y - H / 2);
    this.label
      .setVisible(on && label !== null)
      .setText(label ?? '')
      .setPosition(x + W / 2 + 2, y - H / 2);
  }

  destroy(): void {
    this.g.destroy();
    this.e.destroy();
    this.label.destroy();
  }
}

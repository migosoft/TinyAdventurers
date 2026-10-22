import type Phaser from 'phaser';
import { EFFECT_ICON, iconTextureKey } from '../ui/effectIcons';

const GAP = 2; // world px between the name tag and the first symbol, and between symbols
const SIZE = 5.5; // world px per symbol

/** The symbols of a hero's status effects, in a row to the right of the name tag. Images are pooled. */
export class TagEffects {
  private pool: Phaser.GameObjects.Image[] = [];
  private bits = -1;
  private lastRight = NaN;
  private lastY = NaN;
  private ids: number[];

  constructor(private scene: Phaser.Scene, private parent: Phaser.GameObjects.Container) {
    this.ids = Object.keys(EFFECT_ICON).map(Number);
  }

  /** Lays out the symbols for `bits`; `tagRight` and `tagY` (tag centre) are in the parent's space. Does nothing while `bits` is unchanged. */
  set(bits: number, tagRight: number, tagY: number): void {
    if (bits === this.bits && tagRight === this.lastRight && tagY === this.lastY) return;
    this.bits = bits;
    this.lastRight = tagRight;
    this.lastY = tagY;
    let n = 0;
    for (const id of this.ids) {
      if (!(bits & (1 << id))) continue;
      let img = this.pool[n];
      if (!img) {
        img = this.scene.add.image(0, 0, iconTextureKey(id)).setOrigin(0, 0.5);
        this.parent.add(img);
        this.pool.push(img);
      }
      img.setTexture(iconTextureKey(id)).setDisplaySize(SIZE, SIZE).setPosition(tagRight + GAP + n * (SIZE + 1), tagY).setVisible(true);
      n++;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].setVisible(false);
  }

  destroy(): void {
    for (const img of this.pool) img.destroy();
    this.pool = [];
  }
}

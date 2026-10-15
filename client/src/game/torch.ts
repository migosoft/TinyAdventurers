// A wall torch (atlas frames torch_f*, torch_out; CC0 art by Natural_Privateer,
// see assets-src/torch). The server sends anim 1 lit / 0 out and the side in
// `extra`: 0 on a brick face, 1 on a wall west of the floor, 2 east of it.
// The light itself is drawn by the light canvas, not here.
import Phaser from 'phaser';
import { DEPTH } from './effects';

const FPS = 8;

export class TorchView {
  private img: Phaser.GameObjects.Image;
  private frames: string[];

  constructor(scene: Phaser.Scene) {
    this.frames = scene.textures.get('atlas').getFrameNames().filter((n) => /^torch_f\d+$/.test(n)).sort((a, b) => +a.slice(7) - +b.slice(7));
    this.img = scene.add.image(0, 0, 'atlas', this.frames[0]).setOrigin(0.5, 1);
  }

  update(x: number, y: number, lit: boolean, side: number, t: number): void {
    const frame = lit ? this.frames[Math.floor(t * FPS) % this.frames.length] : 'torch_out';
    // Face: on the bricks above the floor edge; sides: at the side wall's inner edge, facing into the room.
    const [dx, dy, flip] = side === 0 ? [0, -3, false] : side === 1 ? [1, 2, false] : [-1, 2, true];
    this.img.setFrame(frame).setFlipX(flip).setPosition(Math.round(x + dx), Math.round(y + dy)).setDepth(DEPTH.entityBase + y - 16);
  }

  destroy(): void {
    this.img.destroy();
  }
}

// A mimic on the board. The pack has only the 3-frame chest_mimic_open
// animation (closed, lid ajar, jaws open), so all motion comes from those
// frames plus squash/stretch and a hop arc. The chest leaves the ground;
// its shadow stays on the floor and shrinks.
import Phaser from 'phaser';
import { FLAG } from '../generated/defs';
import { DEPTH, Effects } from './effects';
import { BITE_T, CHEST_HEIGHT, HOP, HOP_CYCLE, MimicTracker, mimicPose, WAKE_T, type MimicSnap, type MimicState } from './objectPose';

const F = 'chest_mimic_open_anim_f';
export { BITE_T, HOP, HOP_CYCLE, WAKE_T, type MimicSnap, type MimicState };

export class MimicView {
  readonly root: Phaser.GameObjects.Container;
  private shadow: Phaser.GameObjects.Ellipse;
  private piece: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Sprite;
  private clock = 0;
  private lastHop = -1;
  private wakeFx = false;

  constructor(
    scene: Phaser.Scene,
    private fx: Effects,
  ) {
    this.root = scene.add.container(0, 0);
    this.shadow = scene.add.ellipse(0, 0, 13, 5, 0x000000, 0.4);
    this.body = scene.add.sprite(0, 1, 'atlas', `${F}0`).setOrigin(0.5, 1);
    this.piece = scene.add.container(0, 0, [this.body]);
    this.root.add([this.shadow, this.piece]);
  }

  private tracker = new MimicTracker();

  height = CHEST_HEIGHT;

  /** Drive the view from the server state. `heroDist`: distance to the nearest hero (px). */
  sync(e: MimicSnap, dt: number, heroDist: number): void {
    const dead = (e.flags & FLAG.DEAD) !== 0;
    this.root.setVisible(!dead);
    if (dead) return;
    this.update(this.tracker.step(e, dt, heroDist), dt);
  }

  update(s: MimicState, dt: number): void {
    this.clock += dt;
    this.root.setPosition(Math.round(s.x), Math.round(s.y)).setDepth(DEPTH.entityBase + s.y);
    const mem = { lastHop: this.lastHop, wakeFx: this.wakeFx };
    const p = mimicPose(s, this.clock, mem);
    this.body.setFlipX(p.flip);
    this.lastHop = mem.lastHop;
    this.wakeFx = mem.wakeFx;
    if (p.wakeCue) {
      this.fx.burst(s.x, s.y - 8, 10, 0xffe070, 45, 0.45, 60);
      this.fx.text(s.x, s.y - 18, '!', '#ff5050', { kind: 'mark' });
    }
    if (p.landCue) this.fx.burst(s.x, s.y, 5, 0x9a8a7a, 20, 0.3);

    this.body.setFrame(`${F}${p.frame}`).setPosition(p.bx, 1 + p.by).setAngle(p.angle);
    if (p.hurtFill) this.body.setTintFill(0xffffff);
    else this.body.clearTint();
    this.piece.setPosition(0, -Math.round(p.lift)).setScale(p.sx, p.sy);
    this.shadow.setScale(p.shadowScale).setAlpha(p.shadowAlpha);
  }

  destroy(): void {
    this.root.destroy();
  }
}

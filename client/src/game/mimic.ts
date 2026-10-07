// A mimic on the board. The pack has only the 3-frame chest_mimic_open
// animation (closed, lid ajar, jaws open), so all motion comes from those
// frames plus squash/stretch and a hop arc. The chest leaves the ground;
// its shadow stays on the floor and shrinks.
import Phaser from 'phaser';
import { ANIM, CONST, FLAG } from '../generated/defs';
import { DEPTH, Effects } from './effects';

const F = 'chest_mimic_open_anim_f';
/** Peak height of a hop in pixels. */
const HOP_H = 7;

/** Hop cycle split (fractions of one cycle, from the server). The mimic moves only while airborne. */
export const HOP_CYCLE = CONST.MIMIC_HOP_CYCLE;
export const HOP = { crouch: CONST.MIMIC_HOP_AIR_START, air: CONST.MIMIC_HOP_AIR_END, land: CONST.MIMIC_HOP_AIR_END + 0.15 };
export const BITE_T = 0.35;
export const WAKE_T = CONST.MIMIC_WAKE_T;
/** A sleeping mimic rattles now and then when a hero is this close (px). */
const RATTLE_NEAR = 40;

export interface MimicState {
  x: number;
  y: number;
  /** Still a chest: closed lid, occasional rattle when `rattle` > 0 (0..1 intensity). */
  asleep: boolean;
  rattle?: number;
  /** Seconds since waking (the reveal pop), or -1. */
  wakeT?: number;
  /** Hop cycle phase 0..1, or -1 when not hopping. */
  hop?: number;
  /** Seconds since a bite started, or -1. */
  biteT?: number;
  /** Direction it faces / bites towards (radians). */
  aim: number;
  hurt?: boolean;
}

/** What the server sends for a mimic (an EntSnap, unpacked). */
export interface MimicSnap {
  x: number;
  y: number;
  anim: number;
  animT: number;
  aim: number;
  flags: number;
}

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

  private wasAsleep: boolean | undefined;
  private wakeClock = -1;
  private rattleAt = 1 + Math.random() * 3;

  height = 16;

  /** Drive the view from the server state. `heroDist`: distance to the nearest hero (px). */
  sync(e: MimicSnap, dt: number, heroDist: number): void {
    const dead = (e.flags & FLAG.DEAD) !== 0;
    this.root.setVisible(!dead);
    if (dead) return;
    const asleep = (e.flags & FLAG.ASLEEP) !== 0;
    // The reveal plays only when we saw it asleep; a late joiner just sees the mimic.
    if (this.wasAsleep && !asleep) this.wakeClock = 0;
    else if (this.wakeClock >= 0) this.wakeClock += dt;
    this.wasAsleep = asleep;
    // A disguised mimic gives itself away now and then when a hero comes close.
    let rattle = 0;
    if (asleep && heroDist < RATTLE_NEAR) {
      this.rattleAt -= dt;
      if (this.rattleAt < 0) rattle = 0.5;
      if (this.rattleAt < -0.35) this.rattleAt = 1.5 + Math.random() * 2.5;
    }
    this.update(
      {
        x: e.x,
        y: e.y,
        asleep,
        rattle,
        wakeT: this.wakeClock,
        hop: e.anim === ANIM.Move ? (e.animT / HOP_CYCLE) % 1 : e.anim === ANIM.Windup ? HOP.crouch * 0.8 : -1,
        biteT: e.anim === ANIM.Melee ? e.animT : -1,
        aim: e.aim,
        hurt: (e.flags & FLAG.HURT) !== 0,
      },
      dt,
    );
  }

  update(s: MimicState, dt: number): void {
    this.clock += dt;
    this.root.setPosition(Math.round(s.x), Math.round(s.y)).setDepth(DEPTH.entityBase + s.y);
    const left = Math.cos(s.aim) < -0.15;
    this.body.setFlipX(left);

    let frame = 0;
    let lift = 0; // pixels above the floor
    let sx = 1;
    let sy = 1;
    let bx = 0;
    let by = 0;
    let angle = 0;

    if (s.asleep) {
      // Just a chest. A rattle is a quick shiver with the lid lifting a crack.
      const r = s.rattle ?? 0;
      if (r > 0 && Math.floor(this.clock * 24) % 2 === 0) {
        bx = Math.random() < 0.5 ? -1 : 1;
        angle = (Math.random() * 2 - 1) * 6 * r;
        if (r > 0.6) frame = 1;
      }
      this.wakeFx = false;
    } else if ((s.wakeT ?? -1) >= 0 && s.wakeT! < WAKE_T) {
      // Reveal: the lid flies open and the chest jumps.
      const k = s.wakeT! / WAKE_T;
      frame = k < 0.15 ? 1 : 2;
      lift = Math.sin(Math.min(k / 0.7, 1) * Math.PI) * HOP_H * 1.4;
      sy = k < 0.15 ? 0.8 : 1.15 - k * 0.15;
      sx = 2 - sy;
      if (!this.wakeFx && k >= 0.15) {
        this.wakeFx = true;
        this.fx.burst(s.x, s.y - 8, 10, 0xffe070, 45, 0.45, 60);
        this.fx.text(s.x, s.y - 18, '!', '#ff5050', true);
      }
    } else if ((s.biteT ?? -1) >= 0 && s.biteT! < BITE_T) {
      // Snap: open wide while lunging, then clamp shut.
      const k = s.biteT! / BITE_T;
      frame = k < 0.2 ? 1 : k < 0.6 ? 2 : k < 0.8 ? 1 : 0;
      const lunge = Math.sin(Math.min(k / 0.6, 1) * Math.PI) * 3;
      bx = Math.cos(s.aim) * lunge;
      by = Math.sin(s.aim) * lunge * 0.5;
      lift = k > 0.2 && k < 0.6 ? 2 : 0;
      angle = (left ? -1 : 1) * 10 * Math.sin(k * Math.PI);
    } else if ((s.hop ?? -1) >= 0) {
      const h = s.hop!;
      if (h < HOP.crouch) {
        // Crouch: squash down, lid starts to lift.
        const k = h / HOP.crouch;
        frame = 1;
        sy = 1 - 0.2 * k;
        sx = 1 + 0.15 * k;
      } else if (h < HOP.air) {
        // Airborne: jaws open, stretched on the way up.
        const k = (h - HOP.crouch) / (HOP.air - HOP.crouch);
        frame = 2;
        lift = 4 * k * (1 - k) * HOP_H;
        sy = 1.15 - 0.15 * k;
        sx = 2 - sy;
        angle = (left ? -1 : 1) * (8 - 16 * k);
      } else if (h < HOP.land) {
        // Landing: squash and slam the lid.
        const k = (h - HOP.air) / (HOP.land - HOP.air);
        frame = k < 0.5 ? 1 : 0;
        sy = 0.78 + 0.22 * k;
        sx = 1.2 - 0.2 * k;
        if (this.lastHop < HOP.air) this.fx.burst(s.x, s.y, 5, 0x9a8a7a, 20, 0.3);
      } else {
        // Rest: lid ajar, panting.
        frame = Math.floor(this.clock * 8) % 2 ? 1 : 0;
      }
      this.lastHop = h;
    } else {
      // Awake and standing: slow chomping.
      frame = Math.floor(this.clock * 3) % 3 === 2 ? 2 : 1;
    }

    this.body.setFrame(`${F}${frame}`).setPosition(bx, 1 + by).setAngle(angle);
    if (s.hurt && Math.floor(this.clock * 30) % 2 === 0) this.body.setTintFill(0xffffff);
    else this.body.clearTint();
    this.piece.setPosition(0, -Math.round(lift)).setScale(sx, sy);
    const air = Math.min(lift / HOP_H, 1.4);
    this.shadow.setScale(1 - 0.35 * air).setAlpha(0.4 - 0.15 * air);
  }

  destroy(): void {
    this.root.destroy();
  }
}

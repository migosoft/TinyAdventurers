// One figure on the board: ground shadow + pack body animation + pack weapon.
// The pack has idle/run (4 frames) and hit frames; attacks are approximated
// by animating the weapon sprite (swing, recoil, raise) plus small body moves.
import Phaser from 'phaser';
import { ANIM, CONST, FLAG } from '../../generated/defs';
import { DEPTH, Effects } from '../effects';
import { FIGURES, type Dir, type FigureDef, type FramePoints } from './defs';

export interface ViewState {
  x: number;
  y: number;
  anim: number;
  /** Seconds since the current animation started. */
  animT: number;
  aim: number;
  flags: number;
  /** Pixels the figure stands below a surface (wading in water or lava). */
  sink?: number;
  /** Falling into a chasm, 0..1: the figure shrinks a little and vanishes into the dark. */
  fall?: number;
  /** Sinking in deep water, 0..1: the figure goes down below the surface. */
  drown?: number;
}

/** Multiplies a tint colour channel-wise by `k` and blends it towards `to`. */
function shade(k: number, to: number, mix: number): number {
  const ch = (s: number) => Math.round(255 * k * (1 - mix) + ((to >> s) & 255) * mix) << s;
  return ch(16) | ch(8) | ch(0);
}

const MELEE_T = 0.18;
/** Pack weapons are large next to the tiny figures; draw them smaller. */
const WEAPON_SCALE = 0.6;
const HALF_PI = Math.PI / 2;

/** Soft ground shadow under a figure (pack sprites have none). */
export function ensureShadowTexture(scene: Phaser.Scene, r: number): string {
  const key = `shadow_${r}`;
  if (scene.textures.exists(key)) return key;
  const rx = r;
  const ry = Math.max(2, Math.round(r * 0.45));
  const g = scene.make.graphics({}, false);
  g.fillStyle(0x000000, 0.2);
  g.fillEllipse(rx + 1, ry + 1, rx * 2 + 2, ry * 2 + 2);
  g.fillStyle(0x000000, 0.25);
  g.fillEllipse(rx + 1, ry + 1, rx * 2 - 2, ry * 2 - 1);
  g.generateTexture(key, rx * 2 + 2, ry * 2 + 2);
  g.destroy();
  return key;
}

export class EntityView {
  readonly def: FigureDef;
  readonly root: Phaser.GameObjects.Container;
  private figure: Phaser.GameObjects.Container;
  private shadow: Phaser.GameObjects.Image;
  private body: Phaser.GameObjects.Sprite;
  private weapon?: Phaser.GameObjects.Image;
  /** Ground slam telegraph (the ogre), drawn on the floor. */
  private tele?: Phaser.GameObjects.Graphics;
  private label?: Phaser.GameObjects.Text;
  private clock = 0;
  private runClock = 0;
  private lastX = 0;
  private lastY = 0;
  private lastAnim = -1;
  private ghostT = 0;
  private fxT = 0;
  private shotFx = false;
  private lastAnimT = 0;
  private dir: Dir = 'right';
  speed = 0;

  constructor(
    scene: Phaser.Scene,
    kind: number | FigureDef,
    private fx: Effects,
    name?: string,
  ) {
    this.def = typeof kind === 'number' ? (FIGURES[kind] ?? FIGURES[0]) : kind;
    const d = this.def;
    const scale = d.scale ?? 1;
    this.root = scene.add.container(0, 0);
    this.figure = scene.add.container(0, 0).setScale(scale);
    this.shadow = scene.add.image(0, 0, ensureShadowTexture(scene, d.baseR)).setOrigin(0.5, 0.5);
    this.body = scene.add.sprite(0, 1, 'atlas', `${d.idle}0`).setOrigin(0.5, 1);
    if (d.hue) this.body.preFX?.addColorMatrix().hue(d.hue);
    this.figure.add([this.shadow, this.body]);
    if (d.weapon) {
      this.weapon = scene.add.image(0, -d.handY, 'atlas', d.weapon).setScale(WEAPON_SCALE * (d.weaponScale ?? 1));
      if (d.weaponTint) this.weapon.setTint(d.weaponTint);
      this.figure.add(this.weapon);
    }
    this.root.add(this.figure);
    if (name) {
      this.label = scene.add
        .text(0, -this.body.height * scale - 3, name, { fontFamily: '"Press Start 2P", monospace', fontSize: '8px', resolution: 4, color: '#ffffff' })
        .setFontSize(5)
        .setOrigin(0.5, 1)
        .setStroke('#140c1a', 2);
      this.root.add(this.label);
    }
  }

  get height(): number {
    return this.body.height * (this.def.scale ?? 1);
  }

  update(s: ViewState, dt: number): void {
    const d = this.def;
    this.clock += dt;
    const moved = Math.hypot(s.x - this.lastX, s.y - this.lastY);
    this.speed = this.speed * 0.8 + (dt > 0 ? moved / dt : 0) * 0.2;
    this.lastX = s.x;
    this.lastY = s.y;
    this.root.setPosition(Math.round(s.x), Math.round(s.y));
    this.root.setDepth(DEPTH.entityBase + s.y);

    const dead = (s.flags & FLAG.DEAD) !== 0;
    this.root.setVisible(!dead);
    if (dead) return;
    // A new action starts when the anim changes or its timer restarts (repeated swings).
    if (s.anim !== this.lastAnim || s.animT < this.lastAnimT - 0.02) {
      this.lastAnim = s.anim;
      this.shotFx = false;
    }
    this.lastAnimT = s.animT;

    // Facing follows the aim. TODO(4-dir): pick up/down sheets here once they exist.
    const cos = Math.cos(s.aim);
    if (Math.abs(cos) > 0.15) this.dir = cos < 0 ? 'left' : 'right';
    const left = this.dir === 'left';
    const sgn = left ? -1 : 1;
    this.body.setFlipX(left);

    // ---- body: pack idle/run/hit frames ----
    const hurt = (s.flags & FLAG.HURT) !== 0;
    const moving = s.anim === ANIM.Move || s.anim === ANIM.Dash || this.speed > 8;
    if (moving) this.runClock += dt * Math.min(Math.max(this.speed / 40, 0.7), 2);
    let frame: string;
    if (hurt && d.hit) frame = d.hit;
    else if (moving) frame = `${d.run}${Math.floor(this.runClock * 10) % 4}`;
    else frame = `${d.idle}${Math.floor(this.clock * 6) % 4}`;
    this.body.setFrame(frame).setPosition(0, 1).setScale(1, 1).setAngle(0);
    // Wading: the feet go below the surface (the body is cut off there).
    // Drowning: the figure sinks until it is fully below the surface.
    const fall = s.fall ?? 0;
    const drown = s.drown ?? 0;
    const sink = Math.min(this.body.frame.height, Math.round((s.sink ?? 0) + drown * (this.body.frame.height + 2)));
    if (sink > 0) this.body.setCrop(0, 0, this.body.frame.width, this.body.frame.height - sink);
    else this.body.setCrop();
    this.weapon?.setVisible(drown < 0.4);
    this.shadow.setVisible(sink === 0 && fall === 0);
    this.figure
      .setPosition(0, sink + Math.round(fall * 6))
      .setScale((d.scale ?? 1) * (1 - fall * 0.2))
      .setAlpha(fall > 0.7 ? 1 - (fall - 0.7) / 0.3 : 1);
    this.label?.setVisible(fall === 0 && drown === 0);

    if (hurt && !d.hit && Math.floor(this.clock * 30) % 2 === 0) this.body.setTintFill(0xffffff);
    else if (s.anim === ANIM.Windup || s.anim === ANIM.Slam) {
      // Telegraph: flashing red and a shiver before the blow lands.
      this.body.setTint(Math.floor(this.clock * 16) % 2 ? 0xff8080 : (d.tint ?? 0xffffff));
      this.body.x = Math.floor(this.clock * 40) % 2 ? 1 : -1;
    } else if (s.flags & FLAG.ENRAGED) this.body.setTint(Math.floor(this.clock * 4) % 2 ? 0xff6060 : 0xff9090);
    else if (d.tint) this.body.setTint(d.tint);
    else this.body.clearTint();
    // Into the dark (chasm) or the deep (water): the figure darkens as it goes.
    if (fall > 0) this.body.setTint(shade(1 - fall * 0.95, 0, 0));
    else if (drown > 0) this.body.setTint(shade(1, 0x243f4c, Math.min(1, drown * 1.5)));
    if (fall > 0) this.weapon?.setTint(shade(1 - fall * 0.95, 0, 0));
    else if (d.weaponTint) this.weapon?.setTint(d.weaponTint);
    else this.weapon?.clearTint();

    // Hidden assassin: faint shimmer (enemies do not see it at all).
    this.root.setAlpha(s.flags & FLAG.HIDDEN ? 0.3 + Math.sin(this.clock * 8) * 0.08 : 1);

    const ax = Math.cos(s.aim);
    const ay = Math.sin(s.aim);
    const t = s.animT;
    const scale = d.scale ?? 1;

    // ---- body moves for attacks (the pack has no attack frames) ----
    switch (s.anim) {
      case ANIM.Melee:
      case ANIM.Tail: {
        const tail = s.anim === ANIM.Tail;
        const k = Math.min(t / MELEE_T, 1);
        this.body.x += ax * (tail ? -3 : 3) * (1 - k);
        this.body.y += ay * 1.5 * (1 - k);
        this.body.setAngle(sgn * 8 * Math.sin(k * Math.PI));
        const swing = tail ? d.tail : d.swing;
        if (!d.weapon && !this.shotFx && swing) {
          // Unarmed: claw swoosh in front (demons, dragon) or tail swoosh behind (dragon).
          this.shotFx = true;
          this.swoosh(s, tail ? s.aim + Math.PI : s.aim, sgn, swing.reach, swing.arc, swing.color);
        }
        break;
      }
      case ANIM.Cast:
      case ANIM.Channel:
        this.body.y -= Math.sin(this.clock * 12) > 0 ? 1 : 0;
        if (this.clock - this.fxT > 0.06) {
          this.fxT = this.clock;
          const c = d.weaponTint ?? (s.anim === ANIM.Channel ? 0xff3040 : d.base);
          this.fx.particle(s.x + (Math.random() * 10 - 5) * scale, s.y - (Math.random() * 10 + 6) * scale, 0, -20, 0.5, c);
        }
        break;
      case ANIM.Shoot:
        // Unarmed shooters (imps, chorts): the bolt leaves the hand with a burst.
        if (!d.weapon && !this.shotFx) {
          this.shotFx = true;
          this.body.y -= 1;
          this.fx.hitSpark(s.x + ax * 6, s.y - d.handY * scale, d.base);
        }
        break;
      case ANIM.Breath:
        this.body.setAngle(sgn * -6);
        break;
      case ANIM.Dash:
        this.body.setScale(1.25, 0.9);
        this.ghostT -= dt;
        if (this.ghostT <= 0) {
          this.ghostT = 0.03;
          this.fx.particle(s.x, s.y + 1 - this.height / 2, 0, 0, 0.25, d.base, {
            frame,
            alpha: 0.5,
            flipX: left,
            depth: DEPTH.entityBase + s.y - 1,
          });
        }
        break;
    }

    if (d.mouth) this.breathFx(s);
    if (d.slam) this.slamFx(s, d.slam);

    // ---- weapon ----
    const w = this.weapon;
    if (!w) return;
    const isMelee = s.anim === ANIM.Melee;
    w.setFrame(isMelee && d.meleeWeapon ? d.meleeWeapon : d.weapon!);
    const hx = (d.handX ?? 3) * sgn;
    let alpha = 1;
    let rot = 0;
    let ox = 0;
    let oy = 0;
    switch (d.mount) {
      case 'blade': {
        // Pack blades point up; aim them at the cursor. The swing itself is a
        // swoosh drawn at the real damage reach: the weapon fades out at the
        // start position and fades back in at the end position.
        w.setOrigin(0.5, 0.85);
        rot = s.aim + HALF_PI;
        if (isMelee && d.swing) {
          const k = Math.min(t / MELEE_T, 1);
          const half = d.swing.arc / 2;
          if (!this.shotFx) {
            this.shotFx = true;
            this.swoosh(s, s.aim, sgn, d.swing.reach, d.swing.arc);
          }
          if (k < 0.5) {
            rot -= sgn * half;
            alpha = Math.max(0, 1 - k / 0.2);
          } else {
            rot += sgn * half;
            alpha = Math.min(1, Math.max(0, (k - 0.7) / 0.3));
          }
        } else if (s.anim === ANIM.Windup) rot -= sgn * 1.6;
        else if (s.anim === ANIM.Slam) {
          // Ground slam: the club goes up over the head, then comes down at the impact.
          const k = Math.min(t / 0.3, 1);
          rot = -sgn * 0.5 * k;
          oy = -6 * k;
          ox = -hx * 0.6 * k;
        }
        break;
      }
      case 'bow': {
        w.setOrigin(0.5, 0.5);
        rot = s.aim;
        if (isMelee && d.meleeWeapon) {
          // Assassin dagger stab.
          w.setOrigin(0.5, 0.85);
          rot = s.aim + HALF_PI;
          const k = Math.min(t / 0.15, 1);
          ox = ax * 5 * Math.sin(k * Math.PI);
          oy = ay * 5 * Math.sin(k * Math.PI);
        } else if (s.anim === ANIM.Shoot) {
          const k = Math.min(t / 0.12, 1);
          ox = -ax * 3 * (1 - k);
          oy = -ay * 3 * (1 - k);
          if (!this.shotFx) {
            this.shotFx = true;
            this.fx.hitSpark(s.x + ax * 10, s.y - d.handY + ay * 10, 0xfff0c0);
          }
        } else if (s.anim === ANIM.Windup) {
          ox = -ax * 2;
          oy = -ay * 2;
        }
        // Keep the bow's string toward the archer.
        w.setFlipX(false).setFlipY(false);
        break;
      }
      case 'staff': {
        // Held upright, leaning toward the aim; thrust forward when casting.
        w.setOrigin(0.5, 0.75);
        rot = sgn * 0.25;
        if (s.anim === ANIM.Cast || s.anim === ANIM.Shoot || s.anim === ANIM.Windup || s.anim === ANIM.Channel) {
          const k = Math.min(t / 0.25, 1);
          rot = sgn * 0.25 + (s.aim + HALF_PI - sgn * 0.25) * Math.sin(k * Math.PI) * 0.6;
          if (s.anim !== ANIM.Windup && !this.shotFx) {
            this.shotFx = true;
            this.fx.hitSpark(s.x + ax * 10, s.y - d.handY - 10, d.weaponTint ?? 0xc0a0ff);
          }
        }
        break;
      }
    }
    w.setPosition(hx + ox, -d.handY + oy).setRotation(rot).setAlpha(alpha);
    if (d.mount === 'blade') w.setFlipX(left);
    // Weapon behind the body when aiming upwards.
    this.figure.moveTo(w, ay < -0.3 ? 1 : this.figure.length - 1);
  }

  /**
   * Dragon breath: fire pours from the mouth down into the damage cone on the
   * ground (the server's cone starts at the dragon's feet along the aim).
   * Wind-up: smoke from the nostrils and embers at the mouth.
   */
  private breathFx(s: ViewState): void {
    const depth = DEPTH.entityBase + s.y + 1;
    if (s.anim === ANIM.Breath) {
      const m = this.framePoint(this.def.mouth);
      if (!m) return;
      for (let i = 0; i < 6; i++) {
        const spread = (Math.random() * 2 - 1) * 0.38;
        const reach = 40 + Math.random() * 75;
        const gx = s.x + Math.cos(s.aim + spread) * reach;
        const gy = s.y + Math.sin(s.aim + spread) * reach;
        const life = 0.45 + Math.random() * 0.25;
        this.fx.particle(m.x, m.y, (gx - m.x) / life, (gy - m.y) / life, life, Math.random() < 0.5 ? 0xff7020 : 0xffd040, {
          scale: 1 + Math.random() * 1.5,
          depth,
        });
      }
    } else if (s.anim === ANIM.Windup) {
      const n = this.framePoint(this.def.nostrils);
      const m = this.framePoint(this.def.mouth);
      if (n && Math.random() < 0.35) this.fx.particle(n.x, n.y, (Math.random() - 0.5) * 10, -18, 0.9, 0x706060, { scale: 1.5, depth });
      if (m && Math.random() < 0.5) this.fx.particle(m.x, m.y, (Math.random() - 0.5) * 12, -6, 0.3, 0xff8030, { depth });
    }
  }

  /**
   * World position of a pixel point of the current body frame (e.g. the
   * dragon's mouth), following the frame's bob, flip, tilt and scale.
   */
  framePoint(points?: FramePoints): { x: number; y: number } | null {
    const p = points?.[this.body.frame.name];
    if (!p) return null;
    const w = this.body.width;
    const h = this.body.height;
    // Relative to the body origin (bottom center).
    const lx = (this.body.flipX ? w - p[0] : p[0]) - w / 2;
    const ly = p[1] - h;
    const a = this.body.rotation;
    const rx = lx * Math.cos(a) - ly * Math.sin(a) + this.body.x;
    const ry = lx * Math.sin(a) + ly * Math.cos(a) + this.body.y;
    const sc = this.def.scale ?? 1;
    return { x: this.root.x + rx * sc, y: this.root.y + ry * sc };
  }

  /** Swing arc from one side of the aim to the other (in swing direction) at the damage reach. */
  private swoosh(s: ViewState, aim: number, sgn: number, reach: number, arc: number, color = this.def.swing?.color): void {
    const scale = this.def.scale ?? 1;
    const cx = s.x + (this.def.handX ?? 3) * sgn * scale;
    const cy = s.y - this.def.handY * scale;
    this.fx.swoosh(cx, cy, reach, aim - sgn * (arc / 2), aim + sgn * (arc / 2), color ?? 0xffffff);
  }

  /**
   * Ground slam telegraph: the danger zone is outlined on the ground at the
   * real hit radius, and fills up from the centre until the club lands.
   */
  private slamFx(s: ViewState, r: number): void {
    if (s.anim !== ANIM.Slam) {
      this.tele?.setVisible(false);
      return;
    }
    const g = (this.tele ??= this.root.scene.add.graphics().setDepth(DEPTH.hazard));
    const k = Math.min(s.animT / CONST.OGRE_SLAM_WINDUP, 1);
    const blink = Math.floor(this.clock * 12) % 2 === 0;
    g.clear().setVisible(true).setPosition(Math.round(s.x), Math.round(s.y));
    g.fillStyle(0xff3020, 0.12).fillCircle(0, 0, r);
    g.fillStyle(0xff3020, 0.3).fillCircle(0, 0, r * k);
    g.lineStyle(1, 0xff5040, k > 0.7 && blink ? 1 : 0.7).strokeCircle(0, 0, r);
  }

  destroy(): void {
    this.tele?.destroy();
    this.root.destroy(true);
  }
}

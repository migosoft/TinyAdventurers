// One figure on the board: ground shadow + pack body animation + pack weapon.
// The pack has idle/run (4 frames) and hit frames; attacks are approximated
// by animating the weapon sprite (swing, recoil, raise) plus small body moves.
// Figures with their own action frames (the dragon) pick them in pickFrame.ts.
import Phaser from 'phaser';
import { ANIM, EFFECT, FLAG } from '../../generated/defs';
import { DEPTH, Effects, GLOOM } from '../effects';
import { frameBounds, has, lieLayout, lyingPose, StatusView } from '../status';
import { FIGURES, type Dir, type FigureDef, type FramePoints } from './defs';
import { pickFrame, windupOf } from './pickFrame';

export interface ViewState {
  x: number;
  y: number;
  anim: number;
  /** Seconds since the current animation started. */
  animT: number;
  aim: number;
  flags: number;
  /** The real arc (rad) of the own hero's melee swing, when it is known; otherwise the figure's fixed one. */
  swingArc?: number;
  /** Bitmask of `EffectKind` ids on the creature. */
  effects?: number;
  /** The look of its Entangled effect (`lookOf`); Plain when absent. */
  entangled?: number;
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

/** Horizontal origin of the body: the hips for figures not centred in their frames (`hipX`, mirrored when facing left). */
function originX(d: FigureDef, w: number, left: boolean): number {
  if (d.hipX === undefined) return 0.5;
  return (left ? w - d.hipX - 0.5 : d.hipX + 0.5) / w;
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
  /** Marks of the status effects (blind puff, sleep z's, haste afterimages, flames, frost, poison bubbles). */
  private status: StatusView;
  /** Petrified or frozen: the body frame it was turned to stone (or ice) in. */
  private heldFrame: string | null = null;
  /** Petrified: greyscale filters (WebGL only), created on first use. */
  private stone?: Phaser.FX.ColorMatrix;
  private weaponStone?: Phaser.FX.ColorMatrix;
  private lying = false;
  /** Frozen: the weapon pose is set once, then held. */
  private weaponHeld = false;
  /** Set after the first update (a figure that appears asleep or as stone still takes its facing once). */
  private faced = false;
  /** Seconds of horizontal jitter left (the growl). */
  private shakeT = 0;
  speed = 0;

  constructor(
    scene: Phaser.Scene,
    kind: number | FigureDef,
    private fx: Effects,
    name?: string,
    weapons?: Pick<FigureDef, 'weapon' | 'meleeWeapon'>,
  ) {
    const base = typeof kind === 'number' ? (FIGURES[kind] ?? FIGURES[0]) : kind;
    this.def = weapons ? { ...base, ...weapons } : base;
    const d = this.def;
    const scale = d.scale ?? 1;
    this.root = scene.add.container(0, 0);
    this.figure = scene.add.container(0, 0).setScale(scale);
    this.shadow = scene.add.image(0, 0, ensureShadowTexture(scene, d.baseR)).setOrigin(0.5, 0.5);
    this.body = scene.add.sprite(0, 1, 'atlas', `${d.idle}0`);
    this.body.setOrigin(originX(d, this.body.width, false), (d.footY ?? this.body.height) / this.body.height);
    this.figure.add([this.shadow, this.body]);
    if (d.weapon) {
      this.weapon = scene.add.image(0, -d.handY, 'atlas', d.weapon).setScale(WEAPON_SCALE * (d.weaponScale ?? 1));
      if (d.weaponTint) this.weapon.setTint(d.weaponTint);
      this.figure.add(this.weapon);
    }
    this.root.add(this.figure);
    if (name) {
      this.label = scene.add
        .text(0, -(d.footY ?? this.body.height) * scale - 3, name, { fontFamily: '"Press Start 2P", monospace', fontSize: '8px', resolution: 4, color: '#ffffff' })
        .setFontSize(5)
        .setOrigin(0.5, 1)
        .setStroke('#140c1a', 2);
      this.root.add(this.label);
    }
    this.status = new StatusView(scene, fx, () => {
      const sc = d.scale ?? 1;
      const b = frameBounds(this.body.frame);
      const fw = this.body.frame.width;
      // Opaque columns in display space (mirrored when flipped), from the origin.
      const mid = this.body.flipX ? fw - 1 - (b.l + b.r) / 2 : (b.l + b.r) / 2;
      return {
        x: this.root.x,
        y: this.root.y,
        // Top of the opaque figure: its height standing, its thickness lying down.
        head: this.lying ? (b.r - b.l + 1) * sc : ((d.footY ?? this.body.height) - b.t) * sc,
        w: this.lying ? ((d.footY ?? this.body.height) - b.t) * sc : (b.r - b.l + 1) * sc,
        cx: this.lying ? 0 : (mid + 0.5 - this.body.originX * fw) * sc,
        hand: { x: (d.handX ?? 3) * (this.body.flipX ? -1 : 1) * sc, y: d.handY * sc },
        body: this.body,
        scale: sc,
        alpha: this.root.alpha,
      };
    });
  }

  get height(): number {
    return this.body.height * (this.def.scale ?? 1);
  }

  /** A ±1 px horizontal jitter of the figure at 30 Hz for `secs`. */
  shake(secs: number): void {
    this.shakeT = secs;
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
    if (dead) {
      this.status.update(0, dt);
      return;
    }
    const fxBits = s.effects ?? 0;
    const asleep = has(fxBits, EFFECT.Sleep);
    const stone = has(fxBits, EFFECT.Petrified);
    const slowed = has(fxBits, EFFECT.Slowed);
    const iced = has(fxBits, EFFECT.Frozen);
    const poisoned = has(fxBits, EFFECT.Poisoned);
    const chilled = has(fxBits, EFFECT.Chilled);
    const tainted = has(fxBits, EFFECT.Tainted);
    if (!iced) this.weaponHeld = false;
    // A new action starts when the anim changes or its timer restarts (repeated swings).
    if (s.anim !== this.lastAnim || s.animT < this.lastAnimT - 0.02) {
      this.lastAnim = s.anim;
      this.shotFx = false;
    }
    this.lastAnimT = s.animT;

    // Facing follows the aim. TODO(4-dir): pick up/down sheets here once they exist.
    const cos = Math.cos(s.aim);
    // Lying asleep, turned to stone or frozen, the figure keeps the side it faces (the own hero's aim still follows the mouse).
    if (Math.abs(cos) > 0.15 && (!(asleep || stone || iced) || !this.faced)) this.dir = cos < 0 ? 'left' : 'right';
    this.faced = true;
    const left = this.dir === 'left';
    const sgn = left ? -1 : 1;
    this.body.setFlipX(left);
    if (d.hipX !== undefined) this.body.setOrigin(originX(d, this.body.width, left), this.body.originY);

    // ---- body: pack idle/run/hit frames ----
    const hurt = (s.flags & FLAG.HURT) !== 0;
    const moving = s.anim === ANIM.Move || s.anim === ANIM.Dash || this.speed > 8;
    // Slowed: the legs run at half pace; accelerated: half as fast again; chilled: at 0.7 (the move speed it has).
    const pace = (slowed ? 0.5 : has(fxBits, EFFECT.Accelerated) ? 1.5 : 1) * (chilled ? 0.7 : 1);
    if (moving) this.runClock += dt * Math.min(Math.max(this.speed / 40, 0.7), 2) * pace;
    const own = d.frames ? pickFrame(d, s, this.clock, this.runClock, moving) : null;
    let frame: string;
    if (own) frame = own.frame;
    else if (hurt && d.hit) frame = d.hit;
    else if (moving) frame = `${d.run}${Math.floor(this.runClock * 10) % 4}`;
    else frame = `${d.idle}${Math.floor(this.clock * 6) % 4}`;
    // Petrified or frozen: the figure keeps the frame it was turned to stone (or ice) in.
    if (stone || iced) frame = this.heldFrame ??= frame;
    else this.heldFrame = null;
    // Flying: the body rises above its shadow, which shrinks a little.
    const lift = own?.lift ?? 0;
    this.body.setFrame(frame).setPosition(0, 1 - Math.round(lift * (d.lift ?? 0))).setScale(1, 1).setAngle(0);
    // Wading: the feet go below the surface (the body is cut off there).
    // Drowning: the figure sinks until it is fully below the surface.
    const fall = s.fall ?? 0;
    const drown = s.drown ?? 0;
    const foot = d.footY ?? this.body.frame.height;
    const sink = Math.min(foot, Math.round((s.sink ?? 0) + drown * (foot + 2)));
    if (sink > 0) this.body.setCrop(0, 0, this.body.frame.width, foot - sink);
    else this.body.setCrop();
    this.weapon?.setVisible(drown < 0.4);
    this.shadow.setVisible(sink === 0 && fall === 0).setScale(1 - 0.3 * lift);
    this.figure
      .setPosition(this.shakeT > 0 ? (Math.floor(this.clock * 30) % 2 === 0 ? 1 : -1) : 0, sink + Math.round(fall * 6))
      .setScale((d.scale ?? 1) * (1 - fall * 0.2))
      .setAlpha(fall > 0.7 ? 1 - (fall - 0.7) / 0.3 : 1);
    this.label?.setVisible(fall === 0 && drown === 0);
    this.shakeT = Math.max(0, this.shakeT - dt);

    if (hurt && !d.hit && Math.floor(this.clock * 30) % 2 === 0) this.body.setTintFill(0xffffff);
    else if (!stone && !iced && (s.anim === ANIM.Windup || s.anim === ANIM.Slam || own?.windup)) {
      // Telegraph: flashing red (the lich: pale purple gloom) and a shiver before the blow lands.
      this.body.setTint(Math.floor(this.clock * 16) % 2 ? (d.slam?.gloom ? 0xc890ff : 0xff8080) : (d.tint ?? 0xffffff));
      this.body.x = Math.floor(this.clock * 40) % 2 ? 1 : -1;
      if (own) this.body.y += Math.floor(this.clock * 40) % 2;
    } else if (poisoned) this.body.setTint(shade(1, 0x9be37a, 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 3)));
    else if (slowed) this.body.setTint(0xa0c8ff);
    else if (chilled) this.body.setTint(0xd8ecff);
    else if (tainted) this.body.setTint(shade(1, 0x9be37a, 0.3 * (0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2))));
    else if (s.flags & FLAG.ENRAGED) this.body.setTint(Math.floor(this.clock * 4) % 2 ? 0xff6060 : 0xff9090);
    else if (d.tint) this.body.setTint(d.tint);
    else this.body.clearTint();
    // Into the dark (chasm) or the deep (water): the figure darkens as it goes.
    if (fall > 0) this.body.setTint(shade(1 - fall * 0.95, 0, 0));
    else if (drown > 0) this.body.setTint(shade(1, 0x243f4c, Math.min(1, drown * 1.5)));
    if (fall > 0) this.weapon?.setTint(shade(1 - fall * 0.95, 0, 0));
    else if (d.weaponTint) this.weapon?.setTint(d.weaponTint);
    else this.weapon?.clearTint();

    // Asleep: lying on the floor towards the facing, the side on the floor cut
    // off so the body rests on the ground, the shadow stretched under it.
    this.lying = asleep;
    if (asleep) {
      const pose = lyingPose(foot, left);
      const cut = d.lieCrop ?? pose.cropBottom;
      const w = this.body.frame.width;
      // After ±90° the frame's side edge faces the floor (the crop is in display space, after the flip):
      // its right edge falling right (90°), its left edge falling left (-90°). The squash is on the
      // frame's x axis, which is the vertical one once the body is turned.
      const lay = lieLayout(frameBounds(this.body.frame), w, foot, this.body.originX * w, left, cut, pose.squash);
      // Phaser draws a flipped, cropped sprite shifted by the crop's x (towards the
      // cut, here: down once turned); move it back up by the same amount.
      const flipFix = left ? Math.round(lay.cropX * pose.squash) : 0;
      this.body.setAngle(pose.angle).setScale(pose.squash, 1).setPosition(lay.x, lay.y - flipFix);
      this.body.setCrop(lay.cropX, 0, lay.cropW, foot);
      this.shadow.setScale(1.6, 1);
    }
    // Petrified: grey stone (a greyscale filter on body and weapon, WebGL only).
    if (stone) {
      this.stone ??= this.body.preFX?.addColorMatrix();
      this.stone?.grayscale(1);
      if (this.weapon) {
        this.weaponStone ??= this.weapon.preFX?.addColorMatrix();
        this.weaponStone?.grayscale(1);
      }
    }
    if (this.stone) this.stone.active = stone;
    if (this.weaponStone) this.weaponStone.active = stone;
    this.status.update(fxBits, dt, s.entangled);
    if (asleep) this.weapon?.setVisible(false);

    this.root.setAlpha(1);

    const ax = Math.cos(s.aim);
    const ay = Math.sin(s.aim);
    const t = s.animT;
    const scale = d.scale ?? 1;

    // ---- body moves for attacks (the pack has no attack frames); none asleep, turned to stone or frozen ----
    const still = asleep || stone || iced;
    if (!still) switch (s.anim) {
      case ANIM.Melee:
      case ANIM.Tail: {
        const tail = s.anim === ANIM.Tail;
        // Own frames: the strike comes after the wind-up, drawn by the frames.
        const w = windupOf(d, s.anim, s.flags);
        if (t < w) break;
        if (!own) {
          const k = Math.min(t / MELEE_T, 1);
          this.body.x += ax * (tail ? -3 : 3) * (1 - k);
          this.body.y += ay * 1.5 * (1 - k);
          this.body.setAngle(sgn * 8 * Math.sin(k * Math.PI));
        }
        // Darting toward the aim over the first 0.15 s, out and back (the wolf's bite).
        if (d.lunge && !tail) {
          const lk = Math.sin(Math.min(t / 0.15, 1) * Math.PI);
          this.body.x += ax * d.lunge * lk;
          this.body.y += ay * d.lunge * lk;
        }
        const swing = tail ? d.tail : d.swing;
        if (!d.weapon && !this.shotFx && swing) {
          // Unarmed: claw swoosh in front (demons, dragon) or tail swoosh behind (dragon).
          this.shotFx = true;
          this.swoosh(s, tail ? s.aim + Math.PI : s.aim, sgn, swing.reach, swing.arc, swing.color);
        }
        break;
      }
      case ANIM.Bite:
        // The jaws snap shut at the bite reach, straight ahead.
        if (d.bite && t >= (d.windups?.[ANIM.Bite] ?? 0) && !this.shotFx) {
          this.shotFx = true;
          const bx = s.x + ax * d.bite.reach;
          const by = s.y + ay * d.bite.reach - d.handY * scale;
          this.fx.hitSpark(bx, by, d.bite.color);
          this.fx.burst(bx, by, 6, d.bite.color, 40, 0.2);
        }
        break;
      case ANIM.Cast:
      case ANIM.Channel:
        if (!own) this.body.y -= Math.sin(this.clock * 12) > 0 ? 1 : 0;
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
        if (!own) this.body.setAngle(sgn * -6);
        break;
      case ANIM.Dash:
        // Own frames draw the charge (and its wind-up); pack figures stretch.
        if (!own) this.body.setScale(1.25, 0.9);
        this.ghostT -= dt;
        if (this.ghostT <= 0 && !own?.windup) {
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

    if (d.mouth && !still) this.breathFx(s);
    if (d.slam) this.slamFx(s, d.slam, still);

    // ---- weapon ----
    const w = this.weapon;
    // Frozen: the weapon stays as it was when the ice took hold (posed once, then held).
    if (!w || asleep || (iced && this.weaponHeld)) return;
    this.weaponHeld = iced;
    const isMelee = s.anim === ANIM.Melee;
    w.setFrame(isMelee && d.meleeWeapon ? d.meleeWeapon : d.weapon!);
    w.setScale(WEAPON_SCALE * ((isMelee && d.meleeWeapon ? d.meleeWeaponScale : undefined) ?? d.weaponScale ?? 1));
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
          // A full-circle swing (Whirl) sweeps all the way round.
          const arc = s.swingArc ?? d.swing.arc;
          const half = Math.min(arc, Math.PI * 2) / 2;
          if (!this.shotFx) {
            this.shotFx = true;
            this.swoosh(s, s.aim, sgn, d.swing.reach, arc);
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
          // Ranger rapier thrust: along the aim, not a swing.
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
        else if (s.anim === ANIM.Slam) {
          // Nova wind-up: the staff held high, the orb gathering gloom.
          rot = 0;
          oy = -4;
          if (Math.random() < 0.5) this.fx.particle(s.x + hx, s.y - d.handY - 18, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 0.3, Math.random() < 0.5 ? GLOOM.dark : GLOOM.spark, { frame: 'spark' });
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
   * Wind-up (the Windup anim, or the start of Breath for figures with breath
   * wind-up frames): smoke from the nostrils and embers at the mouth.
   */
  private breathFx(s: ViewState): void {
    const depth = DEPTH.entityBase + s.y + 1;
    const windup = this.def.windups?.[ANIM.Breath] ?? 0;
    if (s.anim === ANIM.Breath && s.animT >= windup) {
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
    } else if (s.anim === ANIM.Windup || s.anim === ANIM.Breath) {
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
    // Relative to the body origin (bottom center, or the feet row).
    const lx = (this.body.flipX ? w - p[0] : p[0]) - w / 2;
    const ly = p[1] - (this.def.footY ?? h);
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
   * real hit radius, and fills up from the centre over the `dur` s of `anim`
   * until the blow lands (the ogre's club, the dragon's landing).
   */
  private slamFx(s: ViewState, slam: NonNullable<FigureDef['slam']>, still = false): void {
    const { r, anim, t: dur } = slam;
    if (s.anim !== anim || still) {
      this.tele?.setVisible(false);
      return;
    }
    const g = (this.tele ??= this.root.scene.add.graphics().setDepth(DEPTH.hazard));
    const k = Math.min(s.animT / dur, 1);
    const blink = Math.floor(this.clock * 12) % 2 === 0;
    const fill = slam.gloom ? GLOOM.mid : (slam.color ?? 0xff3020);
    const edge = slam.color ?? 0xff5040;
    g.clear().setVisible(true).setPosition(Math.round(s.x), Math.round(s.y));
    g.fillStyle(fill, 0.12).fillCircle(0, 0, r);
    g.fillStyle(fill, 0.3).fillCircle(0, 0, r * k);
    g.lineStyle(1, edge, k > 0.7 && blink ? 1 : 0.7).strokeCircle(0, 0, r);
    // Gloom: dark wisps and pale sparks drawn in from the edge while it charges.
    if (slam.gloom && Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2;
      const ex = s.x + Math.cos(a) * r, ey = s.y + Math.sin(a) * r;
      const dark = Math.random() < 0.6;
      this.fx.particle(ex, ey, (s.x - ex) * 2, (s.y - 10 - ey) * 2, 0.45, dark ? GLOOM.dark : GLOOM.spark, { frame: dark ? 'dot' : 'spark', scale: dark ? 1.6 : 1, depth: DEPTH.hazard + 1 });
    }
  }

  destroy(): void {
    this.tele?.destroy();
    this.status.destroy();
    this.root.destroy(true);
  }
}

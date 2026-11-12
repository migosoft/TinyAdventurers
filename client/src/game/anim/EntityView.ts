// One figure on the board: ground shadow + pack body animation + pack weapon.
// The pack has idle/run (4 frames) and hit frames; attacks are approximated
// by animating the weapon sprite (swing, recoil, raise) plus small body moves.
// Figures with their own action frames (the dragon) pick them in pickFrame.ts.
import Phaser from 'phaser';
import { ANIM, EFFECT } from '../../generated/defs';
import { DEPTH, Effects, GLOOM } from '../effects';
import { FONT_TEXT } from '../../fonts';
import { smoothText, TEXT_RESOLUTION, WORLD_TEXT } from '../worldText';
import { TagEffects } from '../tagEffects';
import { frameBounds, has, StatusView } from '../status';
import { FIGURES, type FigureDef, type FramePoints } from './defs';
import { bodyLookFrom, type BodyLook } from '../silhouette';
import { ShadeVeil, silhouetteAlpha } from '../shadeHaze';
import { windupOf } from './pickFrame';
import { appearFactor, VANISH_SECS } from './entityAlpha';
import { figurePose, newPoseMemory, originXOf, WEAPON_SCALE, type ViewState } from './pose';

export type { ViewState };

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
  private tagFx?: TagEffects;
  /** The pose's memory: clocks, speed, facing, held frames, the fade-in. */
  private mem = newPoseMemory();
  private lastAnim = -1;
  private fxT = 0;
  private shotFx = false;
  private lastAnimT = 0;
  /** Marks of the status effects (blind puff, sleep z's, haste afterimages, flames, frost, poison bubbles). */
  private status: StatusView;
  /** Petrified: greyscale filters (WebGL only), created on first use. */
  private stone?: Phaser.FX.ColorMatrix;
  private weaponStone?: Phaser.FX.ColorMatrix;
  private lying = false;
  /** The Shade's veil of strands (`FigureDef.veil`). */
  private veil?: ShadeVeil;

  get speed(): number {
    return this.mem.speed;
  }
  set speed(v: number) {
    this.mem.speed = v;
  }

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
    this.body.setOrigin(originXOf(d, this.body.width, false), (d.footY ?? this.body.height) / this.body.height);
    this.figure.add([this.shadow, this.body]);
    if (d.weapon) {
      this.weapon = scene.add.image(0, -d.handY, 'atlas', d.weapon).setScale(WEAPON_SCALE * (d.weaponScale ?? 1));
      if (d.weaponTint) this.weapon.setTint(d.weaponTint);
      this.figure.add(this.weapon);
    }
    this.root.add(this.figure);
    if (d.veil) this.veil = new ShadeVeil(scene);
    if (name) {
      this.label = scene.add
        .text(0, -(d.footY ?? this.body.height) * scale - 3, name, { fontFamily: FONT_TEXT, fontStyle: WORLD_TEXT.tag.style, fontSize: `${WORLD_TEXT.tag.size}px`, resolution: TEXT_RESOLUTION, color: '#ffffff' })
        .setOrigin(0.5, 1)
        .setStroke('#000000', 2);
      smoothText(this.label);
      this.root.add(this.label);
      this.tagFx = new TagEffects(scene, this.root);
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

  /** The body sprite in world space, for the silhouette (#202): root + figure scale + the body's local offset. */
  bodyLook(): BodyLook {
    return bodyLookFrom(this.root, this.figure, this.body);
  }

  get height(): number {
    return this.body.height * (this.def.scale ?? 1);
  }

  update(s: ViewState, dt: number): void {
    const d = this.def;
    const pose = figurePose(d, { ...s, screenAim: s.aim }, dt, this.mem, (f) => {
      const fr = this.body.texture.get(f);
      return { ...frameBounds(fr), w: fr.width, h: fr.height };
    });
    this.root.setPosition(Math.round(s.x), Math.round(s.y));
    this.root.setDepth(DEPTH.entityBase + s.y);

    this.root.setVisible(pose.visible);
    if (!pose.visible) {
      this.veil?.update(null, 1, 0, 0, dt);
      this.status.update(0, dt);
      return;
    }
    const fxBits = s.effects ?? 0;
    const asleep = has(fxBits, EFFECT.Sleep);
    const stone = has(fxBits, EFFECT.Petrified);
    const iced = has(fxBits, EFFECT.Frozen);
    // A new action starts when the anim changes or its timer restarts (repeated swings).
    if (s.anim !== this.lastAnim || s.animT < this.lastAnimT - 0.02) {
      this.lastAnim = s.anim;
      this.shotFx = false;
    }
    this.lastAnimT = s.animT;

    const left = pose.left;
    const sgn = left ? -1 : 1;
    this.body.setFlipX(left);
    if (d.hipX !== undefined) this.body.setOrigin(pose.originX, this.body.originY);

    // ---- body: the pose's frame, position, tilt and stretch (an own-frames figure's lift included) ----
    const fall = s.fall ?? 0;
    const drown = s.drown ?? 0;
    const frame = pose.frame;
    const aimStep = pose.aimStep;
    this.body.setFrame(frame).setPosition(pose.body.x + aimStep.x, pose.body.y + aimStep.y).setScale(pose.body.sx, pose.body.sy).setAngle(pose.body.angle);
    if (pose.lie) {
      // Phaser draws a flipped, cropped sprite shifted by the crop's x (towards the
      // cut, here: down once turned); move it back up by the same amount.
      this.body.y -= left ? Math.round(pose.lie.cropX * pose.lie.squash) : 0;
      this.body.setCrop(pose.lie.cropX, 0, pose.lie.cropW, pose.footY);
    } else if (pose.sink > 0) this.body.setCrop(0, 0, this.body.frame.width, pose.footY - pose.sink);
    else this.body.setCrop();
    this.shadow.setVisible(pose.shadow.visible).setScale(pose.shadow.sx, pose.shadow.sy);
    this.figure.setPosition(0, pose.sink + pose.drop).setScale(pose.scale).setAlpha(pose.figureAlpha);
    const tagShown = fall === 0 && drown === 0;
    this.label?.setVisible(tagShown);
    if (this.label && this.tagFx) this.tagFx.set(tagShown ? fxBits : 0, this.label.x + this.label.displayWidth / 2, this.label.y - this.label.displayHeight / 2);

    // The ambush wind-up of a silhouette figure (the Shade): a flat dark shape, no eyes, fainter than the real thing.
    const silhouette = pose.silhouette;
    const tint = pose.tint;
    if (tint.mode === 'fill') this.body.setTintFill(tint.rgb);
    else if (tint.mode === 'mul') this.body.setTint(tint.rgb);
    else this.body.clearTint();
    if (pose.weaponTint !== null) this.weapon?.setTint(pose.weaponTint);
    else this.weapon?.clearTint();

    // Asleep: the pose lies the body on the floor (above); the status marks read this.
    this.lying = asleep;
    // Petrified: grey stone (a greyscale filter on body and weapon, WebGL only).
    // A PreFX filter draws the sprite through a render-to-texture pass for as long as
    // the FX pipeline is set, even with the controller inactive, so it is removed
    // (`disable(true)` resets the pipeline and destroys the controller) once the stone ends.
    if (pose.grey) {
      this.stone ??= this.body.preFX?.addColorMatrix();
      this.stone?.grayscale(1);
      if (this.weapon) {
        this.weaponStone ??= this.weapon.preFX?.addColorMatrix();
        this.weaponStone?.grayscale(1);
      }
    } else {
      if (this.stone) (this.body.preFX?.disable(true), (this.stone = undefined));
      if (this.weaponStone) (this.weapon?.preFX?.disable(true), (this.weaponStone = undefined));
    }
    this.status.update(fxBits, dt, s.entangled);
    this.weapon?.setVisible(pose.weapon !== null);
    this.root.setAlpha(pose.rootAlpha);

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
        // The step, tilt and lunge are in the pose; own frames strike after the wind-up, drawn by the frames.
        if (t < windupOf(d, s.anim)) break;
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
        if (this.mem.clock - this.fxT > 0.06) {
          this.fxT = this.mem.clock;
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
      case ANIM.Dash:
        // The stretch is in the pose; so is the afterimage's timing.
        if (pose.afterimage) {
          this.fx.particle(s.x, s.y + 1 - this.height / 2, 0, 0, 0.25, d.base, {
            frame,
            alpha: 0.5,
            flipX: left,
            depth: DEPTH.entityBase + s.y - 1,
          });
        }
        break;
    }

    // The veil clings to the body (so it follows the attack dash), fades in with it and rises with the ambush warning.
    this.veil?.update({ x: Math.round(s.x) + this.body.x, y: Math.round(s.y) + this.body.y - 1 }, this.body.flipX ? -1 : 1, this.root.depth, (silhouette ? silhouetteAlpha(s.animT) : 1) * appearFactor(this.mem.appearLeft, VANISH_SECS), dt);

    if (d.mouth && !still) this.breathFx(s);
    if (d.slam) this.slamFx(s, d.slam, still);

    // ---- weapon ----
    const w = this.weapon;
    const wp = pose.weapon;
    if (w && wp) {
      w.setFrame(wp.frame).setScale(wp.scale).setOrigin(wp.originX, wp.originY).setPosition(wp.x, wp.y).setRotation(wp.rot).setAlpha(wp.alpha).setFlipX(wp.flipX);
      // Weapon behind the body when aiming upwards.
      this.figure.moveTo(w, wp.behind ? 1 : this.figure.length - 1);
    }
    if (w && pose.weaponFresh) this.weaponFx(s, sgn);
  }

  /** Sparks, swooshes and the nova's gloom of an armed figure's attacks (the weapon's own pose is in `figurePose`); once per action (`shotFx`). */
  private weaponFx(s: ViewState, sgn: number): void {
    const d = this.def;
    const ax = Math.cos(s.aim);
    const ay = Math.sin(s.aim);
    const hx = (d.handX ?? 3) * sgn;
    const isMelee = s.anim === ANIM.Melee;
    switch (d.mount) {
      case 'blade':
        // The swing itself is a swoosh drawn at the real damage reach.
        if (isMelee && d.swing && !this.shotFx) {
          this.shotFx = true;
          this.swoosh(s, s.aim, sgn, d.swing.reach, s.swingArc ?? d.swing.arc);
        }
        break;
      case 'bow':
        if (!(isMelee && d.meleeWeapon) && s.anim === ANIM.Shoot && !this.shotFx) {
          this.shotFx = true;
          this.fx.hitSpark(s.x + ax * 10, s.y - d.handY + ay * 10, 0xfff0c0);
        }
        break;
      case 'staff':
        if (s.anim === ANIM.Cast || s.anim === ANIM.Shoot || s.anim === ANIM.Windup || s.anim === ANIM.Channel) {
          if (s.anim !== ANIM.Windup && !this.shotFx) {
            this.shotFx = true;
            this.fx.hitSpark(s.x + ax * 10, s.y - d.handY - 10, d.weaponTint ?? 0xc0a0ff);
          }
        } else if (s.anim === ANIM.Slam) {
          // Nova wind-up: the orb gathering gloom.
          if (Math.random() < 0.5) this.fx.particle(s.x + hx, s.y - d.handY - 18, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 0.3, Math.random() < 0.5 ? GLOOM.dark : GLOOM.spark, { frame: 'spark' });
        }
        break;
    }
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
    const blink = Math.floor(this.mem.clock * 12) % 2 === 0;
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

  /** Fade in from nothing (the entity reappears). */
  fadeIn(): void {
    this.mem.appearLeft = VANISH_SECS;
    this.root.setAlpha(0);
  }

  /** A ghost image of the figure at its spot, fading out over `VANISH_SECS` (the entity went invisible). */
  ghost(): void {
    const b = this.body;
    const g = this.root.scene.add
      .image(this.root.x, this.root.y, b.texture.key, b.frame.name)
      .setOrigin(b.originX, b.originY)
      .setScale(this.figure.scaleX * (b.flipX ? -1 : 1), this.figure.scaleY)
      .setDepth(this.root.depth)
      .setAlpha(this.root.alpha);
    g.y += b.y * this.figure.scaleY;
    this.root.scene.tweens.add({ targets: g, alpha: 0, duration: VANISH_SECS * 1000, onComplete: () => g.destroy() });
  }

  /** The Shade's veil and body as they were last drawn, for its death (`Effects.shadeDeath`); null without a veil. */
  veilRemains(): { veil: ReturnType<ShadeVeil['remains']>; body: { frame: string; flipX: boolean } } | null {
    if (!this.veil) return null;
    return { veil: this.veil.remains(), body: { frame: this.body.frame.name, flipX: this.body.flipX } };
  }

  destroy(): void {
    this.veil?.destroy();
    this.tele?.destroy();
    this.status.destroy();
    this.tagFx?.destroy();
    this.root.destroy(true);
  }
}

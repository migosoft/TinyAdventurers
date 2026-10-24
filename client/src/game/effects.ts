// Pooled visual effects: particles, damage numbers, rings, decals.
// Everything is pooled so combat does not allocate per frame.
import type Phaser from 'phaser';
import { FONT_TEXT } from '../fonts';
import { popScale, smoothText, TEXT_RESOLUTION, WORLD_TEXT, type WorldTextKind } from './worldText';

export const DEPTH = {
  map: 0,
  decal: 1,
  hazard: 2,
  entityBase: 10,
  projectile: 5000,
  fx: 6000,
  /** Enemy HP bars: over figures and effects, under the darkness, so they vanish where it is dark. */
  enemyBars: 6500,
  /** Damage and heal numbers on enemies: under the darkness, so they vanish where it is dark. */
  enemyNumbers: 6501,
  /** Tint of the lights (MULTIPLY blend), just below the darkness. */
  tint: 6999,
  /** The darkness (light canvas). Every figure and shot is under it, heroes too. */
  fog: 7000,
  /** Lich drain beams: above the fog, they show even where the hero cannot see. */
  beam: 7001,
  /** Sound text ("grrrr", the sleeper's Z): above the darkness, under the damage numbers. */
  sound: 7500,
  /** Hero and ally HP bars: over the darkness, so they show even when the hero is unlit. */
  heroBars: 7999,
  /** Numbers on heroes and allies, coins, key caps and other top world text: over the darkness. */
  numbers: 8000,
};

/** The depth of a damage or heal number: over the darkness on a hero or ally, under it on an enemy. */
export function numberDepth(onHero: boolean): number {
  return onHero ? DEPTH.numbers : DEPTH.enemyNumbers;
}

/** Sound text (growl, the sleeper's Z): a dark fill with a light outline, readable on black and on lit floors. */
export const SOUND_TEXT = { fill: '#1a1020', stroke: '#d8d0e0' };

/** The lich's magic: dark purple, gloomy, shimmering. */
export const GLOOM = { dark: 0x2a0a3a, mid: 0x5a1a8a, light: 0xa060f0, spark: 0xe0c0ff };

interface Particle {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  max: number;
  grav: number;
  fade: boolean;
  /** Starting alpha; fading goes from it down to 0. */
  alpha: number;
  shrink: boolean;
}

interface Ring {
  g: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  r: number;
  color: number;
  life: number;
  max: number;
  fill: boolean;
}

interface Swoosh {
  g: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  r: number;
  a0: number;
  a1: number;
  color: number;
  life: number;
  max: number;
}

interface Zap {
  g: Phaser.GameObjects.Graphics;
  life: number;
  max: number;
}

interface FloatText {
  t: Phaser.GameObjects.Text;
  /** Seconds since it appeared; only a crit pops. */
  age: number;
  pop: boolean;
  vy: number;
  life: number;
  max: number;
}

export class Effects {
  private particles: Particle[] = [];
  private freeImgs: Phaser.GameObjects.Image[] = [];
  private rings: Ring[] = [];
  private freeRings: Phaser.GameObjects.Graphics[] = [];
  private swooshes: Swoosh[] = [];
  private zaps: Zap[] = [];
  private texts: FloatText[] = [];
  private freeTexts: Phaser.GameObjects.Text[] = [];

  constructor(private scene: Phaser.Scene) {}

  particle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    color: number,
    opts: { frame?: string; grav?: number; fade?: boolean; shrink?: boolean; scale?: number; depth?: number; alpha?: number; flipX?: boolean } = {},
  ): void {
    if (this.particles.length > 900) return;
    const img = this.freeImgs.pop() ?? this.scene.add.image(0, 0, 'dot');
    const f = opts.frame ?? 'dot';
    // Runtime effect textures (dot, spark, glow) or a pack frame (dash afterimages).
    if (this.scene.textures.exists(f)) img.setTexture(f);
    else img.setTexture('atlas', f);
    img.setPosition(x, y).setTint(color).setAlpha(opts.alpha ?? 1).setScale(opts.scale ?? 1);
    img.setFlipX(opts.flipX ?? false).setVisible(true).setDepth(opts.depth ?? DEPTH.fx);
    this.particles.push({ img, vx, vy, life, max: life, grav: opts.grav ?? 0, fade: opts.fade ?? true, shrink: opts.shrink ?? false, alpha: opts.alpha ?? 1 });
  }

  burst(x: number, y: number, n: number, color: number, speed: number, life = 0.4, grav = 0): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), color, { grav });
    }
  }

  ring(x: number, y: number, r: number, color: number, life = 0.35, fill = false): void {
    const g = this.freeRings.pop() ?? this.scene.add.graphics();
    g.setVisible(true).setDepth(DEPTH.fx - 1);
    this.rings.push({ g, x, y, r, color, life, max: life, fill });
  }

  /**
   * A floating number or word; `depth`: `numberDepth(onHero)` for a damage or heal number. `opts.big` is the crit path
   * (gold, larger, pops); `opts.kind` picks the size and weight of the others (default: a damage number).
   */
  text(x: number, y: number, s: string, color: string, opts: { big?: boolean; depth?: number; stroke?: string; kind?: WorldTextKind } = {}): void {
    const { big = false, depth = DEPTH.numbers, stroke = '#000000', kind = 'number' } = opts;
    const t = this.freeTexts.pop() ?? smoothText(this.scene.add.text(0, 0, '', { fontFamily: FONT_TEXT, resolution: TEXT_RESOLUTION }));
    const w = WORLD_TEXT[big ? 'crit' : kind];
    t.setText(s).setColor(color).setFontStyle(w.style).setFontSize(w.size).setStroke(stroke, 2).setOrigin(0.5, 1);
    t.setPosition(Math.round(x + (Math.random() * 6 - 3)), Math.round(y)).setAlpha(1).setVisible(true).setDepth(depth).setScale(big ? popScale(0) : 1);
    this.texts.push({ t, age: 0, pop: big, vy: big ? -34 : -26, life: big ? 0.9 : 0.7, max: big ? 0.9 : 0.7 });
  }

  /** The wolf's summon, reappear and vanish: about 18 clear-green sparks rising and fading over 0.6 s (not the poison tint). */
  natureSparkles(x: number, y: number, r: number): void {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * Math.max(r, 6);
      this.particle(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5, (Math.random() - 0.5) * 14, -14 - Math.random() * 18, 0.6, Math.random() < 0.5 ? 0x60f070 : 0xc0ffb0, { frame: 'spark', fade: true });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.img.setVisible(false);
        this.freeImgs.push(p.img);
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      p.vy += p.grav * dt;
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      const k = p.life / p.max;
      if (p.fade) p.img.setAlpha(p.alpha * k);
      if (p.shrink) p.img.setScale(k);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        r.g.clear().setVisible(false);
        this.freeRings.push(r.g);
        this.rings.splice(i, 1);
        continue;
      }
      const k = 1 - r.life / r.max;
      r.g.clear();
      const rad = r.r * (0.3 + 0.7 * Math.sqrt(k));
      if (r.fill) {
        r.g.fillStyle(r.color, 0.35 * (1 - k));
        r.g.fillCircle(r.x, r.y, rad);
      }
      r.g.lineStyle(2, r.color, 1 - k);
      r.g.strokeCircle(r.x, r.y, rad);
    }
    for (let i = this.zaps.length - 1; i >= 0; i--) {
      const z = this.zaps[i];
      z.life -= dt;
      if (z.life <= 0) {
        z.g.clear().setVisible(false).setAlpha(1);
        this.freeRings.push(z.g);
        this.zaps.splice(i, 1);
        continue;
      }
      z.g.setAlpha(z.life / z.max);
    }
    for (let i = this.swooshes.length - 1; i >= 0; i--) {
      const s = this.swooshes[i];
      s.life -= dt;
      if (s.life <= 0) {
        s.g.clear().setVisible(false);
        this.freeRings.push(s.g);
        this.swooshes.splice(i, 1);
        continue;
      }
      this.drawSwoosh(s);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const f = this.texts[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.t.setVisible(false);
        this.freeTexts.push(f.t);
        this.texts.splice(i, 1);
        continue;
      }
      f.age += dt;
      if (f.pop) f.t.setScale(popScale(f.age));
      f.t.y += f.vy * dt;
      f.vy *= 0.92;
      f.t.setAlpha(Math.min(1, (f.life / f.max) * 2));
    }
  }

  /**
   * Melee swing swoosh: a crescent at `r` sweeping from angle a0 to a1. The
   * head races ahead and the tail follows, so it reads as a fast blade arc.
   */
  swoosh(x: number, y: number, r: number, a0: number, a1: number, color = 0xffffff, life = 0.2): void {
    const g = this.freeRings.pop() ?? this.scene.add.graphics();
    g.setVisible(true).setDepth(DEPTH.fx - 1);
    this.swooshes.push({ g, x, y, r, a0, a1, color, life, max: life });
  }

  private drawSwoosh(s: Swoosh): void {
    const p = 1 - s.life / s.max;
    const g = s.g.clear();
    const span = s.a1 - s.a0;
    // Head sweeps to the end quickly, tail follows and catches up.
    const head = s.a0 + span * Math.min(1, p / 0.35);
    const tail = s.a0 + span * Math.min(1, Math.max(0, (p - 0.2) / 0.8));
    if (Math.abs(head - tail) < 0.03) return;
    const fade = 1 - Math.max(0, p - 0.5) / 0.5;
    const thick = Math.max(3, s.r * 0.22);
    const n = 18;
    const outer: Phaser.Types.Math.Vector2Like[] = [];
    const inner: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const a = tail + (head - tail) * k;
      // Crescent: thin at the tail, thickest near the head.
      const th = thick * Math.pow(k, 0.8) * (k > 0.9 ? 1 - (k - 0.9) * 4 : 1);
      outer.push({ x: s.x + Math.cos(a) * s.r, y: s.y + Math.sin(a) * s.r * 0.8 });
      inner.push({ x: s.x + Math.cos(a) * (s.r - th), y: s.y + Math.sin(a) * (s.r - th) * 0.8 });
    }
    g.fillStyle(s.color, 0.6 * fade);
    g.fillPoints([...outer, ...inner.reverse()], true);
    g.lineStyle(1, 0xffffff, 0.95 * fade);
    g.strokePoints(outer, false);
  }

  // ---- composite effects ----

  explosion(x: number, y: number, r: number, color = 0xff7020): void {
    this.ring(x, y, r, color, 0.4, true);
    this.burst(x, y, 26, 0xffb040, r * 3, 0.45);
    this.burst(x, y, 12, 0x5a3a30, r * 1.5, 0.8, -20);
    this.scene.cameras.main.shake(120, 0.004);
  }

  /** Ground slam: a dust shockwave out to the hit radius, debris and a jolt. */
  shockwave(x: number, y: number, r: number): void {
    this.ring(x, y, r, 0xd8c090, 0.4, true);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + Math.random() * 0.2;
      const s = r * (2.2 + Math.random() * 1.2);
      this.particle(x + Math.cos(a) * 4, y + Math.sin(a) * 4, Math.cos(a) * s, Math.sin(a) * s * 0.8, 0.35 + Math.random() * 0.2, i % 3 ? 0x8a7a68 : 0x5a4a3a, { scale: 1.5 });
    }
    this.burst(x, y - 2, 10, 0x6a5a48, 40, 0.5, 160);
    this.scene.cameras.main.shake(140, 0.005);
  }

  /** A healing ring; `color` tints the ring (the purify ring is white-gold). */
  healRing(x: number, y: number, r: number, color = 0xffe070): void {
    this.ring(x, y, r, color, 0.6, true);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      this.particle(x + Math.cos(a) * d, y + Math.sin(a) * d, 0, -20 - Math.random() * 20, 0.8, 0xfff0a0, { frame: 'spark' });
    }
  }

  /** Chain Spark's arc: a short-lived jagged line between two points. */
  zap(x: number, y: number, x2: number, y2: number, color = 0xb090ff, life = 0.18): void {
    const g = this.freeRings.pop() ?? this.scene.add.graphics();
    g.setVisible(true).setAlpha(1).setDepth(DEPTH.fx);
    const len = Math.hypot(x2 - x, y2 - y);
    const n = Math.max(2, Math.round(len / 6));
    const nx = len > 0 ? -(y2 - y) / len : 0;
    const ny = len > 0 ? (x2 - x) / len : 0;
    const pts: [number, number][] = [[x, y]];
    for (let i = 1; i < n; i++) {
      const off = (Math.random() * 2 - 1) * 3;
      pts.push([x + ((x2 - x) * i) / n + nx * off, y + ((y2 - y) * i) / n + ny * off]);
    }
    pts.push([x2, y2]);
    g.clear();
    for (const [w, c] of [[3, color], [1, 0xffffff]] as const) {
      g.lineStyle(w, c, 1);
      g.beginPath().moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts.slice(1)) g.lineTo(px, py);
      g.strokePath();
    }
    this.zaps.push({ g, life, max: life });
  }

  /** A minion appears. k: 0 green (raised skeleton), 1 fiery (summoned imp), 2 dark purple (raised by the lich). */
  raise(x: number, y: number, k = 0): void {
    if (k === 2) {
      this.ring(x, y, 11, GLOOM.mid, 0.6, true);
      for (let i = 0; i < 16; i++) {
        const dark = i % 3 !== 0;
        this.particle(x + (Math.random() * 14 - 7), y, 0, -12 - Math.random() * 22, 0.8, dark ? GLOOM.dark : GLOOM.spark, { frame: dark ? 'dot' : 'spark', scale: dark ? 1.6 : 1 });
      }
      return;
    }
    const fire = k === 1;
    const c = fire ? 0xff7020 : 0x3ad04a;
    this.ring(x, y, 10, c, 0.5, true);
    for (let i = 0; i < 14; i++) this.particle(x + (Math.random() * 12 - 6), y, 0, -15 - Math.random() * 25, 0.7, fire && i % 2 ? 0xffd040 : c);
  }

  /** Gloom trail: dark smoke with a few pale sparks (the lich's bolts). */
  gloomWisp(x: number, y: number, depth = DEPTH.projectile - 1): void {
    const a = Math.random() * Math.PI * 2;
    this.particle(x, y, Math.cos(a) * 6, Math.sin(a) * 6 - 4, 0.35, Math.random() < 0.5 ? GLOOM.dark : GLOOM.mid, { scale: 1.6, depth });
    if (Math.random() < 0.35) this.particle(x, y, Math.cos(a) * 18, Math.sin(a) * 18, 0.25, GLOOM.spark, { frame: 'spark', depth });
  }

  /** The lich's nova: a dark purple burst out to the hit radius, gloomy smoke and pale sparks, a strong jolt. */
  nova(x: number, y: number, r: number, tint?: number): void {
    const gloom = tint === undefined ? GLOOM : { dark: tint, mid: tint, light: tint, spark: 0xffffff };
    this.ring(x, y, r, gloom.dark, 0.55, true);
    this.ring(x, y, r, gloom.light, 0.35);
    this.particle(x, y - 6, 0, 0, 0.35, gloom.light, { frame: 'glow', scale: 3 });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + Math.random() * 0.15;
      const sp = r * (2 + Math.random() * 1.4);
      const dark = i % 3 !== 0;
      this.particle(x + Math.cos(a) * 4, y + Math.sin(a) * 4, Math.cos(a) * sp, Math.sin(a) * sp * 0.8, 0.4 + Math.random() * 0.25, dark ? gloom.dark : gloom.mid, { scale: dark ? 2 : 1.5 });
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = r * (1.5 + Math.random() * 2);
      this.particle(x, y - 4, Math.cos(a) * sp, Math.sin(a) * sp * 0.8, 0.45, gloom.spark, { frame: 'spark' });
    }
    this.scene.cameras.main.shake(200, 0.007);
  }

  immune(x: number, y: number): void {
    this.ring(x, y - 8, 14, 0x9ae0ff, 0.3);
    this.text(x, y - 18, 'IMMUNE', '#9ae0ff', { kind: 'small' });
  }

  /** Pack coins popping out of a chest or a fallen enemy. */
  coins(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const s = 50 + Math.random() * 40;
      this.particle(x, y - 6, Math.cos(a) * s, Math.sin(a) * s, 0.7 + Math.random() * 0.3, 0xffffff, {
        frame: `coin_anim_f${i % 4}`,
        grav: 220,
        fade: true,
        depth: DEPTH.fx,
      });
    }
  }

  /** A smashed chest: wood chips thrown up and falling back, and a puff of dust. */
  splinters(x: number, y: number): void {
    const woods = [0x6a3e1e, 0x8a5a2a, 0xb07a3a, 0x4a2a14];
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = 50 + Math.random() * 60;
      this.particle(x, y - 5, Math.cos(a) * s, Math.sin(a) * s, 0.45 + Math.random() * 0.3, woods[i % woods.length], { grav: 260, shrink: true });
    }
    this.burst(x, y - 2, 8, 0x9a8a78, 25, 0.5);
  }

  hitSpark(x: number, y: number, color = 0xffffff): void {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particle(x, y, Math.cos(a) * 60, Math.sin(a) * 60, 0.15, color, { frame: 'spark' });
    }
  }
}

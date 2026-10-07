// Pooled visual effects: particles, damage numbers, rings, decals.
// Everything is pooled so combat does not allocate per frame.
import Phaser from 'phaser';

export const DEPTH = {
  map: 0,
  decal: 1,
  hazard: 2,
  entityBase: 10,
  projectile: 5000,
  beam: 5500,
  fx: 6000,
  fog: 7000,
  numbers: 8000,
};

interface Particle {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  max: number;
  grav: number;
  fade: boolean;
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

interface FloatText {
  t: Phaser.GameObjects.Text;
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
    this.particles.push({ img, vx, vy, life, max: life, grav: opts.grav ?? 0, fade: opts.fade ?? true, shrink: opts.shrink ?? false });
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

  text(x: number, y: number, s: string, color: string, big = false): void {
    const t = this.freeTexts.pop() ?? this.scene.add.text(0, 0, '', { fontFamily: '"Press Start 2P", monospace', fontSize: '8px', resolution: 4 });
    t.setText(s).setColor(color).setFontSize(big ? 10 : 6).setStroke('#140c1a', big ? 3 : 2).setOrigin(0.5, 1);
    t.setPosition(Math.round(x + (Math.random() * 6 - 3)), Math.round(y)).setAlpha(1).setVisible(true).setDepth(DEPTH.numbers).setScale(1);
    this.texts.push({ t, vy: big ? -34 : -26, life: big ? 0.9 : 0.7, max: big ? 0.9 : 0.7 });
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
      if (p.fade) p.img.setAlpha(k);
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

  healRing(x: number, y: number, r: number): void {
    this.ring(x, y, r, 0xffe070, 0.6, true);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      this.particle(x + Math.cos(a) * d, y + Math.sin(a) * d, 0, -20 - Math.random() * 20, 0.8, 0xfff0a0, { frame: 'spark' });
    }
  }

  raise(x: number, y: number): void {
    this.ring(x, y, 10, 0x3ad04a, 0.5, true);
    for (let i = 0; i < 14; i++) this.particle(x + (Math.random() * 12 - 6), y, 0, -15 - Math.random() * 25, 0.7, 0x3ad04a);
  }

  immune(x: number, y: number): void {
    this.ring(x, y - 8, 14, 0x9ae0ff, 0.3);
    this.text(x, y - 18, 'IMMUNE', '#9ae0ff');
  }

  hitSpark(x: number, y: number, color = 0xffffff): void {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particle(x, y, Math.cos(a) * 60, Math.sin(a) * 60, 0.15, color, { frame: 'spark' });
    }
  }
}

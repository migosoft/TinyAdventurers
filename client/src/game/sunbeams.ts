// Sunlight through ceiling cracks (#156): per Daylight light a soft beam from above, a glow patch on the
// floor and a few dust motes drifting in the beam. Everything is runtime geometry (a vertex-alpha
// Graphics for the beam, one generated glow texture, the 'dot' sprite) and sits under the darkness,
// so it shows only on tiles the viewer sees lit, and lights nothing itself. Objects are pooled.
import type Phaser from 'phaser';
import { LIGHT, LIGHT_KIND } from '../generated/defs';
import { TILE } from '../sim/map';
import { DEPTH } from './effects';
import type { LightField } from './light';
import type { LightView } from './lightview';
import { beamShape, cloudAt, sunLook } from './sunmath';

const PATCH_TEX = 'sun-patch';
/** Phaser's `FilterMode.LINEAR` and blend mode ADD (a runtime import of Phaser would not load in unit tests). */
const LINEAR = 0;
const ADD = 1;
/** Tiles beyond the view in which a beam is still kept. */
const MARGIN = 4;
const MOTES = 24;
/** Beam alpha at the top, at BEAM_PEAK_AT of the way down, and at the floor. */
const BEAM_PEAK = 0.22;
const BEAM_PEAK_AT = 2 / 3;
const BEAM_FLOOR = 0.2;
const PATCH_ALPHA = 0.6;
const MOTE_ALPHA = 0.8;
/** Mote drift speed range along the beam (px/s). */
const DRIFT: [number, number] = [1, 3];

type Pt = [number, number];
type Shape = ReturnType<typeof beamShape>;

interface Mote {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

interface Beam {
  beam: Phaser.GameObjects.Graphics;
  patch: Phaser.GameObjects.Image;
  motes: Mote[];
  /** What the beam geometry was drawn for; redrawn when it changes. */
  key: string;
  shape: Shape;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A soft white ellipse glow, to be scaled to the patch and tinted. */
function ensureTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(PATCH_TEX)) return;
  const c = scene.textures.createCanvas(PATCH_TEX, 64, 64)!;
  const ctx = c.getContext();
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  c.refresh();
  c.setFilter(LINEAR);
}

/** The sunbeams of the Daylight lights; `update` it every frame after the `LightView`. */
export class Sunbeams {
  /** Each piece can be switched off (the demo's buttons). */
  readonly on = { beam: true, dust: true };
  private active = new Map<number, Beam>();
  private free: Beam[] = [];
  private all: Beam[] = [];

  constructor(private scene: Phaser.Scene, private field: LightField, private light: LightView) {
    ensureTexture(scene);
  }

  update(dt: number, view: Phaser.Geom.Rectangle, t: number): void {
    const m = MARGIN * TILE;
    const seen = new Set<number>();
    for (const l of this.field.lights.values()) {
      if (l.kind !== LIGHT_KIND.Daylight || !l.on) continue;
      const x = (l.x + 0.5) * TILE;
      const y = (l.y + 0.5) * TILE;
      if (x < view.x - m || x > view.right + m || y < view.y - m || y > view.bottom + m) continue;
      if (this.light.seenLit[l.y * this.light.w + l.x] !== 1) continue;
      seen.add(l.id);
      let b = this.active.get(l.id);
      if (!b) {
        b = this.free.pop() ?? this.make();
        this.active.set(l.id, b);
        b.key = '';
      }
      this.place(b, l.x, l.y, l.colour ?? LIGHT[LIGHT_KIND.Daylight].colour, cloudAt(l.id, t, sunLook), dt, t);
    }
    for (const [id, b] of this.active) {
      if (seen.has(id)) continue;
      this.active.delete(id);
      this.hide(b);
      this.free.push(b);
    }
  }

  destroy(): void {
    for (const b of this.all) {
      b.beam.destroy();
      b.patch.destroy();
      for (const m of b.motes) m.img.destroy();
    }
    this.all = [];
    this.active.clear();
    this.free = [];
  }

  private make(): Beam {
    const s = this.scene;
    const beam = s.add.graphics().setDepth(DEPTH.sunBeam).setBlendMode(ADD);
    const patch = s.add.image(0, 0, PATCH_TEX).setDepth(DEPTH.sunPatch).setBlendMode(ADD);
    const motes: Mote[] = [];
    for (let i = 0; i < MOTES; i++) {
      const img = s.add.image(0, 0, 'dot').setScale(0.5).setBlendMode(ADD).setDepth(DEPTH.airDust);
      motes.push({ img, x: 0, y: 0, vx: 0, vy: 0, phase: rnd(0, Math.PI * 2) });
    }
    const b: Beam = { beam, patch, motes, key: '', shape: beamShape(0, 0, sunLook) };
    this.all.push(b);
    return b;
  }

  private hide(b: Beam): void {
    b.beam.setVisible(false);
    b.patch.setVisible(false);
    for (const m of b.motes) m.img.setVisible(false);
  }

  private place(b: Beam, tx: number, ty: number, colour: number, cloud: number, dt: number, t: number): void {
    const look = sunLook;
    const key = `${tx},${ty},${colour},${look.widen},${look.patch},${look.slant},${look.dir},${look.glow}`;
    if (key !== b.key) {
      b.key = key;
      b.shape = beamShape(tx, ty, look);
      this.draw(b, colour, look.glow);
      for (const m of b.motes) this.respawn(m, b.shape);
    }
    const p = b.shape.patch;
    b.beam.setVisible(this.on.beam).setAlpha(cloud);
    b.patch.setVisible(this.on.beam).setPosition(p.x, p.y).setDisplaySize(p.w, p.h).setTint(colour).setAlpha(Math.min(1, PATCH_ALPHA * look.glow) * cloud);
    for (const m of b.motes) {
      if (!this.on.dust) {
        m.img.setVisible(false);
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (!this.inside(b.shape, m.x, m.y)) this.respawn(m, b.shape);
      const lit = this.light.seenLit[Math.floor(m.y / TILE) * this.light.w + Math.floor(m.x / TILE)] === 1;
      const twinkle = 0.6 + 0.4 * Math.sin(t * 2 + m.phase);
      m.img.setVisible(lit).setPosition(m.x, m.y).setTint(colour).setAlpha(MOTE_ALPHA * twinkle * cloud);
    }
  }

  /** The beam as two gradient trapezoids (top to the peak, peak to the floor); vertex alpha makes the fade. */
  private draw(b: Beam, colour: number, glow: number): void {
    const { top, bottom } = b.shape;
    const at = (k: number): [Pt, Pt] => [
      [lerp(top[0][0], bottom[0][0], k), lerp(top[0][1], bottom[0][1], k)],
      [lerp(top[1][0], bottom[1][0], k), lerp(top[1][1], bottom[1][1], k)],
    ];
    const g = b.beam.clear();
    const band = (a: [Pt, Pt], c: [Pt, Pt], a0: number, a1: number) => {
      a0 = Math.min(1, a0 * glow);
      a1 = Math.min(1, a1 * glow);
      // A triangle takes its three vertex alphas from the TL, TR and BL slots, in order.
      g.fillGradientStyle(colour, colour, colour, colour, a0, a0, a1, a1);
      g.fillTriangle(a[0][0], a[0][1], a[1][0], a[1][1], c[0][0], c[0][1]);
      g.fillGradientStyle(colour, colour, colour, colour, a0, a1, a1, a1);
      g.fillTriangle(a[1][0], a[1][1], c[1][0], c[1][1], c[0][0], c[0][1]);
    };
    const mid = at(BEAM_PEAK_AT);
    band(top as [Pt, Pt], mid, 0, BEAM_PEAK);
    band(mid, bottom as [Pt, Pt], BEAM_PEAK, BEAM_FLOOR);
  }

  /** Is (x, y) inside the beam trapezoid? */
  private inside(s: Shape, x: number, y: number): boolean {
    const y0 = s.top[0][1];
    const y1 = s.bottom[0][1];
    if (y < y0 || y > y1) return false;
    const k = (y - y0) / (y1 - y0);
    return x >= lerp(s.top[0][0], s.bottom[0][0], k) && x <= lerp(s.top[1][0], s.bottom[1][0], k);
  }

  /** A random point inside the beam, drifting slowly down along it. */
  private respawn(m: Mote, s: Shape): void {
    const k = Math.random();
    const l = lerp(s.top[0][0], s.bottom[0][0], k);
    const r = lerp(s.top[1][0], s.bottom[1][0], k);
    m.x = rnd(l, r);
    m.y = lerp(s.top[0][1], s.bottom[0][1], k);
    const dx = (s.bottom[0][0] + s.bottom[1][0] - s.top[0][0] - s.top[1][0]) / 2;
    const dy = s.bottom[0][1] - s.top[0][1];
    const len = Math.hypot(dx, dy);
    const v = rnd(DRIFT[0], DRIFT[1]);
    m.vx = (dx / len) * v;
    m.vy = (dy / len) * v;
  }
}

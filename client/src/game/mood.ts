// The dungeon air (#148): dust motes that show only in the light, smoke rising from
// torches and lava, embers over lava and behind fire, a thin drifting haze, and water drips.
// Everything sits under the light tint and the darkness (so it never shows what the viewer
// cannot see), except torch smoke, which is drawn just over the darkness but only from
// torches whose floor tile is seen and lit. Counts follow the camera's view, with hard caps.
import type Phaser from 'phaser';
import { LIGHT_KIND } from '../generated/defs';
import { TILE, type TileMap } from '../sim/map';
import { DEPTH } from './effects';
import type { LightView } from './lightview';
import { BurstOnce, DUST_ALPHA, LAVA_EMBER_EVERY, LAVA_SMOKE_EVERY, MAX_CLOUDS, MAX_EMBERS, MAX_SMOKE, cloudCount, dustTint, spawnCount } from './moodmath';
import { TERRAIN } from './terrain';
import { Drips } from './mood-drips';
import { ensureTextures, HAZE_TEX, SMOKE_TEX } from './mood-textures';
import { flameTip } from './torch';
import { Wind } from './wind';

/** Motes per dust cloud. */
const CLOUD_MOTES = 7;
/** Tiles beyond the view in which lava, water and torches still count. */
const MARGIN = 1;
/** Phaser's blend modes NORMAL and ADD (a runtime import of Phaser would not load in unit tests). */
const NORMAL = 0;
const ADD = 1;
/** The two haze layers: alpha, tile scale, and drift (px/s) of the cloud pattern. */
const HAZE = [[0.1, 1.6, 2.2, 0.6], [0.07, 1.1, -1.4, 1.1]] as const;
/** Pixels the haze sprites reach beyond the view, and the step their size grows in. */
const HAZE_MARGIN = 32;
const HAZE_STEP = 64;
const EMBER_COLOURS = [0xffb040, 0xff6a20];
/** Air faster than this (px/s) stirs a dust cloud apart; the ambient draft (at most DRAFT_MAX) never does. */
const STIR_SPEED = 8;
/** Seconds a stirred cloud waits, hidden, before it respawns. */
const STIR_DELAY = 0;
/** How fast (1/s) a drifting cloud and a loose mote follow the air, and the drag on a loose mote (1/s). */
const CLOUD_FOLLOW = 2;
const MOTE_FOLLOW = 6;
const MOTE_DRAG = 0.6;
/** Shares of the sampled air that smoke and embers take on. */
const SMOKE_WIND = 0.6;
const EMBER_WIND = 0.4;

/** A moving figure (r = body radius) or projectile (shot = true); v in px/s. */
export interface AirMover {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  shot: boolean;
  /** 0..1: how much a shot warms the air it passes (0 for figures). */
  heat: number;
}

/** A torch in the window; its smoke needs `lit` and a seen, lit floor tile. */
export interface AirTorch {
  x: number;
  y: number;
  side: number;
  lit: boolean;
}

/** A moving light: `kind` is a `LIGHT_KIND` (fire trails embers, a blast throws a burst). */
export interface AirShot {
  x: number;
  y: number;
  kind: number;
}

interface Mote {
  img: Phaser.GameObjects.Image;
  /** Offset from the cloud's centre, and its own slow wander. */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  phase: number;
  /** Once the cloud is stirred: world position, seconds of fade left and in all, and the alpha it had (and has). */
  wx: number;
  wy: number;
  left: number;
  total: number;
  a0: number;
  a: number;
}

/** A loose cloud of motes drifting together. */
interface Cloud {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  /** Spread radius (px). */
  r: number;
  motes: Mote[];
  /** Stirred apart: its motes follow the air on their own, then fade; `wait` s of hiding remain after the last is gone. */
  stirred: boolean;
  wait: number;
}

/** A smoke puff or ember. */
interface Puff {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a: number;
  sway: number;
  /** Torch smoke: the tile whose sight it needs (-1: none), and how visible it is now (0..1, eases). */
  src: number;
  vis: number;
}

type PuffSpec = Pick<Puff, 'vx' | 'vy' | 'max' | 's0' | 's1' | 'a' | 'sway'>;

/** Per torch: in a gust or a quiet gap, time left in it, time to the next puff, and the gust's soot share. */
interface Gust {
  burst: boolean;
  left: number;
  next: number;
  soot: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** The dungeon air layer; `update` it every frame after the `LightView`. */
export class Mood {
  /** Each piece can be switched off (the `?mood` demo's buttons); all are on in the game. */
  readonly on = { dust: true, smoke: true, embers: true, haze: true, drips: true, stir: true, draft: true };
  /** Seconds a stirred cloud waits before it respawns (0 = at once). */
  stirDelay = STIR_DELAY;
  private wind: Wind;
  private air: [number, number] = [0, 0];
  private stirredNow = 0;
  private clouds: Cloud[] = [];
  private activeClouds = 0;
  private puffs: Puff[] = [];
  private embers: Puff[] = [];
  private freePuffs: Phaser.GameObjects.Image[] = [];
  private freeEmbers: Phaser.GameObjects.Image[] = [];
  private haze: Phaser.GameObjects.TileSprite[] = [];
  private drips: Drips;
  /** Torch gusts by torch position (the game's torch order is not stable). */
  private gusts = new Map<string, Gust>();
  private blasts = new BurstOnce();
  private lava: [number, number][] = [];
  private water: [number, number][] = [];
  /** The lava and water tiles in view this frame (reused). */
  private lavaNow: [number, number][] = [];
  private waterNow: [number, number][] = [];
  private smokeAcc = 0;
  private emberAcc = 0;
  private fireClock = 0;
  private t = 0;
  private windOn = false;
  private gone = false;
  /** Everything made, for `destroy`. */
  private owned: { destroy(): void }[] = [];

  constructor(private scene: Phaser.Scene, private map: TileMap, private light: LightView) {
    ensureTextures(scene);
    this.wind = new Wind((px, py) => this.map.opaqueAt(px, py));
    this.drips = new Drips(scene, (o) => this.own(o));
    this.mapChanged();
    for (let c = 0; c < MAX_CLOUDS; c++) {
      const motes: Mote[] = [];
      for (let i = 0; i < CLOUD_MOTES; i++)
        motes.push({ img: this.own(scene.add.image(0, 0, 'dot').setScale(0.5).setDepth(DEPTH.airDust).setVisible(false)), ox: 0, oy: 0, vx: 0, vy: 0, phase: Math.random() * 10, wx: 0, wy: 0, left: 0, total: 1, a0: 0, a: 0 });
      // Staggered first lives, so the clouds do not all appear and vanish together.
      this.clouds.push({ x: -1000, y: -1000, vx: 0, vy: 0, life: Math.random() * 2, max: 1, r: 10, motes, stirred: false, wait: 0 });
    }
    // Haze sprites cover the view plus a margin only (a TileSprite allocates its full size); `update` resizes them.
    for (const [alpha, scale] of HAZE)
      this.haze.push(this.own(scene.add.tileSprite(0, 0, 64, 64, HAZE_TEX).setOrigin(0).setTileScale(scale).setTint(0x8a7c6c).setAlpha(alpha).setDepth(DEPTH.airHaze)));
  }

  /** Read-only counts, for tests. */
  get counts(): { clouds: number; smoke: number; embers: number; drips: number; stirred: number } {
    return { clouds: this.activeClouds, smoke: this.puffs.length, embers: this.embers.length, drips: this.drips.count, stirred: this.stirredNow };
  }

  /** The air velocity at (x, y), for tests and the demo's wind overlay. */
  airAt(x: number, y: number): [number, number] {
    return this.wind.sample(x, y, [0, 0]);
  }

  /** Terrain changed: collect the lava and water tiles again. Puffs already in the air die out by themselves. */
  mapChanged(): void {
    this.wind.wallsChanged();
    this.lava = [];
    this.water = [];
    for (let y = 0; y < this.map.h; y++)
      for (let x = 0; x < this.map.w; x++) {
        const t = this.map.get(x, y);
        if (t === TERRAIN.Lava) this.lava.push([x, y]);
        else if (t === TERRAIN.Shallow || t === TERRAIN.Deep) this.water.push([x, y]);
      }
  }

  /** Free every game object. Safe to call twice. */
  destroy(): void {
    if (this.gone) return;
    this.gone = true;
    for (const o of this.owned) o.destroy();
    this.owned = [];
    this.clouds = [];
    this.puffs = [];
    this.embers = [];
    this.freePuffs = [];
    this.freeEmbers = [];
    this.haze = [];
  }

  /** Advances the air by `dt` s: `view` is the camera window (world px), `torches` and `shots` what the snapshot shows. */
  update(dt: number, view: Phaser.Geom.Rectangle, torches: AirTorch[], shots: AirShot[], movers: AirMover[] = []): void {
    if (this.gone) return;
    this.t += dt;
    this.collectInView(view);
    this.updateFire(dt, view, shots);
    this.stepWind(dt, view, movers);
    this.drips.update(dt, this.waterNow, this.on.drips);
    this.updateDust(dt, view);
    this.updateTorchSmoke(dt, view, torches);
    this.updateLava(dt);
    this.advance(dt);
    this.updateHaze(view);
  }

  /** Movers on seen tiles in view push the air, then the wind moves on one step. Off entirely when neither stir nor draft is on. */
  private stepWind(dt: number, view: Phaser.Geom.Rectangle, movers: AirMover[]): void {
    this.windOn = this.on.stir || this.on.draft;
    if (!this.windOn) return;
    this.wind.draftOn = this.on.draft;
    if (this.on.stir) {
      const x0 = view.x - MARGIN * TILE;
      const x1 = view.right + MARGIN * TILE;
      const y0 = view.y - MARGIN * TILE;
      const y1 = view.bottom + MARGIN * TILE;
      for (const m of movers) {
        if (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1 || !this.seenAt(m.x, m.y)) continue;
        if (m.shot) this.wind.wake(m.x, m.y, m.vx, m.vy, m.r, m.heat);
        else this.wind.push(m.x, m.y, m.vx, m.vy, m.r);
      }
    }
    this.wind.step(dt, view);
  }

  /** Haze: two layers drifting at different speeds; sprites follow the view, the pattern stays anchored to the world. */
  private updateHaze(view: Phaser.Geom.Rectangle): void {
    const w = Math.ceil((view.width + 2 * HAZE_MARGIN) / HAZE_STEP) * HAZE_STEP;
    const h = Math.ceil((view.height + 2 * HAZE_MARGIN) / HAZE_STEP) * HAZE_STEP;
    const px = Math.floor(view.x) - HAZE_MARGIN;
    const py = Math.floor(view.y) - HAZE_MARGIN;
    this.haze.forEach((s, i) => {
      const [, scale, dx, dy] = HAZE[i];
      if (w > s.width || h > s.height) s.setSize(Math.max(w, s.width), Math.max(h, s.height));
      s.setVisible(this.on.haze).setPosition(px, py).setTilePosition(px / scale + this.t * dx, py / scale + this.t * dy);
    });
  }

  private own<T extends { destroy(): void }>(o: T): T {
    this.owned.push(o);
    return o;
  }

  private collectInView(view: Phaser.Geom.Rectangle): void {
    const x0 = view.x / TILE - MARGIN;
    const x1 = view.right / TILE + MARGIN;
    const y0 = view.y / TILE - MARGIN;
    const y1 = view.bottom / TILE + MARGIN;
    const pick = (from: [number, number][], into: [number, number][]) => {
      into.length = 0;
      for (const t of from) if (t[0] + 1 > x0 && t[0] < x1 && t[1] + 1 > y0 && t[1] < y1) into.push(t);
    };
    pick(this.lava, this.lavaNow);
    // Lava in unseen tiles must not spill smoke or embers into the seen view.
    const w = this.map.w;
    this.lavaNow = this.lavaNow.filter((t) => this.light.seenLit[t[1] * w + t[0]] === 1);
    pick(this.water, this.waterNow);
  }

  /** True when the tile under (x, y) is seen (a moving light lights its own tile). */
  private seenAt(x: number, y: number): boolean {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    return tx >= 0 && ty >= 0 && tx < this.map.w && ty < this.map.h && this.light.seenLit[ty * this.map.w + tx] === 1;
  }

  /** Brightness (0..1) and colour of the light on the tile under (x, y); 0 where unseen or unlit. */
  private lightAt(x: number, y: number): [number, number] {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return [0, 0xffffff];
    const i = ty * this.map.w + tx;
    if (!this.light.seenLit[i] || this.map.opaque(tx, ty)) return [0, 0xffffff];
    const rgb = this.light.light;
    return dustTint(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  }

  // ---- dust ----

  private spawnCloud(c: Cloud, view: Phaser.Geom.Rectangle): void {
    // Denser where it is bright: try a few spots, keep one with a chance by its brightness.
    for (let k = 0; k < 8; k++) {
      const x = view.x + Math.random() * view.width;
      const y = view.y + Math.random() * view.height;
      const [b] = this.lightAt(x, y);
      if (b > 0.05 && Math.random() < b * b && !this.stirredAt(x, y)) {
        c.stirred = false;
        c.x = x;
        c.y = y;
        c.vx = (Math.random() - 0.5) * 4;
        c.vy = (Math.random() - 0.5) * 3;
        c.max = c.life = rnd(6, 12);
        c.r = rnd(6, 16);
        for (const m of c.motes) {
          const a = Math.random() * Math.PI * 2;
          const d = c.r * Math.sqrt(Math.random());
          m.ox = Math.cos(a) * d;
          m.oy = Math.sin(a) * d;
          m.vx = (Math.random() - 0.5) * 1.5;
          m.vy = (Math.random() - 0.5) * 1.5;
          m.a = 0;
        }
        return;
      }
    }
    c.stirred = false;
    c.life = c.max = 0.3; // nothing lit found: try again soon
    c.x = -1000;
  }

  /** Each cloud drifts as a whole, its motes wander slowly inside it. Only as many clouds as the view's area asks for. */
  private updateDust(dt: number, view: Phaser.Geom.Rectangle): void {
    this.activeClouds = cloudCount(view.width, view.height);
    this.stirredNow = 0;
    this.clouds.forEach((c, n) => {
      if (n >= this.activeClouds) {
        for (const m of c.motes) m.img.setVisible(false);
        c.stirred = false;
        c.wait = 0;
        c.life = Math.random() * 2; // starts staggered when it is needed again
        return;
      }
      if (c.stirred) {
        this.stirredNow++;
        this.updateStirred(dt, c, view);
        return;
      }
      c.life -= dt;
      if (c.life <= 0) this.spawnCloud(c, view);
      if (this.windOn) {
        // The cloud rides the air at its centre, with a slight float upwards.
        const w = this.wind.sample(c.x, c.y, this.air);
        const k = Math.min(1, CLOUD_FOLLOW * dt);
        c.vx += (w[0] - c.vx) * k;
        c.vy += (w[1] - c.vy) * k - 0.3 * dt;
      } else {
        c.vx = clamp(c.vx + (Math.random() - 0.5) * 4 * dt, -2.5, 2.5);
        c.vy = clamp(c.vy + (Math.random() - 0.5) * 4 * dt - 0.3 * dt, -2.5, 2);
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (this.on.stir && this.stirs(c)) {
        this.stir(c);
        this.stirredNow++;
        this.updateStirred(dt, c, view);
        return;
      }
      const fade = Math.min(1, (c.max - c.life) / 1.5, c.life / 1.5);
      for (const m of c.motes) {
        m.vx = clamp(m.vx + (Math.random() - 0.5) * 3 * dt, -1.5, 1.5);
        m.vy = clamp(m.vy + (Math.random() - 0.5) * 3 * dt, -1.5, 1.5);
        m.ox += m.vx * dt;
        m.oy += m.vy * dt;
        // Pulled back gently when it strays past the cloud's edge.
        if (Math.hypot(m.ox, m.oy) > c.r) {
          m.ox *= 1 - 0.5 * dt;
          m.oy *= 1 - 0.5 * dt;
        }
        const x = c.x + m.ox;
        const y = c.y + m.oy;
        const [b, tint] = this.lightAt(x, y);
        const twinkle = 0.6 + 0.4 * Math.sin(this.t * 2.3 + m.phase);
        m.a = DUST_ALPHA * fade * twinkle;
        const a = this.on.dust ? m.a * Math.min(1, b * 1.3) : 0;
        m.img.setVisible(a > 0.01).setPosition(x, y).setBlendMode(ADD).setTint(tint).setAlpha(a);
      }
    });
  }

  /** True when the air at (x, y) is faster than STIR_SPEED. */
  private stirredAt(x: number, y: number): boolean {
    const w = this.wind.sample(x, y, this.air);
    return w[0] * w[0] + w[1] * w[1] > STIR_SPEED * STIR_SPEED;
  }

  /** True when any mote of the cloud sits in air faster than STIR_SPEED. */
  private stirs(c: Cloud): boolean {
    for (const m of c.motes) {
      const w = this.wind.sample(c.x + m.ox, c.y + m.oy, this.air);
      if (w[0] * w[0] + w[1] * w[1] > STIR_SPEED * STIR_SPEED) return true;
    }
    return false;
  }

  /** The cloud falls apart: each mote keeps its place and the cloud's velocity, and will fade out in 1 to 2 s. */
  private stir(c: Cloud): void {
    c.stirred = true;
    c.wait = 0;
    for (const m of c.motes) {
      m.wx = c.x + m.ox;
      m.wy = c.y + m.oy;
      m.vx = c.vx;
      m.vy = c.vy;
      m.a0 = m.a;
      m.left = m.total = rnd(1, 2);
    }
  }

  /** Loose motes follow the air, slow down and fade; once all are gone the cloud waits, then respawns. */
  private updateStirred(dt: number, c: Cloud, view: Phaser.Geom.Rectangle): void {
    let alive = false;
    for (const m of c.motes) {
      if (m.left <= 0) continue;
      m.left -= dt;
      if (m.left <= 0) {
        m.img.setVisible(false);
        continue;
      }
      alive = true;
      const w = this.wind.sample(m.wx, m.wy, this.air);
      const k = Math.min(1, MOTE_FOLLOW * dt);
      const drag = Math.max(0, 1 - MOTE_DRAG * dt);
      m.vx = (m.vx + (w[0] - m.vx) * k) * drag;
      m.vy = (m.vy + (w[1] - m.vy) * k) * drag;
      m.wx += m.vx * dt;
      m.wy += m.vy * dt;
      const [b, tint] = this.lightAt(m.wx, m.wy);
      const a = this.on.dust ? m.a0 * Math.min(1, b * 1.3) * (m.left / m.total) : 0;
      m.img.setVisible(a > 0.01).setPosition(m.wx, m.wy).setBlendMode(ADD).setTint(tint).setAlpha(a);
    }
    if (alive) return;
    if (c.wait > 0) c.wait -= dt;
    else c.wait = this.stirDelay;
    if (c.wait > 0) return;
    c.wait = 0;
    this.spawnCloud(c, view);
  }

  // ---- smoke and embers ----

  private puff(list: Puff[], free: Phaser.GameObjects.Image[], tex: string, x: number, y: number, p: PuffSpec, tint: number, blend: number, depth: number, src = -1): void {
    const img = free.pop() ?? this.own(this.scene.add.image(0, 0, tex));
    img.setTexture(tex).setTint(tint).setBlendMode(blend).setDepth(depth).setVisible(true).setAlpha(0);
    list.push({ img, x, y, life: p.max, ...p, src, vis: 1 });
  }

  private smoke(x: number, y: number, p: PuffSpec, tint: number, depth: number, src = -1): void {
    this.puff(this.puffs, this.freePuffs, SMOKE_TEX, x, y, p, tint, NORMAL, depth, src);
  }

  private ember(x: number, y: number, vx: number, vy: number, life: number): void {
    if (!this.on.embers || this.embers.length >= MAX_EMBERS) return;
    this.puff(this.embers, this.freeEmbers, 'dot', x, y, { vx, vy, max: life, s0: 0.5, s1: 0.3, a: 1, sway: 6 },
      EMBER_COLOURS[Math.random() < 0.5 ? 0 : 1], ADD, DEPTH.airEmbers);
  }

  /** Fire shots trail embers; a blast throws a burst once, when it first shows. */
  private updateFire(dt: number, view: Phaser.Geom.Rectangle, shots: AirShot[]): void {
    this.fireClock += dt;
    const trail = this.fireClock > 0.04;
    if (trail) this.fireClock = 0;
    const blasts: AirShot[] = [];
    const x0 = view.x - MARGIN * TILE;
    const x1 = view.right + MARGIN * TILE;
    const y0 = view.y - MARGIN * TILE;
    const y1 = view.bottom + MARGIN * TILE;
    for (const m of shots) {
      if (m.x < x0 || m.x > x1 || m.y < y0 || m.y > y1) continue;
      // The server sends lights without line of sight: only shots on a seen tile make air.
      if (!this.seenAt(m.x, m.y)) continue;
      if (m.kind === LIGHT_KIND.Fire && trail) this.ember(m.x + (Math.random() - 0.5) * 6, m.y + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 16, -rnd(6, 20), rnd(0.35, 0.8));
      if (m.kind === LIGHT_KIND.Blast) blasts.push(m);
    }
    const fresh = new Set(this.blasts.fresh(blasts.map((m) => `${Math.round(m.x / 8)},${Math.round(m.y / 8)}`)));
    for (const m of blasts) {
      if (!fresh.has(`${Math.round(m.x / 8)},${Math.round(m.y / 8)}`)) continue;
      fresh.delete(`${Math.round(m.x / 8)},${Math.round(m.y / 8)}`); // two blasts on one key burst once
      if (this.on.stir) this.wind.blast(m.x, m.y);
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = rnd(20, 50);
        this.ember(m.x, m.y, Math.cos(a) * v, Math.sin(a) * v * 0.7 - 10, rnd(0.6, 1.4));
      }
    }
  }

  /** Smoke from lit torches in sight, from the tip of the flame, in uneven gusts with quiet gaps; some gusts gutter into dark soot. */
  private updateTorchSmoke(dt: number, view: Phaser.Geom.Rectangle, torches: AirTorch[]): void {
    const keep = new Set<string>();
    const x0 = view.x - MARGIN * TILE;
    const x1 = view.right + MARGIN * TILE;
    const y0 = view.y - MARGIN * TILE;
    const y1 = view.bottom + MARGIN * TILE;
    for (const tr of torches) {
      if (tr.x < x0 || tr.x > x1 || tr.y < y0 || tr.y > y1) continue;
      const key = `${tr.x},${tr.y}`;
      keep.add(key);
      let g = this.gusts.get(key);
      if (!g) this.gusts.set(key, (g = { burst: false, left: Math.random() * 1.5, next: 0, soot: 0 }));
      g.left -= dt;
      if (g.left <= 0) {
        g.burst = !g.burst;
        g.left = g.burst ? rnd(0.3, 1.1) : rnd(0.5, 1.9);
        g.soot = Math.random() < 0.3 ? 0.65 : 0.12;
      }
      g.next -= dt;
      if (g.next > 0) continue;
      g.next = g.burst ? rnd(0.07, 0.19) : rnd(0.6, 1.4);
      if (!this.on.smoke || !tr.lit || this.puffs.length >= MAX_SMOKE) continue;
      if (!g.burst && Math.random() >= 0.4) continue; // only a stray wisp now and then between gusts
      // The torch's floor tile must be seen: its smoke is drawn over the darkness (it rises into the dark wall top).
      const tx = Math.floor(tr.x / TILE);
      const ty = Math.floor(tr.y / TILE);
      if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) continue;
      const src = ty * this.map.w + tx;
      if (!this.light.seenLit[src]) continue;
      const soot = Math.random() < g.soot;
      const [fx, fy] = flameTip(tr.x, tr.y, tr.side);
      this.smoke(fx + (Math.random() - 0.5) * 2, fy - Math.random() * 1.5, {
        vx: (Math.random() - 0.5) * 3, vy: -rnd(8, 15), max: rnd(2.4, 4),
        s0: 0.3, s1: soot ? rnd(0.8, 1.2) : rnd(0.6, 1), a: soot ? 0.34 : 0.26, sway: rnd(3, 6),
      }, soot ? 0x2e2824 : 0xb09a86, DEPTH.torchSmoke, src);
    }
    for (const k of this.gusts.keys()) if (!keep.has(k)) this.gusts.delete(k);
  }

  /** Heavier, darker smoke and tiny rising sparks off the lava tiles in view. */
  private updateLava(dt: number): void {
    const n = this.lavaNow.length;
    let c: number;
    [c, this.smokeAcc] = spawnCount(this.smokeAcc, dt, n, LAVA_SMOKE_EVERY);
    for (; c > 0 && this.on.smoke && this.puffs.length < MAX_SMOKE; c--) {
      const [lx, ly] = this.lavaNow[Math.floor(Math.random() * n)];
      this.smoke((lx + Math.random()) * TILE, (ly + Math.random()) * TILE, {
        vx: (Math.random() - 0.5) * 3, vy: -rnd(6, 10), max: rnd(3.5, 5),
        s0: 0.4, s1: rnd(1.4, 1.9), a: 0.28, sway: 4,
      }, 0x4a3c38, DEPTH.airSmoke);
    }
    [c, this.emberAcc] = spawnCount(this.emberAcc, dt, n, LAVA_EMBER_EVERY);
    for (; c > 0; c--) {
      const [lx, ly] = this.lavaNow[Math.floor(Math.random() * n)];
      this.ember((lx + Math.random()) * TILE, (ly + Math.random()) * TILE, (Math.random() - 0.5) * 6, -rnd(14, 28), rnd(1, 2.4));
    }
  }

  /** Moves, fades and recycles the puffs and embers. */
  private advance(dt: number): void {
    for (const [list, free] of [[this.puffs, this.freePuffs], [this.embers, this.freeEmbers]] as const) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
          p.img.setVisible(false);
          free.push(p.img);
          list.splice(i, 1);
          continue;
        }
        const k = 1 - p.life / p.max;
        p.x += (p.vx + Math.sin(this.t * 1.7 + p.max * 9) * p.sway * k) * dt;
        p.y += p.vy * dt;
        if (this.windOn) {
          const w = this.wind.sample(p.x, p.y, this.air);
          const share = list === this.puffs ? SMOKE_WIND : EMBER_WIND;
          p.x += w[0] * share * dt;
          p.y += w[1] * share * dt;
        }
        p.vy *= 1 - 0.25 * dt; // smoke slows as it rises and spreads
        // Torch smoke fades out within about 0.25 s once its torch tile leaves the view.
        if (p.src >= 0) p.vis = clamp(p.vis + (this.light.seenLit[p.src] ? 4 : -4) * dt, 0, 1);
        const alpha = p.a * Math.min(1, k / (p.src >= 0 ? 0.05 : 0.15)) * (1 - k) * p.vis;
        p.img.setPosition(p.x, p.y).setScale(p.s0 + (p.s1 - p.s0) * k).setAlpha(alpha);
      }
    }
  }
}

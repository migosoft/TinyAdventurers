// Dev page ?mood (no server): one dungeon room to judge the dungeon air (#148, #158).
// Warm torches, a lava pool, a water pool, a few still figures, a knight who walks a loop
// round the pillar (and dashes every 6 s), an arrow that crosses every 3 s and a fireball that
// crosses every 4 s and explodes at the east wall. The knight, arrow and fireball stir the air.
// Buttons at the bottom (tap or click) switch dust, smoke, embers, haze, drips, Stir, Draft and
// Respawn (instant / 3 s). URL: ?dust=0 etc., ?stir=0, ?draft=0, ?respawn=<seconds>, and
// ?wind=1 draws the wind field as short lines. Zoomed to fit the room to the screen, so it reads on a phone.
import Phaser from 'phaser';
import { CONST, KIND, LIGHT_KIND } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { TILE } from '../sim/map';
import { demoBoard } from './contextrestore';
import { Effects, DEPTH } from './effects';
import { LightField } from './light';
import { LightView } from './lightview';
import { Mood, type AirMover } from './mood';
import { projectileAir } from './airshots';
import { TERRAIN, TerrainLayer } from './terrain';
import { BLAST_X, FIRE_EVERY, FIRE_FLIGHT, FIRE_Y, MOOD_FIGURES, MOOD_H, MOOD_TORCHES, MOOD_VIEWER, MOOD_W, MOOD_WARM, moodMap, moodScript } from './moodDemoScript';
import { TorchView } from './torch';
import { VisionMask } from './visionmask';

const W = MOOD_W;
const H = MOOD_H;
const arrowAir = projectileAir(KIND.Arrow);
const fireAir = projectileAir(KIND.Fireball);

export class MoodDemoScene extends Phaser.Scene {
  private t = 0;
  private fx!: Effects;
  private layer!: TerrainLayer;
  private view!: LightView;
  private mask!: VisionMask;
  private mood!: Mood;
  private viewer = MOOD_VIEWER;
  private torches: { view: TorchView; x: number; y: number; side: number }[] = [];
  private bar?: HTMLDivElement;
  private fireball!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Image;
  private knight!: Phaser.GameObjects.Image;
  private wind?: Phaser.GameObjects.Graphics;
  private flip = false;
  private prev = new Map<string, [number, number]>();

  constructor() {
    super('mood-demo');
  }

  create(): void {
    const q = new URLSearchParams(location.search);
    const map = moodMap();
    this.cameras.main.setBackgroundColor('#000000');
    this.fx = new Effects(this);
    demoBoard(this, map);
    this.layer = new TerrainLayer(this, map, this.fx);

    const field = new LightField(map);
    let id = 1;
    const light = (x: number, y: number, kind: number, colour: number) => field.add({ id: id++, kind, colour, x, y, on: true });
    for (const tc of MOOD_TORCHES) {
      light(tc.tx, tc.ty, LIGHT_KIND.Torch, MOOD_WARM);
      this.torches.push({ view: new TorchView(this), x: tc.x, y: tc.y, side: tc.side });
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.get(x, y) === TERRAIN.Lava) light(x, y, LIGHT_KIND.Lava, 0xff4818);
    this.view = new LightView(this, map, field);
    this.mask = new VisionMask(this, map);
    this.mood = new Mood(this, map, this.view);
    for (const k of ['dust', 'smoke', 'embers', 'haze', 'drips'] as const) this.mood.on[k] = q.get(k) !== '0';
    this.mood.on.stir = q.get('stir') !== '0';
    this.mood.on.draft = q.get('draft') !== '0';
    const respawn = Number(q.get('respawn'));
    if (q.get('respawn') !== null && Number.isFinite(respawn) && respawn >= 0) this.mood.stirDelay = respawn;

    // Figures and props, standing on their feet.
    const put = (frame: string, x: number, y: number, flip = false) =>
      this.add.image(x * TILE, y * TILE, 'atlas', frame).setOrigin(0.5, 1).setFlipX(flip).setDepth(DEPTH.entityBase + y * TILE);
    for (const f of MOOD_FIGURES) put(f.frame, f.x, f.y, f.flip);

    this.fireball = this.add.image(0, 0, 'glow').setTint(0xff7020).setScale(1.4).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.projectile);

    this.arrow = this.add.image(0, 0, 'atlas', 'weapon_arrow').setScale(0.6).setRotation(Math.PI / 2).setDepth(DEPTH.projectile);
    this.knight = this.add.image(0, 0, 'atlas', 'knight_m_run_anim_f0').setOrigin(0.5, 1);
    if (q.get('wind') === '1') this.wind = this.add.graphics().setDepth(DEPTH.fog + 1);

    const cam = this.cameras.main;
    const barH = 64;
    cam.setZoom(Math.min(cam.width / ((W - 0.5) * TILE), (cam.height - barH) / ((H - 1) * TILE)));
    cam.centerOn((W * TILE) / 2, 9.2 * TILE + barH / 2 / cam.zoom);
    this.buttons();
    this.events.once('shutdown', () => {
      this.bar?.remove();
      this.mood.destroy();
    });
  }

  /** Big buttons along the bottom of the page, for a phone. */
  private buttons(): void {
    const bar = (this.bar = document.createElement('div'));
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px;background:rgba(0,0,0,.75);z-index:10;font:600 15px system-ui,sans-serif';
    const add = (label: () => string, act: () => void) => {
      const b = document.createElement('button');
      b.style.cssText = 'padding:10px 12px;border-radius:8px;border:1px solid #777;background:#222;color:#fff;font:inherit;min-width:84px';
      b.textContent = label();
      b.onclick = () => {
        act();
        b.textContent = label();
      };
      bar.appendChild(b);
    };
    const on = this.mood.on;
    for (const k of ['dust', 'smoke', 'embers', 'haze', 'drips'] as const)
      add(() => `${k[0].toUpperCase()}${k.slice(1)}: ${on[k] ? 'on' : 'off'}`, () => (on[k] = !on[k]));
    add(() => `Stir: ${this.mood.on.stir ? 'on' : 'off'}`, () => (this.mood.on.stir = !this.mood.on.stir));
    add(() => `Draft: ${this.mood.on.draft ? 'on' : 'off'}`, () => (this.mood.on.draft = !this.mood.on.draft));
    add(() => `Respawn: ${this.mood.stirDelay === 0 ? 'instant' : `${this.mood.stirDelay} s`}`, () => (this.mood.stirDelay = this.mood.stirDelay === 0 ? 3 : 0));
    document.body.appendChild(bar);
  }

  /** ?wind=1: a short line per 16 px along the air velocity (length = speed x 0.6 px, capped 14, plus a dot at each point). */
  private drawWind(): void {
    const g = this.wind;
    if (!g) return;
    g.clear();
    g.lineStyle(1, 0x66ccff, 0.9);
    for (let y = 3 * TILE + 8; y < 16 * TILE; y += 16)
      for (let x = TILE + 8; x < 14 * TILE; x += 16) {
        const [vx, vy] = this.mood.airAt(x, y);
        const sp = Math.hypot(vx, vy);
        g.fillStyle(0x66ccff, 0.9);
        g.fillRect(x, y, 1, 1);
        if (sp < 1) continue;
        const len = Math.min(14, sp * 0.6);
        g.lineBetween(x, y, x + (vx / sp) * len, y + (vy / sp) * len);
      }
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    this.fx.update(dt);
    this.layer.update(dt);
    for (const tr of this.torches) tr.view.update(tr.x, tr.y, true, tr.side, this.t);
    const cam = this.cameras.main;
    const movers: AirMover[] = [];
    // Velocity = the change of position since the last frame / dt.
    const mover = (key: string, x: number, y: number, r: number, shot: boolean, heat = 0) => {
      const o = this.prev.get(key);
      this.prev.set(key, [x, y]);
      if (o && dt > 0) movers.push({ x, y, vx: (x - o[0]) / dt, vy: (y - o[1]) / dt, r, shot, heat });
    };
    const st = moodScript(this.t);
    // The knight walks the loop and dashes for 0.25 s every 6 s.
    const w = st.walker;
    if (w.dx !== 0) this.flip = w.dx < 0;
    this.knight
      .setPosition(w.x, w.y)
      .setFlipX(this.flip)
      .setDepth(DEPTH.entityBase + w.y)
      .setFrame(`knight_m_run_anim_f${Math.floor(this.t * 10) % 4}`);
    mover('knight', w.x, w.y - 4, 6, false);
    // An arrow crosses from west to east at y = 8.5 tiles every 3 s, 1.5 s after the fireball.
    if (st.arrow) {
      this.arrow.setVisible(true).setPosition(st.arrow.x, st.arrow.y);
      mover('arrow', st.arrow.x, st.arrow.y, arrowAir.r, true, arrowAir.heat);
    } else {
      this.arrow.setVisible(false);
      this.prev.delete('arrow');
    }
    // A fireball crosses the north of the room every 4 s and explodes at the east wall.
    const moving: MovingLight[] = [];
    const p = this.t % FIRE_EVERY;
    if (st.fireball) {
      this.fireball.setVisible(true).setPosition(st.fireball.x, st.fireball.y);
      moving.push([st.fireball.x, st.fireball.y, LIGHT_KIND.Fire, 0xff7020]);
      mover('fireball', st.fireball.x, st.fireball.y, fireAir.r, true, fireAir.heat);
    } else {
      this.fireball.setVisible(false);
      this.prev.delete('fireball');
    }
    if (p >= FIRE_FLIGHT && p - dt < FIRE_FLIGHT) this.fx.blast(BLAST_X, FIRE_Y, 20);
    if (st.blast) moving.push([st.blast.x, st.blast.y, LIGHT_KIND.Blast, null]);
    this.view.update(cam.worldView, this.viewer.x, this.viewer.y, moving, this.t, 0, CONST.FOV_RADIUS);
    this.mask.update(cam.worldView, this.view.view);
    this.mood.update(dt, cam.worldView, this.torches.map((tr) => ({ x: tr.x, y: tr.y, side: tr.side, lit: true })), moving.map(([x, y, kind]) => ({ x, y, kind })), movers);
    this.drawWind();
  }
}

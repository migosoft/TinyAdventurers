// Dev page ?mood (no server): one dungeon room to judge the dungeon air (#148, #158).
// Warm torches, a lava pool, a water pool, a few still figures, a knight who walks a loop
// round the pillar (and dashes every 6 s), an arrow that crosses every 3 s and a fireball that
// crosses every 4 s and explodes at the east wall. The knight, arrow and fireball stir the air.
// Buttons at the bottom (tap or click) switch dust, smoke, embers, haze, drips, Stir, Draft and
// Respawn (instant / 3 s). URL: ?dust=0 etc., ?stir=0, ?draft=0, ?respawn=<seconds>, and
// ?wind=1 draws the wind field as short lines. Zoomed to fit the room to the screen, so it reads on a phone.
import Phaser from 'phaser';
import { CONST, KIND, LIGHT_KIND, TILE_ID } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { TILE, TileMap } from '../sim/map';
import { tileDraws } from './autotile';
import { Effects, DEPTH } from './effects';
import { LightField } from './light';
import { LightView } from './lightview';
import { Mood, type AirMover } from './mood';
import { projectileAir } from './airshots';
import { TERRAIN, TerrainLayer } from './terrain';
import { TorchView } from './torch';
import { VisionMask } from './visionmask';

const W = 15;
const H = 17;
const WARM = 0xffaa5a;

function buildMap(): TileMap {
  const tiles = new Uint8Array(W * H).fill(TILE_ID.Wall);
  for (let y = 3; y <= 15; y++) for (let x = 1; x <= 13; x++) tiles[y * W + x] = TILE_ID.Floor;
  tiles[7 * W + 4] = TILE_ID.Wall; // a pillar, for a shadow
  for (let y = 12; y <= 14; y++) for (let x = 9; x <= 12; x++) tiles[y * W + x] = TERRAIN.Lava;
  for (let y = 12; y <= 15; y++) for (let x = 1; x <= 4; x++) tiles[y * W + x] = TERRAIN.Shallow; // a pool, for the drips
  for (let y = 13; y <= 14; y++) for (let x = 2; x <= 3; x++) tiles[y * W + x] = TERRAIN.Deep;
  return new TileMap(W, H, tiles);
}

const WALK_SPEED = 60;
const DASH_SPEED = 300;
const DASH_EVERY = 6;
const DASH_TIME = 0.25;
const ARROW_SPEED = 260;
const arrowAir = projectileAir(KIND.Arrow);
const fireAir = projectileAir(KIND.Fireball);
// The walker's loop: a rounded rectangle round the pillar (feet positions, px).
const LX0 = 3.3 * TILE;
const LX1 = 11.7 * TILE;
const LY0 = 6.3 * TILE;
const LY1 = 10.7 * TILE;
const LR = 1.2 * TILE;
const SEG_X = LX1 - LX0 - 2 * LR;
const SEG_Y = LY1 - LY0 - 2 * LR;
const ARC = (Math.PI / 2) * LR;
const LOOP = 2 * SEG_X + 2 * SEG_Y + 4 * ARC;

/** The point and heading (x direction) at arc length s along the loop, clockwise from the top left. */
function loopAt(s: number): { x: number; y: number; dx: number } {
  s = ((s % LOOP) + LOOP) % LOOP;
  if (s < SEG_X) return { x: LX0 + LR + s, y: LY0, dx: 1 };
  s -= SEG_X;
  if (s < ARC) {
    const a = s / LR;
    return { x: LX1 - LR + Math.sin(a) * LR, y: LY0 + LR - Math.cos(a) * LR, dx: 1 };
  }
  s -= ARC;
  if (s < SEG_Y) return { x: LX1, y: LY0 + LR + s, dx: 0 };
  s -= SEG_Y;
  if (s < ARC) {
    const a = s / LR;
    return { x: LX1 - LR + Math.cos(a) * LR, y: LY1 - LR + Math.sin(a) * LR, dx: 1 };
  }
  s -= ARC;
  if (s < SEG_X) return { x: LX1 - LR - s, y: LY1, dx: -1 };
  s -= SEG_X;
  if (s < ARC) {
    const a = s / LR;
    return { x: LX0 + LR - Math.sin(a) * LR, y: LY1 - LR + Math.cos(a) * LR, dx: -1 };
  }
  s -= ARC;
  if (s < SEG_Y) return { x: LX0, y: LY1 - LR - s, dx: 0 };
  s -= SEG_Y;
  const a = s / LR;
  return { x: LX0 + LR - Math.cos(a) * LR, y: LY0 + LR - Math.sin(a) * LR, dx: -1 };
}

export class MoodDemoScene extends Phaser.Scene {
  private t = 0;
  private fx!: Effects;
  private layer!: TerrainLayer;
  private view!: LightView;
  private mask!: VisionMask;
  private mood!: Mood;
  private viewer = { x: 7.5 * TILE, y: 9.5 * TILE };
  private torches: { view: TorchView; x: number; y: number; side: number }[] = [];
  private bar?: HTMLDivElement;
  private fireball!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Image;
  private knight!: Phaser.GameObjects.Image;
  private wind?: Phaser.GameObjects.Graphics;
  private walkS = 0;
  private flip = false;
  private prev = new Map<string, [number, number]>();

  constructor() {
    super('mood-demo');
  }

  create(): void {
    const q = new URLSearchParams(location.search);
    const map = buildMap();
    this.cameras.main.setBackgroundColor('#000000');
    this.fx = new Effects(this);
    const rt = this.add.renderTexture(0, 0, W * TILE, H * TILE).setOrigin(0).setDepth(DEPTH.map);
    rt.beginDraw();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        for (const d of tileDraws(map, x, y)) rt.batchDrawFrame('atlas', d.frame, x * TILE, y * TILE + (d.dy ?? 0));
    rt.endDraw();
    this.layer = new TerrainLayer(this, map, this.fx);

    const field = new LightField(map);
    let id = 1;
    const light = (x: number, y: number, kind: number, colour: number) => field.add({ id: id++, kind, colour, x, y, on: true });
    for (const tx of [3, 7, 11]) {
      light(tx, 3, LIGHT_KIND.Torch, WARM);
      this.torches.push({ view: new TorchView(this), x: (tx + 0.5) * TILE, y: 3 * TILE + 0.5, side: 0 });
    }
    light(1, 9, LIGHT_KIND.Torch, WARM);
    this.torches.push({ view: new TorchView(this), x: 1 * TILE + 0.5, y: 9.5 * TILE, side: 1 });
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
    put('elf_f_idle_anim_f0', 5.5, 11.2);
    put('wizzard_m_idle_anim_f0', 9.2, 8.6, true);
    put('skelet_idle_anim_f0', 6.6, 12.8);
    put('skelet_idle_anim_f0', 11.5, 6, true);
    put('chest_full_open_anim_f0', 2.5, 5);
    put('crate', 12.5, 4.8);
    put('skull', 6.3, 14.4);
    put('skull', 10.4, 5.4);

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
    // The knight walks the loop and dashes for 0.25 s every 6 s.
    const dashing = this.t % DASH_EVERY < DASH_TIME;
    this.walkS += (dashing ? DASH_SPEED : WALK_SPEED) * dt;
    const w = loopAt(this.walkS);
    if (w.dx !== 0) this.flip = w.dx < 0;
    this.knight
      .setPosition(w.x, w.y)
      .setFlipX(this.flip)
      .setDepth(DEPTH.entityBase + w.y)
      .setFrame(`knight_m_run_anim_f${Math.floor(this.t * 10) % 4}`);
    mover('knight', w.x, w.y - 4, 6, false);
    // An arrow crosses from west to east at y = 8.5 tiles every 3 s, 1.5 s after the fireball.
    const ap = (((this.t - 1.5) % 3) + 3) % 3;
    const ax = (1.5 * TILE) + ap * ARROW_SPEED;
    if (ax < 13.5 * TILE) {
      this.arrow.setVisible(true).setPosition(ax, 8.5 * TILE);
      mover('arrow', ax, 8.5 * TILE, arrowAir.r, true, arrowAir.heat);
    } else {
      this.arrow.setVisible(false);
      this.prev.delete('arrow');
    }
    // A fireball crosses the north of the room every 4 s and explodes at the east wall.
    const moving: MovingLight[] = [];
    const p = this.t % 4;
    const fy = 5.5 * TILE;
    if (p < 2) {
      const fx = (2.5 + 10 * (p / 2)) * TILE;
      this.fireball.setVisible(true).setPosition(fx, fy);
      moving.push([fx, fy, LIGHT_KIND.Fire, 0xff7020]);
      mover('fireball', fx, fy, fireAir.r, true, fireAir.heat);
    } else {
      this.fireball.setVisible(false);
      this.prev.delete('fireball');
    }
    if (p >= 2 && p - dt < 2) this.fx.explosion(12.5 * TILE, fy, 20);
    if (p >= 2 && p < 2.4) moving.push([12.5 * TILE, fy, LIGHT_KIND.Blast, null]);
    this.view.update(cam.worldView, this.viewer.x, this.viewer.y, moving, this.t, 0, CONST.FOV_RADIUS);
    this.mask.update(cam.worldView, this.view.view);
    this.mood.update(dt, cam.worldView, this.torches.map((tr) => ({ x: tr.x, y: tr.y, side: tr.side, lit: true })), moving.map(([x, y, kind]) => ({ x, y, kind })), movers);
    this.drawWind();
  }
}

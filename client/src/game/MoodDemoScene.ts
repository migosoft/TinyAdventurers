// Dev page ?mood (no server): one dungeon room to judge the dungeon air (#148).
// Warm torches, a lava pool, a water pool, a few figures and a fireball that crosses the
// room every 4 s and explodes at the east wall. Buttons at the bottom (tap or click)
// switch dust, smoke, embers, haze and drips. Zoomed to fit the room to the screen, so it reads on a phone.
import Phaser from 'phaser';
import { CONST, LIGHT_KIND, TILE_ID } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { TILE, TileMap } from '../sim/map';
import { tileDraws } from './autotile';
import { Effects, DEPTH } from './effects';
import { LightField } from './light';
import { LightView } from './lightview';
import { Mood } from './mood';
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

    // Figures and props, standing on their feet.
    const put = (frame: string, x: number, y: number, flip = false) =>
      this.add.image(x * TILE, y * TILE, 'atlas', frame).setOrigin(0.5, 1).setFlipX(flip).setDepth(DEPTH.entityBase + y * TILE);
    put('knight_m_idle_anim_f0', 7.5, 10);
    put('elf_f_idle_anim_f0', 5.5, 11.2);
    put('wizzard_m_idle_anim_f0', 9.2, 8.6, true);
    put('skelet_idle_anim_f0', 6.6, 12.8);
    put('skelet_idle_anim_f0', 11.5, 6, true);
    put('chest_full_open_anim_f0', 2.5, 5);
    put('crate', 12.5, 4.8);
    put('skull', 6.3, 14.4);
    put('skull', 10.4, 5.4);

    this.fireball = this.add.image(0, 0, 'glow').setTint(0xff7020).setScale(1.4).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.projectile);

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
    document.body.appendChild(bar);
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    this.fx.update(dt);
    this.layer.update(dt);
    for (const tr of this.torches) tr.view.update(tr.x, tr.y, true, tr.side, this.t);
    const cam = this.cameras.main;
    // A fireball crosses the north of the room every 4 s and explodes at the east wall.
    const moving: MovingLight[] = [];
    const p = this.t % 4;
    const fy = 5.5 * TILE;
    if (p < 2) {
      const fx = (2.5 + 10 * (p / 2)) * TILE;
      this.fireball.setVisible(true).setPosition(fx, fy);
      moving.push([fx, fy, LIGHT_KIND.Fire, 0xff7020]);
    } else this.fireball.setVisible(false);
    if (p >= 2 && p - dt < 2) this.fx.explosion(12.5 * TILE, fy, 20);
    if (p >= 2 && p < 2.4) moving.push([12.5 * TILE, fy, LIGHT_KIND.Blast, null]);
    this.view.update(cam.worldView, this.viewer.x, this.viewer.y, moving, this.t, 0, CONST.FOV_RADIUS);
    this.mask.update(cam.worldView, this.view.view);
    this.mood.update(dt, cam.worldView, this.torches.map((tr) => ({ x: tr.x, y: tr.y, side: tr.side, lit: true })), moving.map(([x, y, kind]) => ({ x, y, kind })));
  }
}

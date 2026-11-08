// Dev page ?woodland (no server): the woodland level to judge on a phone (#203, #277, #278). Three server-made woodlands
// (generated/woodland-demo.json, seeds 1-3) with the whole look: ground, trees and bushes with their shadows from the
// sun, cloud shadows, bees, butterflies, the haze over what is unseen, and the knight's silhouette behind canopies. Tap
// the map to walk there (along the road, through the grass; trees, trunks and thickets stop you). Zoomed so 32 tiles
// fit the screen's width; the tiles row changes it (16..48).
// Buttons (tap): Clouds, Bees, Butterflies, Silhouette, Shade (the haze behind trunks), Shadows, Haze on / off; Next
// seed; Sun L/R and its elevation (restarts the page's scene so the plants redraw); the shadow alpha; the haze's
// outside, soft, blur, desat and mix; cloud Size, Speed, Dark and Cover. All with - and + (the values are shown, so
// they can be reported). URL: ?woodland&seed=2&clouds=0&bees=0&butterflies=0&silhouette=0&shade=0&shadows=0&haze=0
// &side=L|R&elev=35&shadow=0.28&outside=1&soft=0.7&blur=1.5&desat=0.6&mix=0.45
import Phaser from 'phaser';
import { CONST, TILE_ID } from '../generated/defs';
import demo from '../generated/woodland-demo.json';
import type { WoodlandInfo } from '../generated/WoodlandInfo';
import type { SunInfo } from '../generated/SunInfo';
import { TILE, TileMap } from '../sim/map';
import { FIGURES } from './anim/defs';
import { DEPTH, Effects } from './effects';
import { LightField } from './light';
import { LightView } from './lightview';
import { lookOf } from './silhouette';
import { syncUnseenFX, DEFAULT_HAZE } from './unseenfx';
import { VisionMask } from './visionmask';
import { DEFAULT_CLOUDS } from './woodland/clouds';
import { ALPHA, CLOUD_STEPS, ELEV, HAZE_STEPS, nextSeed, stepAlpha, stepCloud, stepElev, stepHaze, stepTiles, stepToward, TILES, zoomForTiles, type CloudKey } from './woodland/demoMath';
import { SHADOW_ALPHA } from './woodland/shadows';
import { WoodlandView } from './woodland/WoodlandView';

interface DemoMap { w: number; h: number; tiles: number[]; woodland: WoodlandInfo; spawns: [number, number, number][] }
const MAPS = demo as unknown as DemoMap[];
/** The knight's speed (px/s) and his collision half-width (px). */
const SPEED = 4 * TILE;
const HALF = 4;
const CLOUD_KEYS: CloudKey[] = ['size', 'speed', 'dark', 'cover'];
const HAZE_KEYS = ['outside', 'soft', 'blurPx', 'desat', 'mix'] as const;
/** The URL names of the haze knobs. */
const HAZE_PARAMS: Record<(typeof HAZE_KEYS)[number], string> = { outside: 'outside', soft: 'soft', blurPx: 'blur', desat: 'desat', mix: 'mix' };

/** Switches survive a next-seed restart. */
const on = { clouds: true, bees: true, butterflies: true, silhouette: true, shade: true, shadows: true, haze: true };
let look = { ...DEFAULT_CLOUDS };
let tiles: number = TILES.def;
/** The sun replacing the map's own (Sun and elev buttons, `side`, `elev`); all seeds share it. */
let sunOverride: Partial<SunInfo> = {};
/** The part of it that came from the URL: it stays across Seed next, the buttons' part does not. */
const urlSun: Partial<SunInfo> = {};
let shadowAlpha = SHADOW_ALPHA;
let haze = { ...DEFAULT_HAZE };
let urlRead = false;

export class WoodlandDemoScene extends Phaser.Scene {
  private seed = 1;
  private t = 0;
  private fx!: Effects;
  private view!: LightView;
  private mask!: VisionMask;
  /** Kept for the shutdown handler: `cameras.main` is already gone there. */
  private cam!: Phaser.Cameras.Scene2D.Camera;
  private field!: LightField;
  private woodland!: WoodlandView;
  private map!: TileMap;
  private knight!: Phaser.GameObjects.Sprite;
  private figures: { s: Phaser.GameObjects.Sprite; idle: string }[] = [];
  private target: { x: number; y: number } | null = null;
  private moving = false;
  private bar?: HTMLDivElement;
  private info?: HTMLDivElement;

  constructor() {
    super('woodland-demo');
  }

  init(data: { seed?: number }): void {
    const q = new URLSearchParams(location.search);
    if (!urlRead) {
      urlRead = true;
      for (const k of Object.keys(on) as (keyof typeof on)[]) if (q.get(k) === '0') on[k] = false;
      const num = (name: string) => (q.get(name) === null || q.get(name) === '' ? NaN : Number(q.get(name)));
      const side = q.get('side')?.toUpperCase();
      const elev = num('elev');
      if (side === 'L' || side === 'R') urlSun.side = side === 'L' ? -1 : 1;
      if (Number.isFinite(elev)) urlSun.elevation = Math.min(ELEV.max, Math.max(ELEV.min, elev));
      sunOverride = { ...urlSun };
      const a = num('shadow');
      if (Number.isFinite(a)) shadowAlpha = Math.min(ALPHA.max, Math.max(ALPHA.min, a));
      for (const k of HAZE_KEYS) {
        const v = num(HAZE_PARAMS[k]);
        if (Number.isFinite(v)) haze[k] = Math.min(HAZE_STEPS[k].max, Math.max(HAZE_STEPS[k].min, v));
      }
    }
    const s = data.seed ?? Number(q.get('seed'));
    this.seed = Number.isInteger(s) && s >= 1 && s <= MAPS.length ? s : 1;
  }

  create(): void {
    const d = MAPS[this.seed - 1];
    this.t = 0;
    this.figures = [];
    this.target = null;
    this.map = new TileMap(d.w, d.h, Uint8Array.from(d.tiles));
    const map = this.map;
    this.cam = this.cameras.main;
    this.cameras.main.setBackgroundColor('#1a2a14');
    this.cameras.main.setRoundPixels(true);
    // like the game: the camera stops at the map's edge (#259)
    this.cameras.main.setBounds(0, 0, map.w * TILE, map.h * TILE);
    this.fx = new Effects(this);
    this.field = new LightField(map);
    this.field.daylight = true;
    this.view = new LightView(this, map, this.field);
    // the start: the middle tile of the road's western end
    const start = this.startPoint(d);
    const info: WoodlandInfo = { ...d.woodland, sun: { ...d.woodland.sun, ...sunOverride } };
    this.woodland = new WoodlandView(this, info, map, start, true);
    this.woodland.clouds.look = { ...look };
    this.mask = new VisionMask(this, map);
    this.mask.haze = true; // before any update: UnseenFX hazes the unseen, no black
    this.mask.outside = haze.outside;
    this.mask.soft = on.shade ? haze.soft : 0;

    this.knight = this.add.sprite(start.x, start.y, 'atlas', 'knight_m_idle_anim_f0').setOrigin(0.5, 1);
    this.knight.setDepth(DEPTH.entityBase + start.y);
    for (const [kind, x, y] of d.spawns) {
      const f = FIGURES[kind];
      if (!f || !this.textures.get('atlas').has(`${f.idle}0`)) continue;
      const s = this.add.sprite(x, y, 'atlas', `${f.idle}0`).setOrigin(0.5, 1).setDepth(DEPTH.entityBase + y);
      this.figures.push({ s, idle: f.idle });
    }

    // taps from the Phaser input only: the button bar is a DOM element above the canvas
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.target = { x: p.worldX, y: p.worldY };
    });
    this.zoom();
    this.buttons();
    this.applySwitches();
    this.events.once('shutdown', () => {
      this.bar?.remove();
      this.info?.remove();
      this.woodland.destroy();
      // Phaser does not destroy a camera's post pipelines with the camera: remove it, or each restart leaks one
      syncUnseenFX(this.cam, false, undefined, this.mask.rect, DEFAULT_HAZE);
    });
  }

  /** The camera zoom that shows `tiles` tiles across the width. */
  private zoom(): void {
    const cam = this.cameras.main;
    cam.setZoom(zoomForTiles(cam.width, tiles, TILE));
  }

  /** The road just east of the western invisible wall (#259): the middle of that road column, on the tile's lower half. */
  private startPoint(d: DemoMap): { x: number; y: number } {
    let wall = d.w;
    for (let i = 0; i < d.tiles.length; i++) if (d.tiles[i] === TILE_ID.Barrier) wall = Math.min(wall, i % d.w);
    const x0 = wall < d.w ? wall + 1 : 0;
    const ys: number[] = [];
    for (let y = 0; y < d.h; y++) if (d.tiles[y * d.w + x0] === TILE_ID.Road) ys.push(y);
    return { x: (x0 + 1) * TILE, y: (ys[Math.floor(ys.length / 2)] + 0.8) * TILE };
  }

  private applySwitches(): void {
    this.woodland.clouds.look = { ...look, dark: on.clouds ? look.dark : 0 };
    this.woodland.critters.beesOn = on.bees;
    this.woodland.critters.butterfliesOn = on.butterflies;
    this.woodland.silhouetteOn = on.silhouette;
    this.woodland.shadows.visible = on.shadows;
    this.woodland.shadows.alpha = shadowAlpha;
  }

  /** Big buttons along the bottom of the page, for a phone, and a line of numbers above them. */
  private buttons(): void {
    const bar = (this.bar = document.createElement('div'));
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px;background:rgba(0,0,0,.78);z-index:10;max-height:55vh;overflow-y:auto;font:600 15px system-ui,sans-serif;color:#fff';
    const info = (this.info = document.createElement('div'));
    info.style.cssText = 'width:100%;text-align:center;font:600 13px ui-monospace,monospace;line-height:1.35';
    bar.appendChild(info);
    const all: (() => void)[] = [];
    const btn = (label: () => string, act: () => void, min = 84) => {
      const b = document.createElement('button');
      b.style.cssText = `padding:10px 12px;border-radius:8px;border:1px solid #777;background:#222;color:#fff;font:inherit;min-width:${min}px`;
      const upd = () => (b.textContent = label());
      upd();
      b.onclick = () => {
        act();
        all.forEach((f) => f());
      };
      all.push(upd);
      return b;
    };
    const row = () => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:6px;justify-content:center;align-items:center;width:100%';
      bar.appendChild(r);
      return r;
    };
    const onOff = (v: boolean) => (v ? 'on' : 'off');
    const r1 = row();
    for (const k of Object.keys(on) as (keyof typeof on)[]) {
      r1.style.flexWrap = 'wrap';
      r1.appendChild(btn(() => `${k[0].toUpperCase()}${k.slice(1)}: ${onOff(on[k])}`, () => {
        on[k] = !on[k];
        this.applySwitches();
      }));
    }
    r1.appendChild(btn(() => `Seed #${this.seed} next`, () => {
      sunOverride = { ...urlSun }; // each seed shows its own sun again
      this.scene.restart({ seed: nextSeed(this.seed, MAPS.length) });
    }));
    const zr = row();
    const zl = document.createElement('span');
    zl.style.cssText = 'flex:1;text-align:center;min-width:140px';
    all.push(() => (zl.textContent = `tiles ${tiles}`));
    const zstep = (dir: 1 | -1) => () => {
      tiles = stepTiles(tiles, dir);
      this.zoom();
    };
    zr.append(btn(() => '-', zstep(-1), 56), zl, btn(() => '+', zstep(1), 56));
    // sun: the side (restarts, so the plants redraw with the light) and its elevation
    const sun = (): SunInfo => ({ ...MAPS[this.seed - 1].woodland.sun, ...sunOverride });
    const resun = (next: SunInfo) => {
      sunOverride = next;
      this.scene.restart({ seed: this.seed });
    };
    const sr = row();
    const sl = document.createElement('span');
    sl.style.cssText = 'flex:1;text-align:center;min-width:80px';
    all.push(() => (sl.textContent = `elev ${sun().elevation}`));
    sr.append(
      btn(() => `Sun: ${sun().side < 0 ? 'L' : 'R'}`, () => resun({ ...sun(), side: -sun().side })),
      btn(() => '-', () => resun({ ...sun(), elevation: stepElev(sun().elevation, -1) }), 56),
      sl,
      btn(() => '+', () => resun({ ...sun(), elevation: stepElev(sun().elevation, 1) }), 56),
    );
    // a label between - and +
    const stepper = (text: () => string, step: (dir: 1 | -1) => void) => {
      const r = row();
      const label = document.createElement('span');
      label.style.cssText = 'flex:1;text-align:center;min-width:140px';
      all.push(() => (label.textContent = text()));
      r.append(btn(() => '-', () => step(-1), 56), label, btn(() => '+', () => step(1), 56));
    };
    stepper(() => `shadow ${shadowAlpha.toFixed(2)}`, (dir) => {
      shadowAlpha = stepAlpha(shadowAlpha, dir);
      this.applySwitches();
    });
    for (const k of HAZE_KEYS) {
      stepper(() => `${HAZE_PARAMS[k]} ${haze[k].toFixed(HAZE_STEPS[k].digits)}`, (dir) => {
        haze = stepHaze(haze, k, dir);
      });
    }
    for (const k of CLOUD_KEYS) {
      stepper(() => `${k} ${look[k].toFixed(CLOUD_STEPS[k].digits)}`, (dir) => {
        look = stepCloud(look, k, dir);
        this.applySwitches();
      });
    }
    all.forEach((f) => f());
    document.body.appendChild(bar);
  }

  private blocked(x: number, y: number): boolean {
    return [[-HALF, -HALF], [HALF, -HALF], [-HALF, 0], [HALF, 0]].some(([dx, dy]) =>
      this.map.blocks(Math.floor((x + dx) / TILE), Math.floor((y + dy) / TILE), 'hero'));
  }

  private moveKnight(dt: number): void {
    const k = this.knight;
    this.moving = false;
    if (this.target) {
      const s = stepToward(k.x, k.y, this.target.x, this.target.y, SPEED * dt);
      const dx = s.x - k.x;
      // each axis alone, so the knight slides along a trunk
      const nx = this.blocked(s.x, k.y) ? k.x : s.x;
      const ny = this.blocked(nx, s.y) ? k.y : s.y;
      this.moving = nx !== k.x || ny !== k.y;
      if (!this.moving || s.arrived) this.target = null;
      k.setPosition(nx, ny);
      if (Math.abs(dx) > 1e-3) k.setFlipX(dx < 0);
    }
    k.setDepth(DEPTH.entityBase + k.y);
    const f = `knight_m_${this.moving ? 'run' : 'idle'}_anim_f${Math.floor(this.t * 8) % 4}`;
    if (k.frame.name !== f) k.setFrame(f);
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    this.fx.update(dt);
    this.moveKnight(dt);
    for (const f of this.figures) f.s.setFrame(`${f.idle}${Math.floor(this.t * 6) % 4}`);
    const cam = this.cameras.main;
    // keep the knight in the middle of the part of the screen above the button bar
    cam.centerOn(this.knight.x, this.knight.y + (this.bar?.offsetHeight ?? 0) / 2 / cam.zoom);
    this.view.update(cam.worldView, this.knight.x, this.knight.y - 6, [], this.t, 0, CONST.FOV_RADIUS + 5);
    this.mask.outside = haze.outside;
    this.mask.soft = on.shade && this.woodland.settled ? haze.soft : 0; // the haze behind trunks waits for them
    this.mask.update(cam.worldView, this.view.view, () => this.view.sight);
    syncUnseenFX(cam, on.haze, this.mask.texture, this.mask.rect, haze);
    this.woodland.update(this.t, lookOf(this.knight), cam.worldView, this.view.seenLit);
    if (this.info) {
      const c = this.woodland.clouds.look;
      const sun = { ...MAPS[this.seed - 1].woodland.sun, ...sunOverride };
      const h = haze;
      this.info.textContent = `seed ${this.seed}  tile ${Math.floor(this.knight.x / TILE)},${Math.floor(this.knight.y / TILE)}  sun ${sun.side < 0 ? 'L' : 'R'} ${sun.elevation}  shadow ${on.shadows ? shadowAlpha.toFixed(2) : 'off'}  haze ${on.haze ? `${h.outside.toFixed(1)}/${on.shade ? h.soft.toFixed(1) : 'off'}/${h.blurPx.toFixed(1)}/${h.desat.toFixed(1)}/${h.mix.toFixed(2)}` : 'off'}  clouds ${on.clouds ? `${c.size}/${c.speed}/${c.dark}/${c.cover}` : 'off'}`;
    }
  }
}

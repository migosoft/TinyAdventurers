// Dev page ?cove (no server): the nymph's cove, to judge the look on a phone (#202).
// One big room (20x16 tiles of floor) with a large tree in the middle, a grass carpet with flowers, bushes,
// tufts and ferns, several sunbeams (Daylight lights), pixies around the canopy, and a knight walking a loop
// around the trunk. When the knight is behind the tree, a pale silhouette of it shows through the leaves.
// The viewer sees the whole room. Mood is on (dust, haze).
// Buttons at the bottom (tap or click): Walk on / off; tap the room to send the knight there (stops the loop),
// Silhouette, Pixies and Beams on / off, Suns 1 / 3 / 5, Reroll #n (a new seed: new grass, flowers and plants).
// URL: ?cove&seed=3&suns=3&pixies=0&silhouette=0&walk=0&beam=0
// Zoomed to fit the room to the screen, so it reads on a phone.
import Phaser from 'phaser';
import { CONST, LIGHT, LIGHT_KIND, TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { tileDraws } from './autotile';
import { COVE_TREE_FOOT, type CoveSpec, paintCove, placeCovePlants } from './covemath';
import { Effects, DEPTH } from './effects';
import { LightField } from './light';
import { LightView } from './lightview';
import { Mood } from './mood';
import { Pixies } from './pixies';
import { lookOf, Silhouette } from './silhouette';
import { Sunbeams } from './sunbeams';
import { TerrainLayer } from './terrain';
import { VisionMask } from './visionmask';

const W = 22;
const H = 19;
/** The floor rect in tiles: x 1..20, y 2..17. */
const FLOOR = { x: 1, y: 2, w: 20, h: 16 };
/** paintCove's margin around the floor area (px). */
const MARGIN = 32;
const TREE_W = 96;
const TREE_H = 100;
const GRASS_TEX = 'cove-grass';
const SPEED = 1.5 * TILE;
/** The walking loop: an ellipse of 5 x 3 tiles around the trunk foot. */
const LOOP = { rx: 2.5 * TILE, ry: 1.5 * TILE };
/** Pixie centre: the canopy middle, above the trunk foot (px). */
const CANOPY_UP = 50;
const SUNS = [1, 3, 5];
/** Sun spots in floor tiles from the floor's top-left: the middle first, then the four quarter centres. */
const SUN_SPOTS = [[10, 8], [5, 4], [15, 12], [15, 4], [5, 12]];
const SUN_SETS: Record<number, number[]> = { 1: [0], 3: [1, 0, 2], 5: [0, 1, 2, 3, 4] };

function buildMap(): TileMap {
  const tiles = new Uint8Array(W * H).fill(TILE_ID.Wall);
  for (let y = FLOOR.y; y < FLOOR.y + FLOOR.h; y++) for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x++) tiles[y * W + x] = TILE_ID.Floor;
  return new TileMap(W, H, tiles);
}

export class CoveDemoScene extends Phaser.Scene {
  private t = 0;
  private fx!: Effects;
  private layer!: TerrainLayer;
  private view!: LightView;
  private mask!: VisionMask;
  private mood!: Mood;
  private sun!: Sunbeams;
  private field!: LightField;
  private pixies!: Pixies;
  private silhouette!: Silhouette;
  private bar?: HTMLDivElement;
  private refreshBar?: () => void;
  private grass!: Phaser.GameObjects.Image;
  private tree!: Phaser.GameObjects.Image;
  private plants: Phaser.GameObjects.Image[] = [];
  private knight!: Phaser.GameObjects.Sprite;
  private sunIds: number[] = [];
  private seed = 1;
  private suns = 5;
  private walk = true;
  /** The loop's angle (rad) and the tap target while walking to a tapped point. */
  private angle = Math.PI / 2;
  private target: { x: number; y: number } | null = null;
  private moving = false;
  /** The trunk foot in world px. */
  private foot = { x: 0, y: 0 };
  /** The room centre in world px, the viewer of the light view. */
  private centre = { x: 0, y: 0 };

  constructor() {
    super('cove-demo');
  }

  create(): void {
    const q = new URLSearchParams(location.search);
    const num = (k: string) => (q.get(k) !== null && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
    this.seed = num('seed') ?? 1;
    const suns = num('suns');
    if (suns !== null && SUNS.includes(suns)) this.suns = suns;
    this.walk = q.get('walk') !== '0';
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

    const fw = FLOOR.w * TILE;
    const fh = FLOOR.h * TILE;
    const fx0 = FLOOR.x * TILE;
    const fy0 = FLOOR.y * TILE;
    this.foot = { x: fx0 + fw / 2, y: fy0 + fh / 2 + TILE };
    this.centre = { x: fx0 + fw / 2, y: fy0 + fh / 2 };

    this.grass = this.add.image(fx0 - MARGIN, fy0 - MARGIN, '__DEFAULT').setOrigin(0).setDepth(DEPTH.decal);
    this.tree = this.add.image(this.foot.x, this.foot.y, 'atlas', 'cove_tree')
      .setOrigin(COVE_TREE_FOOT.x / TREE_W, COVE_TREE_FOOT.y / TREE_H).setDepth(DEPTH.entityBase + this.foot.y);
    this.paintRoom();

    this.field = new LightField(map);
    this.placeSuns();
    this.view = new LightView(this, map, this.field);
    this.mask = new VisionMask(this, map);
    this.sun = new Sunbeams(this, this.field, this.view);
    this.mood = new Mood(this, map, this.view);
    this.sun.on.beam = q.get('beam') !== '0';
    for (const k of ['smoke', 'embers', 'drips'] as const) this.mood.on[k] = false;

    // origin (0.5, 1): the sprite's y is its feet, which depth sorting and the silhouette both use
    this.knight = this.add.sprite(this.foot.x, this.foot.y + LOOP.ry, 'atlas', 'knight_m_idle_anim_f0').setOrigin(0.5, 1);
    this.placeKnight();
    this.pixies = new Pixies(this, { x: this.foot.x, y: this.foot.y - CANOPY_UP }, 7, this.seed);
    this.pixies.on = q.get('pixies') !== '0';
    this.pixies.update(0, 0);
    this.silhouette = new Silhouette(this, this.tree, this.foot.y);
    this.silhouette.on = q.get('silhouette') !== '0';

    // taps from the Phaser input only: the button bar is a DOM element above the canvas
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const half = TILE / 2;
      this.target = {
        x: Math.min(Math.max(p.worldX, FLOOR.x * TILE + half), (FLOOR.x + FLOOR.w) * TILE - half),
        y: Math.min(Math.max(p.worldY, FLOOR.y * TILE + half), (FLOOR.y + FLOOR.h) * TILE - half),
      };
      this.walk = false;
      this.refreshBar?.();
    });

    const cam = this.cameras.main;
    const barH = 130;
    cam.setZoom(Math.min(cam.width / (W * TILE), (cam.height - barH) / ((FLOOR.h + 2) * TILE)));
    cam.centerOn((W * TILE) / 2, (FLOOR.y + FLOOR.h / 2) * TILE + barH / 2 / cam.zoom);
    this.buttons();
    this.events.once('shutdown', () => {
      this.bar?.remove();
      this.mood.destroy();
      this.sun.destroy();
      this.pixies.destroy();
      this.silhouette.destroy();
    });
  }

  /** (Re)paints the grass carpet and flowers and re-places the plants for the current seed. */
  private paintRoom(): void {
    const spec: CoveSpec = { w: FLOOR.w * TILE, h: FLOOR.h * TILE, tree: { x: this.foot.x - FLOOR.x * TILE, y: this.foot.y - FLOOR.y * TILE }, seed: this.seed };
    const art = paintCove(spec);
    if (this.textures.exists(GRASS_TEX)) this.textures.remove(GRASS_TEX);
    const c = this.textures.createCanvas(GRASS_TEX, art.w, art.h)!;
    c.getContext().putImageData(new ImageData(new Uint8ClampedArray(art.data), art.w, art.h), 0, 0);
    c.refresh();
    this.grass.setTexture(GRASS_TEX);
    for (const p of this.plants) p.destroy();
    this.plants = placeCovePlants(spec).map((p) => {
      const y = FLOOR.y * TILE + p.y;
      return this.add.image(FLOOR.x * TILE + p.x, y, 'atlas', p.frame).setOrigin(0.5, 1).setDepth(DEPTH.entityBase + y);
    });
  }

  /** (Re)places the Daylight lights: 1, 3 or 5 spots across the room. */
  private placeSuns(): void {
    for (const id of this.sunIds) this.field.remove(id);
    this.sunIds = [];
    for (const [i, s] of SUN_SETS[this.suns].entries()) {
      const [x, y] = SUN_SPOTS[s];
      this.field.add({ id: 1 + i, kind: LIGHT_KIND.Daylight, colour: LIGHT[LIGHT_KIND.Daylight].colour, x: FLOOR.x + x, y: FLOOR.y + y, on: true });
      this.sunIds.push(1 + i);
    }
  }

  /** Puts the knight on its loop at the current angle. */
  private placeKnight(): void {
    this.knight.setPosition(this.foot.x + Math.cos(this.angle) * LOOP.rx, this.foot.y + Math.sin(this.angle) * LOOP.ry);
    this.knight.setDepth(DEPTH.entityBase + this.knight.y);
  }

  /** Big buttons along the bottom of the page, for a phone. */
  private buttons(): void {
    const bar = (this.bar = document.createElement('div'));
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px;background:rgba(0,0,0,.75);z-index:10;font:600 15px system-ui,sans-serif';
    const all: (() => void)[] = [];
    const add = (label: () => string, act: () => void) => {
      const b = document.createElement('button');
      b.style.cssText = 'padding:10px 12px;border-radius:8px;border:1px solid #777;background:#222;color:#fff;font:inherit;min-width:84px';
      b.textContent = label();
      const upd = () => (b.textContent = label());
      b.onclick = () => {
        act();
        all.forEach((f) => f());
      };
      all.push(upd);
      bar.appendChild(b);
    };
    this.refreshBar = () => all.forEach((f) => f());
    const onOff = (v: boolean) => (v ? 'on' : 'off');
    add(() => `Walk: ${onOff(this.walk)}`, () => {
      if (!this.walk) {
        // resume at the nearest point of the loop, not at the old angle
        this.angle = Math.atan2((this.knight.y - this.foot.y) / LOOP.ry, (this.knight.x - this.foot.x) / LOOP.rx);
      }
      this.walk = !this.walk;
      this.target = null;
    });
    add(() => `Silhouette: ${onOff(this.silhouette.on)}`, () => (this.silhouette.on = !this.silhouette.on));
    add(() => `Pixies: ${onOff(this.pixies.on)}`, () => (this.pixies.on = !this.pixies.on));
    add(() => `Suns: ${this.suns}`, () => {
      this.suns = SUNS[(SUNS.indexOf(this.suns) + 1) % SUNS.length];
      this.placeSuns();
    });
    add(() => `Beams: ${onOff(this.sun.on.beam)}`, () => (this.sun.on.beam = !this.sun.on.beam));
    add(() => `Reroll #${this.seed}`, () => {
      this.seed++;
      this.paintRoom();
    });
    document.body.appendChild(bar);
  }

  /** Moves the knight: along the loop while walking, else straight to a tapped point. */
  private moveKnight(dt: number): void {
    const k = this.knight;
    let dx = 0;
    if (this.walk) {
      this.angle += (SPEED / ((LOOP.rx + LOOP.ry) / 2)) * dt;
      const x = this.foot.x + Math.cos(this.angle) * LOOP.rx;
      dx = x - k.x;
      k.setPosition(x, this.foot.y + Math.sin(this.angle) * LOOP.ry);
      this.moving = true;
    } else if (this.target) {
      const vx = this.target.x - k.x;
      const vy = this.target.y - k.y;
      const d = Math.hypot(vx, vy);
      const step = SPEED * dt;
      if (d <= step) {
        k.setPosition(this.target.x, this.target.y);
        this.target = null;
        this.moving = false;
      } else {
        k.setPosition(k.x + (vx / d) * step, k.y + (vy / d) * step);
        dx = vx;
        this.moving = true;
      }
    } else this.moving = false;
    if (Math.abs(dx) > 1e-3) k.setFlipX(dx < 0);
    k.setDepth(DEPTH.entityBase + k.y);
    const anim = this.moving ? 'knight_m_run_anim' : 'knight_m_idle_anim';
    const f = `${anim}_f${Math.floor(this.t * 8) % 4}`;
    if (k.frame.name !== f) k.setFrame(f);
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    this.fx.update(dt);
    this.layer.update(dt);
    this.moveKnight(dt);
    const cam = this.cameras.main;
    // the viewer is the room centre with a radius that covers the far corners
    this.view.update(cam.worldView, this.centre.x, this.centre.y, [], this.t, 0, CONST.FOV_RADIUS + 5);
    this.mask.update(cam.worldView, this.view.view);
    this.sun.update(dt, cam.worldView, this.t);
    this.mood.update(dt, cam.worldView, [], [], []);
    this.pixies.update(this.t, Math.floor(this.t * 60));
    this.silhouette.update(lookOf(this.knight));
  }
}

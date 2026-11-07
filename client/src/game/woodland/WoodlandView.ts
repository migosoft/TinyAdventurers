// WoodlandView (#203): the woodland in the game. The ground is painted once into one texture. Every tree and
// bush is drawn by vegetation.ts into packed canvas pages, a few per frame (never more than DrawQueue's budget,
// nearest to the camera first), and a plant shows as soon as its frame exists. Equal plants (same kind, seed and
// size) share one frame. The own hero shows through the front-most tree canopy it stands behind (Silhouette).
import type Phaser from 'phaser';
import type { PlantInfo } from '../../generated/PlantInfo';
import type { WoodlandInfo } from '../../generated/WoodlandInfo';
import type { TileMap } from '../../sim/map';
import { DEPTH } from '../effects';
import { behindOccluder, heroBox, Silhouette, type BodyLook } from '../silhouette';
import { drawPlant, PLANT_KINDS } from '../vegetation';
import { BASE } from '../covemath';
import { GroundPainter } from './ground';
import { DrawQueue, drawOrder, PlantPages } from './plantpages';

const GROUND_TEX = 'woodland-ground';
const PAGE_TEX = 'woodland-page-';
const PAGE_SIZE = 1024;
/** Milliseconds of drawing per frame, uploads included. */
const BUDGET_MS = 8;
const BUSH = PLANT_KINDS.indexOf('bush');
/** Silhouette lookup grid: 4×4 tiles. */
const BUCKET = 64;
/** The camera moves this far (px) before the waiting plants are sorted again. */
const RESORT = 320;

interface Frame { page: number; name: string; w: number; h: number; foot: { x: number; y: number } }

/** A bucket's map key; bx, by may be -1 (a neighbour off the map's edge) without clashing with a real bucket. */
const bucketKey = (bx: number, by: number) => (by + 1) * 8192 + bx + 1;
const keyOf = (p: PlantInfo) => `${p[0]}:${p[3]}:${p[4]}`;

export class WoodlandView {
  private ground: Phaser.GameObjects.Image;
  private pages = new PlantPages(PAGE_SIZE);
  private canvases: Phaser.Textures.CanvasTexture[] = [];
  private dirty = new Set<number>();
  private frames = new Map<string, Frame>();
  private queue = new DrawQueue(BUDGET_MS);
  /** The ground's row bands, run before any plant. */
  private groundQueue = new DrawQueue(BUDGET_MS);
  /** What the last page upload cost (ms): the next frame's jobs get the budget minus this. */
  private uploadMs = 0;
  private images = new Map<number, Phaser.GameObjects.Image>();
  /** Drawn, waiting for their page to be uploaded. */
  private ready: number[] = [];
  private pending = new Set<number>();
  private sortedAt: { x: number; y: number };
  /** Tree (not bush) indices by 4×4-tile bucket. */
  private buckets = new Map<number, number[]>();
  private silhouette?: Silhouette;

  constructor(private scene: Phaser.Scene, private info: WoodlandInfo, map: TileMap, spawn: { x: number; y: number } = { x: 0, y: 0 }) {
    const painter = new GroundPainter(map, info.seed);
    if (scene.textures.exists(GROUND_TEX)) scene.textures.remove(GROUND_TEX);
    const tex = scene.textures.createCanvas(GROUND_TEX, painter.w, painter.h)!;
    // flat grass until the bands are painted
    const ctx = tex.getContext();
    ctx.fillStyle = `rgb(${BASE[0]},${BASE[1]},${BASE[2]})`;
    ctx.fillRect(0, 0, painter.w, painter.h);
    tex.refresh();
    for (let ty = 0; ty < painter.rows; ty++) this.groundQueue.push(() => painter.band(ty));
    this.groundQueue.push(() => painter.blades());
    this.groundQueue.push(() => painter.flowers());
    this.groundQueue.push(() => {
      ctx.clearRect(0, 0, painter.w, painter.h);
      ctx.putImageData(new ImageData(painter.data as Uint8ClampedArray<ArrayBuffer>, painter.w, painter.h), 0, 0);
      tex.refresh(); // the one upload
    });
    this.ground = scene.add.image(0, 0, GROUND_TEX).setOrigin(0).setDepth(DEPTH.map + 0.5);
    info.plants.forEach((p, i) => {
      this.pending.add(i);
      if (p[0] !== BUSH) {
        const b = this.bucket(p[1], p[2]);
        let l = this.buckets.get(b);
        if (!l) this.buckets.set(b, (l = []));
        l.push(i);
      }
    });
    this.sortedAt = { ...spawn };
    this.enqueue();
  }

  private bucket(x: number, y: number): number {
    return bucketKey(Math.floor(x / BUCKET), Math.floor(y / BUCKET));
  }

  /** Queues every waiting plant, nearest to `sortedAt` first. */
  private enqueue(): void {
    this.queue.clear();
    const idx = [...this.pending];
    const order = drawOrder(idx.map((i) => this.info.plants[i]), this.sortedAt);
    for (const o of order) this.queue.push(() => this.drawOne(idx[o]));
  }

  private drawOne(i: number): void {
    const p = this.info.plants[i];
    const key = keyOf(p);
    if (!this.frames.has(key)) {
      const { img, foot } = drawPlant(PLANT_KINDS[p[0]], p[3], p[4]);
      const slot = this.pages.add(key, img);
      let tex = this.canvases[slot.page];
      if (!tex) {
        const name = PAGE_TEX + slot.page;
        if (this.scene.textures.exists(name)) this.scene.textures.remove(name);
        tex = this.canvases[slot.page] = this.scene.textures.createCanvas(name, PAGE_SIZE, PAGE_SIZE)!;
      }
      tex.getContext().putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.w, img.h), slot.x, slot.y);
      tex.add(key, 0, slot.x, slot.y, img.w, img.h);
      this.dirty.add(slot.page);
      this.frames.set(key, { page: slot.page, name: key, w: img.w, h: img.h, foot });
    }
    this.pending.delete(i);
    this.ready.push(i);
  }

  /** The plant's image with its origin at the foot (mirrored plants have the foot at the other side of the frame). */
  private show(i: number): void {
    const p = this.info.plants[i];
    const f = this.frames.get(keyOf(p))!;
    const ox = (p[5] ? f.w - f.foot.x : f.foot.x) / f.w;
    this.images.set(i, this.scene.add.image(p[1], p[2], PAGE_TEX + f.page, f.name)
      .setOrigin(ox, f.foot.y / f.h).setFlipX(p[5]).setDepth(DEPTH.entityBase + p[2]));
  }

  /** `hero`: the own hero's body while it plays, else null. `cam`: the camera's world view. */
  update(_t: number, hero: BodyLook | null, cam: Phaser.Geom.Rectangle): void {
    const c = { x: cam.centerX, y: cam.centerY };
    if (this.queue.size > 0 && Math.hypot(c.x - this.sortedAt.x, c.y - this.sortedAt.y) > RESORT) {
      this.sortedAt = c;
      this.enqueue();
    }
    const left = Math.max(0, BUDGET_MS - this.uploadMs);
    if (this.groundQueue.size > 0) this.groundQueue.run(left);
    else this.queue.run(left);
    if (this.dirty.size > 0) {
      const t0 = performance.now();
      for (const page of this.dirty) this.canvases[page].refresh(); // one upload per page and frame
      this.dirty.clear();
      this.uploadMs = performance.now() - t0;
    } else this.uploadMs = 0;
    for (const i of this.ready) this.show(i);
    this.ready.length = 0;
    this.shade(hero);
  }

  /** The front-most drawn tree whose canopy the hero stands behind, looking at the trees of the buckets around it. */
  private occluder(hero: BodyLook): { img: Phaser.GameObjects.Image; footY: number } | null {
    const hb = heroBox(hero.bounds, hero.footY);
    const bx = Math.floor((hb.left + hb.right) / 2 / BUCKET), by = Math.floor(hb.footY / BUCKET);
    let best: { img: Phaser.GameObjects.Image; footY: number } | null = null;
    // a canopy reaches up to ~8 tiles above its foot and ~4 to each side, so trees stand in the hero's bucket and the ones south and beside it
    for (let dy = 0; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const i of this.buckets.get(bucketKey(bx + dx, by + dy)) ?? []) {
        const img = this.images.get(i);
        if (!img) continue;
        const p = this.info.plants[i];
        const f = this.frames.get(keyOf(p))!;
        const left = p[1] - img.originX * f.w;
        if (!behindOccluder(hb, { left, right: left + f.w, top: p[2] - f.foot.y, footY: p[2] }) ) continue;
        if (!best || p[2] > best.footY) best = { img, footY: p[2] };
      }
    }
    return best;
  }

  private shade(hero: BodyLook | null): void {
    const occ = hero ? this.occluder(hero) : null;
    if (occ) {
      if (!this.silhouette) this.silhouette = new Silhouette(this.scene, occ.img, occ.footY);
      else this.silhouette.retarget(occ.img, occ.footY);
    }
    this.silhouette?.update(occ ? hero : null);
  }

  destroy(): void {
    this.silhouette?.destroy();
    for (const img of this.images.values()) img.destroy();
    this.images.clear();
    this.ground.destroy();
    if (this.scene.textures.exists(GROUND_TEX)) this.scene.textures.remove(GROUND_TEX);
    this.canvases.forEach((_, n) => { if (this.scene.textures.exists(PAGE_TEX + n)) this.scene.textures.remove(PAGE_TEX + n); });
    this.canvases = [];
  }
}

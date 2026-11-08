// WoodlandView (#203): the woodland in the game. The ground is painted in row bands and uploaded
// as 64 px strips (the painter is dropped once all are up). Every tree and bush is drawn by vegetation.ts into packed canvas pages, a few per frame (never more than DrawQueue's budget,
// nearest to the camera first), and a plant shows as soon as its frame exists. Equal plants (same kind, seed and
// size) share one frame. The own hero shows through every tree canopy it stands behind (one Silhouette copy per tree).
import type Phaser from 'phaser';
import type { PlantInfo } from '../../generated/PlantInfo';
import type { WoodlandInfo } from '../../generated/WoodlandInfo';
import { TILE, type TileMap } from '../../sim/map';
import type { VisionMask } from '../visionmask';
import { DEPTH } from '../effects';
import { heroBox, occludersOf, Silhouette, type BodyLook, type Box } from '../silhouette';
import { drawPlant, lightVector, PLANT_KINDS, type Drawn, type Light } from '../vegetation';
import { BASE } from '../covemath';
import { Clouds } from './clouds';
import { Critters } from './critters';
import { flowerSpots, GROUND_TILES, GroundPainter } from './ground';
import { DrawQueue, drawOrder, PlantPages } from './plantpages';
import { bandOrder, PendingGrid, plantTile, sceneSettled } from './settle';
import { ShadowLayer } from './shadowlayer';
import { shadowOf, shadowVector, type ShadowVec } from './shadows';

const GROUND_TEX = 'woodland-ground-';
/** The ground goes up in strips of this many px of height (~0.5 MB each), one strip per frame. */
const STRIP = 64;
const PAGE_TEX = 'woodland-page-';
const PAGE_SIZE = 1024;
/** Milliseconds of drawing per frame, uploads included. */
const BUDGET_MS = 8;
const BUSH = PLANT_KINDS.indexOf('bush');
/** Silhouette lookup grid: 4×4 tiles. */
const BUCKET = 64;
/** The camera moves this far (px) before the waiting plants are sorted again. */
const RESORT = 320;
/** The scenery counts as settled when it is complete this far (px) beyond the camera window. */
const SETTLE_MARGIN = 2 * TILE;

/** A drawn tree as a silhouette occluder: its image and its box (world px). */
interface Occluder extends Box { img: Phaser.GameObjects.Image }

interface Frame { page: number; name: string; w: number; h: number; foot: { x: number; y: number } }

/** The camera window plus the settle margin. */
const windowAround = (cam: Phaser.Geom.Rectangle) => ({ x0: cam.x - SETTLE_MARGIN, y0: cam.y - SETTLE_MARGIN, x1: cam.right + SETTLE_MARGIN, y1: cam.bottom + SETTLE_MARGIN });

/** A bucket's map key; bx, by may be -1 (a neighbour off the map's edge) without clashing with a real bucket. */
const bucketKey = (bx: number, by: number) => (by + 1) * 8192 + bx + 1;
const keyOf = (p: PlantInfo) => `${p[0]}:${p[3]}:${p[4]}`;
/** The shadow frame of a plant frame (the shadow is never flipped, so it differs per mirroring). */
const shadowKey = (key: string, mirrored: boolean) => `shadow:${key}${mirrored ? 'm' : ''}`;

export class WoodlandView {
  /** Undefined once every strip is up: its ~6.6 MB of pixels are released. */
  private painter?: GroundPainter;
  private groundH: number;
  private placeholders: Phaser.GameObjects.Graphics[] = [];
  /** Uploaded ground strips by index (holes: not uploaded yet; strips go up nearest to the camera first). */
  private strips: Phaser.GameObjects.Image[] = [];
  private stripsUp = 0;
  private nStrips: number;
  private pendingGrid = new PendingGrid(BUCKET);
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
  /** Plants shown so far (the seen-plant painter's version; it also changes when the plants are cleared). */
  private shown = 0;
  /** The image box (world px) and frame key of each shown plant, for the seen-plant painter's cull. */
  private boxes = new Map<number, { key: string; left: number; top: number; w: number; h: number }>();
  /** White silhouettes by plant frame key. */
  private silhouetteCache = new Map<string, HTMLCanvasElement>();
  /** Drawn, waiting for their page to be uploaded. */
  private ready: number[] = [];
  private pending = new Set<number>();
  private sortedAt: { x: number; y: number };
  /** Tree (not bush) indices by 4×4-tile bucket. */
  private buckets = new Map<number, number[]>();
  /** Silhouette copies, one per tree the hero stands behind; reused, never more than MAX_OCCLUDERS. */
  private silhouettes: Silhouette[] = [];
  /** Drifting cloud shadows; `clouds.look` is tuned live. */
  readonly clouds: Clouds;
  readonly critters: Critters;
  /** The demo's silhouette switch. */
  silhouetteOn = true;
  private startMs = performance.now();
  private groundDoneMs = 0;
  private logged = false;
  /** True while the ground under the camera window (+ 2 tiles) is uploaded and no plant there waits to be drawn, and always once everything is drawn. The soft shade of the trunks waits for it (it hides again if the camera runs ahead of the drawing). */
  settled = false;
  private done = false;
  private mapW: number;
  private light: Light;
  private vec: ShadowVec;
  /** The ground shadows of all plants, stamped once each. */
  readonly shadows: ShadowLayer;
  /** Shadow frames by shadowKey (plant frame key + mirrored). */
  private shadowFrames = new Map<string, { page: number; name: string; foot: { x: number; y: number } }>();

  /** `log`: print the plant-draw timing to the console once (the ?woodland demo). */
  constructor(private scene: Phaser.Scene, private info: WoodlandInfo, map: TileMap, spawn: { x: number; y: number } = { x: 0, y: 0 }, private log = false) {
    const painter = this.painter = new GroundPainter(map, info.seed);
    this.groundH = painter.h;
    // flat grass over the ground tiles until a strip's real ground is uploaded
    const nStrips = this.nStrips = Math.ceil(painter.h / STRIP);
    for (let n = 0; n < nStrips; n++) {
      const g = scene.add.graphics().setDepth(DEPTH.map + 0.5).fillStyle((BASE[0] << 16) | (BASE[1] << 8) | BASE[2], 1);
      const ty0 = (n * STRIP) / TILE, ty1 = Math.min(map.h, ty0 + STRIP / TILE);
      for (let ty = ty0; ty < ty1; ty++) for (let tx = 0; tx < map.w; tx++) {
        if (!GROUND_TILES.has(map.get(tx, ty))) continue;
        let end = tx;
        while (end + 1 < map.w && GROUND_TILES.has(map.get(end + 1, ty))) end++;
        g.fillRect(tx * TILE, ty * TILE, (end - tx + 1) * TILE, TILE);
        tx = end;
      }
      this.placeholders.push(g);
    }
    // ordering only: the strips wait for the blades and flowers, so the order shows once the ground is whole (the last bands are then the far ones)
    for (const ty of bandOrder(painter.rows, spawn.y / TILE)) this.groundQueue.push(() => painter.band(ty));
    this.groundQueue.push(() => painter.blades());
    this.groundQueue.push(() => painter.flowers());
    info.plants.forEach((p, i) => {
      this.pending.add(i);
      this.pendingGrid.add(p[1], p[2]);
      if (p[0] !== BUSH) {
        const b = this.bucket(p[1], p[2]);
        let l = this.buckets.get(b);
        if (!l) this.buckets.set(b, (l = []));
        l.push(i);
      }
    });
    this.sortedAt = { ...spawn };
    this.mapW = map.w;
    this.light = lightVector(info.sun);
    this.vec = shadowVector(info.sun);
    this.shadows = new ShadowLayer(scene, { w: map.w * TILE, h: map.h * TILE });
    this.clouds = new Clouds(scene);
    this.critters = new Critters(scene, flowerSpots(map, info.seed), info.seed, map);
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
    const sKey = shadowKey(key, p[5]);
    const needFrame = !this.frames.has(key), needShadow = !this.shadowFrames.has(sKey);
    if (needFrame || needShadow) {
      // the raster is not kept: a shadow variant that turns up later (a mirrored plant of a known frame) redraws it, which is deterministic for the same key and light
      const { img, foot } = drawPlant(PLANT_KINDS[p[0]], p[3], p[4], this.light);
      if (needFrame) {
        const slot = this.pack(key, img);
        this.frames.set(key, { page: slot.page, name: key, w: img.w, h: img.h, foot });
      }
      // only the variant this plant is stamped with (a mirrored and an unmirrored plant share the plant frame, not the shadow)
      if (needShadow) {
        const sh = shadowOf(img, foot, this.vec, p[5]);
        const s = this.pack(sKey, sh.img);
        this.shadowFrames.set(sKey, { page: s.page, name: sKey, foot: sh.foot });
      }
    }
    this.pending.delete(i);
    this.pendingGrid.remove(this.info.plants[i][1], this.info.plants[i][2]);
    this.ready.push(i);
  }

  /** Packs an image into the pages, draws it onto its page canvas (made on demand), registers its frame and marks the page for upload. */
  private pack(key: string, img: Drawn['img']): { page: number; x: number; y: number } {
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
    return slot;
  }

  /** The plant's image with its origin at the foot (mirrored plants have the foot at the other side of the frame). Runs after the page upload of the frame it was drawn in, so its shadow is stamped from pixels already on the GPU. */
  private show(i: number): void {
    const p = this.info.plants[i];
    const f = this.frames.get(keyOf(p))!;
    const sh = this.shadowFrames.get(shadowKey(keyOf(p), p[5]))!;
    this.shadows.stamp(PAGE_TEX + sh.page, sh.name, p[1] - sh.foot.x, p[2] - sh.foot.y);
    const ox = (p[5] ? f.w - f.foot.x : f.foot.x) / f.w;
    this.images.set(i, this.scene.add.image(p[1], p[2], PAGE_TEX + f.page, f.name)
      .setOrigin(ox, f.foot.y / f.h).setFlipX(p[5]).setDepth(DEPTH.entityBase + p[2]));
    this.boxes.set(i, { key: keyOf(p), left: p[1] - (p[5] ? f.w - f.foot.x : f.foot.x), top: p[2] - f.foot.y, w: f.w, h: f.h });
    this.shown++;
  }

  /** White-on-transparent copy of a plant frame, made once from its page region. */
  private silhouetteOf(key: string): HTMLCanvasElement {
    let c = this.silhouetteCache.get(key);
    if (c) return c;
    const f = this.frames.get(key)!;
    c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const g = c.getContext('2d')!;
    const fr = this.canvases[f.page].get(f.name);
    g.drawImage(this.canvases[f.page].getSourceImage() as CanvasImageSource, fr.cutX, fr.cutY, f.w, f.h, 0, 0, f.w, f.h);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, f.w, f.h);
    this.silhouetteCache.set(key, c);
    return c;
  }

  /**
   * For the vision mask's haze (#278): the haze works in ground coordinates, so a tree's picture (drawn upward
   * from its foot) would be hazed wherever it reaches over hazed ground. Painting each shown plant whose foot
   * tile the hero sees in white (unhazed) keeps a seen tree clear. `version` changes when a plant is shown or the plants are cleared.
   */
  get seenPainter(): NonNullable<VisionMask['seen']> {
    return this.seenPaint;
  }

  private readonly seenPaint: NonNullable<VisionMask['seen']> = {
    version: () => this.shown,
    paint: (ctx, ox, oy, s, full) => {
      const x0 = ox * TILE, y0 = oy * TILE, x1 = x0 + ctx.canvas.width / s, y1 = y0 + ctx.canvas.height / s;
      for (const [i, img] of this.images) {
        const b = this.boxes.get(i)!;
        if (b.left >= x1 || b.left + b.w <= x0 || b.top >= y1 || b.top + b.h <= y0) continue;
        const p = this.info.plants[i];
        const { tx, ty } = plantTile(p[1], p[2], TILE);
        if (!img.visible || !full.isVisible(tx, ty)) continue;
        const { left, top } = b;
        const f = this.frames.get(b.key)!;
        const key = b.key;
        ctx.save();
        ctx.translate((left - x0) * s, (top - y0) * s);
        ctx.scale(s, s);
        if (p[5]) {
          ctx.translate(f.w, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(this.silhouetteOf(key), 0, 0);
        ctx.restore();
      }
    },
  };

  /** The not-yet-uploaded strip of ground nearest to the camera as its own small texture (at most one per frame), replacing its flat placeholder. */
  private uploadStrip(camY: number): void {
    if (this.stripsUp >= this.nStrips) return;
    const p = this.painter;
    if (!p) return;
    let n = -1, best = Infinity;
    for (let i = 0; i < this.nStrips; i++) {
      if (this.strips[i]) continue;
      const d = Math.abs(i * STRIP + STRIP / 2 - camY);
      if (d < best) { best = d; n = i; }
    }
    const y0 = n * STRIP, h = Math.min(STRIP, p.h - y0);
    const name = GROUND_TEX + n;
    if (this.scene.textures.exists(name)) this.scene.textures.remove(name);
    const tex = this.scene.textures.createCanvas(name, p.w, h)!;
    tex.getContext().putImageData(new ImageData(p.data.subarray(y0 * p.w * 4, (y0 + h) * p.w * 4) as Uint8ClampedArray<ArrayBuffer>, p.w, h), 0, 0);
    tex.refresh();
    this.strips[n] = this.scene.add.image(0, y0, name).setOrigin(0).setDepth(DEPTH.map + 0.5);
    this.stripsUp++;
    this.placeholders[n].destroy();
    if (this.stripsUp >= this.nStrips) this.painter = undefined;
  }

  /** `hero`: the own hero's body while it plays, else null. `cam`: the camera's world view. */
  update(t: number, hero: BodyLook | null, cam: Phaser.Geom.Rectangle, seenLit: Uint8Array): void {
    const c = { x: cam.centerX, y: cam.centerY };
    if (this.queue.size > 0 && Math.hypot(c.x - this.sortedAt.x, c.y - this.sortedAt.y) > RESORT) {
      this.sortedAt = c;
      this.enqueue();
    }
    const left = Math.max(0, BUDGET_MS - this.uploadMs);
    if (this.groundQueue.size > 0) this.groundQueue.run(left);
    else this.queue.run(left);
    const t0 = performance.now();
    for (const page of this.dirty) this.canvases[page].refresh(); // one upload per page and frame
    this.dirty.clear();
    if (this.groundQueue.size === 0) this.uploadStrip(c.y);
    this.uploadMs = performance.now() - t0;
    for (const i of this.ready) this.show(i);
    this.ready.length = 0;
    if (!this.groundDoneMs && this.groundQueue.size === 0) this.groundDoneMs = performance.now();
    if (!this.done && this.groundQueue.size === 0 && this.pending.size === 0 && this.stripsUp === this.nStrips) this.done = true;
    this.settled = sceneSettled(this.done, this.groundQueue.size === 0, windowAround(cam), STRIP, (n) => !!this.strips[n], this.groundH, this.pendingGrid);
    if (!this.logged && this.groundQueue.size === 0 && this.pending.size === 0) {
      this.logged = true;
      if (this.log) console.log(`woodland: ${this.info.plants.length} plants drawn (${this.frames.size} frames, ${this.pages.pages} pages) in ${Math.round(performance.now() - this.groundDoneMs)} ms after the ground (${Math.round(performance.now() - this.startMs)} ms in all)`);
    }
    this.shade(hero);
    this.clouds.update(t, cam);
    this.critters.update(t, seenLit, this.mapW, cam);
  }

  /** Every drawn tree whose canopy the hero stands behind, front-most first (at most MAX_OCCLUDERS), looking at the trees of the buckets around it. */
  private occluders(hero: BodyLook): Occluder[] {
    const hb = heroBox(hero.bounds, hero.footY);
    const bx = Math.floor((hb.left + hb.right) / 2 / BUCKET), by = Math.floor(hb.footY / BUCKET);
    const trees: Occluder[] = [];
    // a canopy reaches up to ~8 tiles above its foot and ~4 to each side, so trees stand in the hero's bucket and the ones south and beside it
    for (let dy = 0; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const i of this.buckets.get(bucketKey(bx + dx, by + dy)) ?? []) {
        const img = this.images.get(i);
        if (!img) continue;
        const p = this.info.plants[i];
        const f = this.frames.get(keyOf(p))!;
        const left = p[1] - img.originX * f.w;
        trees.push({ img, left, right: left + f.w, top: p[2] - f.foot.y, footY: p[2] });
      }
    }
    return occludersOf(hb, trees);
  }

  /** One silhouette copy per tree over the hero, each masked by its own tree (#262); the copies are pooled. */
  private shade(hero: BodyLook | null): void {
    const occ = hero ? this.occluders(hero) : [];
    occ.forEach((o, n) => {
      if (!this.silhouettes[n]) this.silhouettes[n] = new Silhouette(this.scene, o.img, o.footY);
      else this.silhouettes[n].retarget(o.img, o.footY);
    });
    this.silhouettes.forEach((s, n) => {
      s.on = this.silhouetteOn;
      s.update(n < occ.length ? hero : null);
    });
  }

  destroy(): void {
    this.shadows.destroy();
    this.clouds.destroy();
    this.critters.destroy();
    for (const s of this.silhouettes) s.destroy();
    this.silhouettes = [];
    for (const img of this.images.values()) img.destroy();
    this.images.clear();
    this.boxes.clear();
    this.shown++;
    this.silhouetteCache.clear();
    for (const g of this.placeholders) g.destroy();
    this.strips.forEach((img, n) => { img.destroy(); if (this.scene.textures.exists(GROUND_TEX + n)) this.scene.textures.remove(GROUND_TEX + n); });
    this.canvases.forEach((_, n) => { if (this.scene.textures.exists(PAGE_TEX + n)) this.scene.textures.remove(PAGE_TEX + n); });
    this.canvases = [];
  }
}

// The woodland's plants for the 3D view (#306), on the CPU: each distinct plant is drawn once (game/vegetation.ts) into a page image,
// and the card, trunk-caster and clump geometry of the plants is gathered per world chunk. No three.js: the view uploads what a frame holds.
import type { PlantInfo } from '../generated/PlantInfo';
import { DrawQueue, PlantPages, drawOrder } from '../game/woodland/plantpages';
import { PLANT_KINDS, drawPlant, type Light } from '../game/vegetation';
import { newClumpBuf, newPlantBuf, plantChunks, pushClumps, pushPlant, pushTrunkCaster, type ClumpBuf, type PlantBuf, type PlantPlace, type PlantSprite } from './plants';
import { swayAmp } from './wind';

/** A page of drawn plants: `size` x `size` RGBA px; `version` grows when an image was drawn into it. */
export interface PageImage { size: number; data: Uint8ClampedArray; version: number }
/** The geometry of one world chunk's plants that read one page (-1: the atlas). */
export interface PlantChunk { page: number; cards: PlantBuf; trunks: PlantBuf; clumps: ClumpBuf }
export interface PlantFrame {
  pages: readonly PageImage[];
  /** Chunk index (cz * nx + cx) to its geometry, one entry per page the chunk's plants use. */
  chunks: ReadonlyMap<number, PlantChunk[]>;
  /** Chunk index to a number that grows when a plant was added to it. */
  versions: ReadonlyMap<number, number>;
  wind: boolean;
  t: number;
}

/** Milliseconds of plant drawing per frame (first guess). */
export const PLANT_BUDGET_MS = 3;
/** Tiles the camera may move before the drawing order is sorted again. */
const RESORT = 4;
const TILE = 16;

export class PlantField {
  private readonly pagesOut: PageImage[] = [];
  private readonly packer: PlantPages;
  private readonly sprites = new Map<string, PlantSprite>();
  private readonly chunkMap = new Map<number, PlantChunk[]>();
  private readonly versionMap = new Map<number, number>();
  private readonly chunkOf: number[] = [];
  private readonly pending = new Set<number>();
  private readonly queue = new DrawQueue();
  private sortedAt: { x: number; z: number } | null = null;
  private count = 0;
  private done = 0;

  constructor(private readonly plants: readonly PlantInfo[], map: { w: number; h: number }, private readonly light: Light, private readonly pageSize = 1024) {
    this.packer = new PlantPages(pageSize);
    const feet = plants.map((p) => ({ x: p[1] / TILE, z: p[2] / TILE }));
    for (const [chunk, list] of plantChunks(feet, map)) for (const i of list) this.chunkOf[i] = chunk;
    plants.forEach((_, i) => this.pending.add(i));
    this.count = plants.length;
  }

  get drawn(): number { return this.done; }
  get total(): number { return this.count; }

  /** Draws plants within `budgetMs` (nearest to `cam` first, sorted again after the camera moved 4 tiles); the chunks that got a plant are rebuilt. Returns how many were drawn. */
  step(cam: { x: number; z: number }, budgetMs: number): number {
    if (this.pending.size === 0) return 0;
    const s = this.sortedAt;
    if (!s || Math.hypot(cam.x - s.x, cam.z - s.z) >= RESORT) {
      this.sortedAt = { x: cam.x, z: cam.z };
      this.queue.clear();
      const idx = [...this.pending];
      for (const o of drawOrder(idx.map((i) => this.plants[i]), { x: cam.x * TILE, y: cam.z * TILE })) this.queue.push(() => this.drawOne(idx[o]));
    }
    return this.queue.run(budgetMs);
  }

  frame(wind: boolean, t: number): PlantFrame {
    return { pages: this.pagesOut, chunks: this.chunkMap, versions: this.versionMap, wind, t };
  }

  /** A field of atlas frames (page -1), all ready at once: no pages, no drawing (the cove's plants). */
  static fromAtlas(items: readonly { place: PlantPlace; sprite: PlantSprite }[], map: { w: number; h: number }): PlantField {
    const f = new PlantField([], map, { x: 0, y: -1 });
    const feet = items.map((it) => ({ x: it.place.x, z: it.place.z }));
    for (const [chunk, list] of plantChunks(feet, map)) for (const i of list) f.put(chunk, items[i].place, items[i].sprite);
    f.count = f.done = items.length;
    return f;
  }

  private drawOne(i: number): void {
    const p = this.plants[i];
    const kind = PLANT_KINDS[p[0]];
    const key = `${kind}:${p[3]}:${p[4]}`;
    let sprite = this.sprites.get(key);
    if (!sprite) {
      const { img, foot, shape } = drawPlant(kind, p[3], p[4], this.light);
      const slot = this.packer.add(key, img);
      while (this.pagesOut.length <= slot.page) this.pagesOut.push({ size: this.pageSize, data: new Uint8ClampedArray(this.pageSize * this.pageSize * 4), version: 0 });
      const page = this.pagesOut[slot.page];
      for (let y = 0; y < img.h; y++) page.data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((slot.y + y) * this.pageSize + slot.x) * 4);
      page.version++;
      sprite = { page: slot.page, rect: { x: slot.x, y: slot.y, w: img.w, h: img.h }, foot, shape: shape ?? null };
      this.sprites.set(key, sprite);
    }
    this.pending.delete(i);
    this.done++;
    this.put(this.chunkOf[i], { x: p[1] / TILE, z: p[2] / TILE, mirrored: p[5], amp: swayAmp(kind), seed: p[3] }, sprite);
  }

  /** Adds a drawn plant to its chunk's geometry for its page and bumps the chunk's version. */
  private put(chunk: number, place: PlantPlace, sprite: PlantSprite): void {
    let list = this.chunkMap.get(chunk);
    if (!list) this.chunkMap.set(chunk, (list = []));
    let c = list.find((e) => e.page === sprite.page);
    if (!c) list.push((c = { page: sprite.page, cards: newPlantBuf(), trunks: newPlantBuf(), clumps: newClumpBuf() }));
    pushPlant(c.cards, place, sprite);
    pushTrunkCaster(c.trunks, place, sprite);
    pushClumps(c.clumps, place, sprite);
    this.versionMap.set(chunk, (this.versionMap.get(chunk) ?? 0) + 1);
  }
}

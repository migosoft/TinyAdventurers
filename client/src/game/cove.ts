// CoveView (#202): the nymph's cove in the game. The look is the ?cove demo's (CoveDemoScene): a grass carpet with
// flowers, the big tree, bushes / tufts / ferns, pixies around the canopy, and a pale silhouette of the own hero
// when it stands behind the tree. The room's floor is `CoveInfo` in tiles; everything here is in world px.
import type Phaser from 'phaser';
import type { CoveInfo } from '../generated/CoveInfo';
import { TILE } from '../sim/map';
import { COVE_TREE_FOOT, type CoveSpec, paintCove, placeCovePlants } from './covemath';
import { DEPTH } from './effects';
import { Pixies } from './pixies';
import { Silhouette, type BodyLook } from './silhouette';

/** paintCove's margin around the floor area (px). */
const MARGIN = 32;
const TREE_W = 96;
const TREE_H = 100;
const GRASS_TEX = 'cove-grass';
/** Pixie centre: the canopy middle, above the trunk foot (px). */
const CANOPY_UP = 50;

/** The floor rect's top-left and the trunk foot in world px, and the covemath spec (tree relative to the floor). */
export function coveLayout(c: CoveInfo): { spec: CoveSpec; origin: { x: number; y: number }; foot: { x: number; y: number } } {
  const origin = { x: c.x * TILE, y: c.y * TILE };
  const foot = { x: c.tree_x * TILE + TILE / 2, y: c.tree_y * TILE + TILE };
  return { spec: { w: c.w * TILE, h: c.h * TILE, tree: { x: foot.x - origin.x, y: foot.y - origin.y }, seed: c.seed }, origin, foot };
}

export class CoveView {
  private grass: Phaser.GameObjects.Image;
  private tree: Phaser.GameObjects.Image;
  private plants: Phaser.GameObjects.Image[] = [];
  private pixies: Pixies;
  private silhouette: Silhouette;

  constructor(private scene: Phaser.Scene, c: CoveInfo) {
    const { spec, origin, foot } = coveLayout(c);
    const art = paintCove(spec);
    if (scene.textures.exists(GRASS_TEX)) scene.textures.remove(GRASS_TEX);
    const tex = scene.textures.createCanvas(GRASS_TEX, art.w, art.h)!;
    tex.getContext().putImageData(new ImageData(new Uint8ClampedArray(art.data), art.w, art.h), 0, 0);
    tex.refresh();
    this.grass = scene.add.image(origin.x - MARGIN, origin.y - MARGIN, GRASS_TEX).setOrigin(0).setDepth(DEPTH.decal);
    this.tree = scene.add.image(foot.x, foot.y, 'atlas', 'cove_tree')
      .setOrigin(COVE_TREE_FOOT.x / TREE_W, COVE_TREE_FOOT.y / TREE_H).setDepth(DEPTH.entityBase + foot.y);
    this.plants = placeCovePlants(spec).map((p) => {
      const y = origin.y + p.y;
      return scene.add.image(origin.x + p.x, y, 'atlas', p.frame).setOrigin(0.5, 1).setDepth(DEPTH.entityBase + y);
    });
    this.pixies = new Pixies(scene, { x: foot.x, y: foot.y - CANOPY_UP }, 7, c.seed);
    this.pixies.update(0, 0);
    this.silhouette = new Silhouette(scene, this.tree, foot.y);
  }

  /** `hero`: the own hero's body while it plays, else null. */
  update(t: number, hero: BodyLook | null): void {
    this.pixies.update(t, Math.floor(t * 60));
    this.silhouette.update(hero);
  }

  destroy(): void {
    this.silhouette.destroy();
    this.pixies.destroy();
    for (const p of this.plants) p.destroy();
    this.tree.destroy();
    this.grass.destroy();
    if (this.scene.textures.exists(GRASS_TEX)) this.scene.textures.remove(GRASS_TEX);
  }
}

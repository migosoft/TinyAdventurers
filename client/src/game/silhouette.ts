// Silhouette (#202): while the own hero stands behind an occluder (the cove's big tree), a pale copy of the
// hero's body sprite shows through it. The copy is drawn just above the occluder and cut to the occluder's
// shape with a BitmapMask, so it appears only where the tree covers the hero and never doubles the visible
// part. No weapon; teammates and enemies get none. Without WebGL (no BitmapMask) there is no silhouette.
import type Phaser from 'phaser';

/** The body sprite as the silhouette copies it, all in world px (a figure's sprite sits inside scaled containers). */
export interface BodyLook {
  key: string; frame: string;
  /** Position and origin of the sprite (where the copy is drawn). */
  x: number; y: number;
  /** The depth-sort foot (the figure root's y, depth = entityBase + footY), which can differ from y by a few px. */
  footY: number;
  originX: number; originY: number;
  /** Includes the scale of the containers the sprite sits in. */
  scaleX: number; scaleY: number; flipX: boolean;
  bounds: { left: number; right: number; top: number };
}

/** A sprite directly on the scene root (the ?cove demo): its own getBounds() are world coordinates. */
export function lookOf(s: Phaser.GameObjects.Sprite): BodyLook {
  const b = s.getBounds();
  return {
    key: s.texture.key, frame: s.frame.name, x: s.x, y: s.y, footY: s.y, originX: s.originX, originY: s.originY,
    scaleX: s.scaleX, scaleY: s.scaleY, flipX: s.flipX, bounds: { left: b.left, right: b.right, top: b.top },
  };
}

/** The slice of a sprite that bodyLookFrom reads (so it can be tested without Phaser). */
export interface BodyParts {
  x: number; y: number; originX: number; originY: number; scaleX: number; scaleY: number; flipX: boolean;
  width: number; height: number; texture: { key: string }; frame: { name: string };
}

/**
 * A figure's body sprite in world space: it sits at (body.x, body.y) in a figure container (position fx/fy,
 * scale fsx/fsy) which sits in a root container at (rootX, rootY). Rotation is ignored (the body is upright
 * while standing). Bounds follow the origin, which EntityView already mirrors when facing left.
 */
export function bodyLookFrom(
  root: { x: number; y: number },
  figure: { x: number; y: number; scaleX: number; scaleY: number },
  body: BodyParts,
): BodyLook {
  const scaleX = figure.scaleX * body.scaleX;
  const scaleY = figure.scaleY * body.scaleY;
  const x = root.x + figure.x + body.x * figure.scaleX;
  const y = root.y + figure.y + body.y * figure.scaleY;
  const w = body.width * Math.abs(scaleX);
  const h = body.height * Math.abs(scaleY);
  const left = x - body.originX * w;
  return {
    key: body.texture.key, frame: body.frame.name, x, y, footY: root.y, originX: body.originX, originY: body.originY,
    scaleX, scaleY, flipX: body.flipX,
    bounds: { left, right: left + w, top: y - body.originY * h },
  };
}

export interface Box { left: number; right: number; top: number; footY: number }

const FILL = 0xcae6f5;
const ALPHA = 0.4;
/** Phaser.WEBGL (the enum is not imported at runtime here). */
const WEBGL = 2;

/** True when the hero is north of the occluder's foot (so the occluder is drawn over it) and the boxes overlap. */
export function behindOccluder(hero: Box, occ: Box): boolean {
  if (hero.footY >= occ.footY) return false;
  return hero.left < occ.right && hero.right > occ.left && hero.footY > occ.top && hero.top < occ.footY;
}

/** At most this many occluders get a silhouette copy at once (#262). */
export const MAX_OCCLUDERS = 4;

/**
 * Every occluder the hero stands behind, front-most (largest foot y) first, at most `max` (#262). Each gets its own
 * copy masked by its own shape: when trees overlap, the one whose box holds the hero may not cover it with its
 * pixels while the one behind does, so picking a single tree can show nothing.
 */
export function occludersOf<T extends Box>(hero: Box, candidates: Iterable<T>, max = MAX_OCCLUDERS): T[] {
  const out: T[] = [];
  for (const c of candidates) if (behindOccluder(hero, c)) out.push(c);
  return out.sort((a, b) => b.footY - a.footY).slice(0, max);
}

/**
 * The hero box for behindOccluder: left/right/top from the sprite's bounds, but footY is the given foot, the
 * same quantity depth sorting uses (depth = entityBase + y; BodyLook.footY). bounds.bottom would be wrong for untrimmed frames (the knight's is 14 px below y).
 */
export function heroBox(b: { left: number; right: number; top: number }, y: number): Box {
  return { left: b.left, right: b.right, top: b.top, footY: y };
}

export class Silhouette {
  /** Hidden and not updated while false. */
  on = true;
  private copy: Phaser.GameObjects.Image;
  private mask?: Phaser.Display.Masks.BitmapMask;

  constructor(scene: Phaser.Scene, private occluder: Phaser.GameObjects.Image, private occluderFootY: number) {
    this.copy = scene.add.image(0, 0, '__DEFAULT').setVisible(false).setAlpha(ALPHA).setTintFill(FILL).setDepth(occluder.depth + 0.01);
    if (scene.sys.renderer.type === WEBGL) {
      this.mask = occluder.createBitmapMask();
      this.copy.setMask(this.mask);
    }
  }

  /** Aims the copy at another occluder (and its foot y): the mask follows it. */
  retarget(occluder: Phaser.GameObjects.Image, footY: number): void {
    this.occluder = occluder;
    this.occluderFootY = footY;
    if (this.mask) this.mask.bitmapMask = occluder;
  }

  update(hero: BodyLook | null): void {
    const c = this.copy;
    if (!this.on || !hero || !this.mask) { c.setVisible(false); return; }
    // world-px boxes: the hero's from its BodyLook, the occluder's from getBounds() (origin, scale and flip folded in)
    const ob = this.occluder.getBounds();
    const behind = behindOccluder(
      heroBox(hero.bounds, hero.footY),
      { left: ob.left, right: ob.right, top: ob.top, footY: this.occluderFootY },
    );
    if (!behind) { c.setVisible(false); return; }
    // same frame, flipX (else mirrored), origin (else shifted), position and scale as the hero
    c.setTexture(hero.key, hero.frame).setPosition(hero.x, hero.y).setOrigin(hero.originX, hero.originY)
      .setScale(hero.scaleX, hero.scaleY).setFlipX(hero.flipX).setDepth(this.occluder.depth + 0.01).setVisible(true);
  }

  destroy(): void {
    this.copy.clearMask();
    this.copy.destroy();
    this.mask?.destroy();
  }
}

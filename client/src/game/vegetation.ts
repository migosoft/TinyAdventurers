// Vegetation generator (#203): trees and bushes from shapes, in the cove tree's style (#202).
// Geometry is written in "design units" of the 96 px cove tree (foot of the roots at y 86, x 48)
// and scaled; shapes stretch it (wide, tall). Small sizes drop details that would turn to noise.
// The trees are drawn for this game with Claude Code, in the 0x72 pack's palette and style.
// Pure: no Phaser, no DOM, no Node; the atlas script and the game both import it. The drawing code lives in vegetation/*.
import type { SunInfo } from '../generated/SunInfo';
import { DEFAULT_LIGHT, type Drawn, type Light, type Rgba } from './vegetation/canvas';
import { drawBush } from './vegetation/bush';
import { drawConifer } from './vegetation/conifer';
import { drawLeafy } from './vegetation/leafy';
export { DEFAULT_LIGHT, drawBush };
export type { Drawn, Light, Rgba };
export type Shape = 'round' | 'wide' | 'tall' | 'conifer';
export type PlantKind = Shape | 'bush';
/** Index = wire id. */
export const PLANT_KINDS: readonly PlantKind[] = ['round', 'wide', 'tall', 'conifer', 'bush'];

/** The light of a run's sun: `side` -1 is left, 1 right; the elevation is in degrees above the horizon. */
export function lightVector(sun: SunInfo): Light {
  const e = (sun.elevation * Math.PI) / 180, x = sun.side * Math.cos(e), y = -Math.sin(e), n = Math.hypot(x, y);
  return { x: x / n, y: y / n };
}

interface TreeOpts { seed: number; scale: number; shape: Shape; light?: Light }

export function drawTree(o: TreeOpts): Drawn {
  const light = o.light ?? DEFAULT_LIGHT;
  if (o.shape === 'conifer') return drawConifer(o.seed, o.scale, light);
  return drawLeafy({ ...o, shape: o.shape, light });
}

/** One plant by wire id kind; trees scale by `scalePct` / 100, a bush is 32 px wide at 100. */
export function drawPlant(kind: PlantKind, seed: number, scalePct: number, light: Light = DEFAULT_LIGHT): Drawn {
  if (kind === 'bush') return drawBush({ seed, width: (32 * scalePct) / 100, light });
  return drawTree({ seed, scale: scalePct / 100, shape: kind, light });
}

/** The trunk foot inside the cove tree's frame (px): the sprite's origin and its depth. */
export const COVE_TREE_FOOT = { x: 48, y: 80 };

/** The atlas frame cove_tree (96x100): seed 11, round, scale 1, its foot at COVE_TREE_FOOT. */
export function coveTree(): Rgba {
  const { img, foot } = drawTree({ seed: 11, scale: 1, shape: 'round' });
  const W = 96, H = 100, ox = COVE_TREE_FOOT.x - foot.x, oy = COVE_TREE_FOOT.y - foot.y;
  if (ox < 0 || oy < 0 || ox + img.w > W || oy + img.h > H) throw new Error(`vegetation: the cove tree (${img.w}x${img.h}, foot ${foot.x},${foot.y}) does not fit its 96x100 frame`);
  const out: Rgba = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4) };
  for (let y = 0; y < img.h; y++) out.data.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((oy + y) * W + ox) * 4);
  return out;
}

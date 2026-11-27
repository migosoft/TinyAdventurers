// Types and budgets of the 3D effects system (#308).
import type { Cam } from '../camera';
import type { GlowBuf } from '../cards';
import type { Cand } from '../lights';
import type { FigureDef } from '../../game/anim/defs';
import type { FxTris } from './tris';
import type { V3 } from './shapes';
import type { SpectreSpec } from '../models/tubeDesc';
import type { SmokeBuf } from './smoke';
import type { Pose3d } from '../models/pose3d';

/** What the effects write into each frame: blended triangles, lit triangles (stone, dust, smoke, floor marks), glow quads and client lights. */
export interface FxOut { tris: FxTris; lit: FxTris; glows: GlowBuf; lights: Cand[]; /** The smoke quads of the smoke bodies (the pass's own buffer; the view draws it). */ smoke: SmokeBuf }

/** A frame shot stuck where it landed (#321, #407): simulation px, the level aim (rad), its fade and the share of its life left
 *  (1..0). The same object every frame: the shots' drawer writes the landing angle and the magic colour into it the first time. */
export interface StuckShot { x: number; y: number; kind: number; aim: number; alpha: number; left: number; pitch?: number; magic?: number }

export interface FxCtx {
  cam: Cam;
  ax: { right: V3; up: V3 };
  /** Seconds, the run's clock. */
  now: number;
  /** 1 High, 0.7 Balanced, 0.5 Fast: multiplies particle counts. */
  detail: number;
  /** The icosphere of fire balls: 1 on Fast. */
  ballDetail: 1 | 2;
  /** An override of every smoke's tone (r, g, b), or null for each body's own (the gallery's switch). */
  smokeTone: readonly [number, number, number] | null;
}

/** A figure as drawn this frame, for the effects tied to one. */
export interface DrawnFig {
  id: number;
  kind: number;
  x: number;
  z: number;
  /** Height of the drawn body's top above its foot, stretch included (a size; add `foot` for a world height). */
  top: number;
  /** World y of the foot in tiles (#324): below 0 on the bed of a dip, a faller's height, above the bed floating in lava. A world height is `foot + height * stretch`. */
  foot: number;
  /** Weapon hand or staff tip, world. */
  hand: V3;
  /** World rad. */
  aim: number;
  anim: number;
  animT: number;
  effects: number;
  alpha: number;
  /** True while the figure dashes (the own hero: from prediction). */
  dashing: boolean;
  model: boolean;
  side: number;
  def: FigureDef;
  /** The dragon's mouth and nostril, or the muzzle a biter's fangs hang before (world, stretched); `undefined` when the figure has none. */
  mouth?: V3;
  nostril?: V3;
  /** A built figure's points (the lich's staff gem, eyes and chest) and its levels (#358); world, tiles, the height stretched. `undefined` for every other figure. */
  gem?: V3; eyes?: V3; chest?: V3; /** The demon's eyes, and five points along its blade's edge (grip to tip); its temper (1 hot, -1 cold). */ eyeL?: V3; eyeR?: V3; blade?: V3[]; temper?: 1 | -1; magic?: { gem: number; flare: number; chest?: number; mouth?: number };
  /** Facing, world rad: a model's drawn yaw, else the aim. */
  yaw: number;
  /** World y the swoosh lies at: the model's shoulder, the card's hand. */
  swingY: number;
  /** The swoosh's arc (rad): the swing's own for an armed figure, else the definition's. */
  arc: number;
  /** A biter's (wolf's) bite progress `u` (0.25 held in the wind-up), -1 for a figure that does not bite with fangs. */
  bite: number;
  /** The model's spectre look (#359), null for a card and for every other model. */
  spectre: SpectreSpec | null;
  /** How far a smoke model has formed out of its pool: 0..1 in the ambush warning (`animT / AMBUSH_WARNING`), else 1. */
  form: number;
  /** A model's pose of this frame (valid for the frame only), its drawn scale and its world y (tiles) at the root; null for a card. */
  rig: { pose: Pose3d; scale: number; lift: number } | null;
}

/** A mimic's one-shot cue from its pose: the reveal (gold motes) or the landing (a dust puff), at the foot (tiles). */
export interface MimicCue { id: number; x: number; z: number; land: boolean }

/** Budgets (first guesses): blended triangles, lit triangles, records of one kind (the oldest is dropped), client lights per frame. */
export const FX_TRI_CAP = 24000;
export const FX_LIT_CAP = 6000;
export const FX_KIND_CAP = 12;
/** Cast records have their own cap (decision on #308): a crowd of casters must not push out a boss's wind-up. */
export const FX_CAST_CAP = 24;
export const FX_LIGHT_CAP = 6;

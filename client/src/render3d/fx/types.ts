// Types and budgets of the 3D effects system (#308).
import type { Cam } from '../camera';
import type { GlowBuf } from '../cards';
import type { Cand } from '../lights';
import type { FigureDef } from '../../game/anim/defs';
import type { FxTris } from './tris';
import type { V3 } from './shapes';

/** What the effects write into each frame: blended triangles, lit triangles (stone, dust, smoke, floor marks), glow quads and client lights. */
export interface FxOut { tris: FxTris; lit: FxTris; glows: GlowBuf; lights: Cand[] }

export interface FxCtx {
  cam: Cam;
  ax: { right: V3; up: V3 };
  /** Seconds, the run's clock. */
  now: number;
  /** 1 High, 0.7 Balanced, 0.5 Fast: multiplies particle counts. */
  detail: number;
  /** The icosphere of fire balls: 1 on Fast. */
  ballDetail: 1 | 2;
}

/** A figure as drawn this frame, for the effects tied to one. */
export interface DrawnFig {
  id: number;
  kind: number;
  x: number;
  z: number;
  /** World y of the drawn body's top, stretch included. */
  top: number;
  /** Weapon hand or staff tip, world. */
  hand: V3;
  /** World rad. */
  aim: number;
  anim: number;
  animT: number;
  effects: number;
  alpha: number;
  model: boolean;
  side: number;
  def: FigureDef;
  /** The dragon's mouth and nostril, or the muzzle a biter's fangs hang before (world, stretched); `undefined` when the figure has none. */
  mouth?: V3;
  nostril?: V3;
  /** Facing, world rad: a model's drawn yaw, else the aim. */
  yaw: number;
  /** World y the swoosh lies at: the model's shoulder, the card's hand. */
  swingY: number;
  /** The swoosh's arc (rad): the swing's own for an armed figure, else the definition's. */
  arc: number;
  /** A biter's (wolf's) bite progress `u` (0.25 held in the wind-up), -1 for a figure that does not bite with fangs. */
  bite: number;
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

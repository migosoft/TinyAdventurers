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
  mouth?: V3;
  nostril?: V3;
}

/** Budgets (first guesses): blended triangles, lit triangles, records of one kind (the oldest is dropped), client lights per frame. */
export const FX_TRI_CAP = 24000;
export const FX_LIT_CAP = 6000;
export const FX_KIND_CAP = 12;
export const FX_LIGHT_CAP = 6;

// The boundary between the Phaser-free run session and a view (the 2D game or
// the 3D view). Types only, except NO_STATS. The session never imports a view;
// it asks the view one question (pointerWorld), everything else flows to it.
import type { Ev } from '../generated/Ev';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Snapshot } from '../generated/Snapshot';
import type { LightField } from '../game/light';
import type { UseHint } from '../game/useHint';
import type { EntState } from '../game/world';
import type { TileMap } from '../sim/map';

export interface RunViewInit {
  info: RunStartInfo;
  map: TileMap;
  light: LightField;
  myKind: number;
}

/** A predicted own shot, as the view may read it. */
export interface ShotView {
  readonly shot: number;
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** The own hero as drawn this frame (predicted, or the interpolated hero while charmed). */
export interface OwnHero {
  x: number;
  y: number;
  alive: boolean;
  charmed: boolean;
  anim: number;
  animT: number;
  arc?: number;
  aim: number;
  /** The hero aims at the pointer (alive, not charmed, able to turn): the view may settle `aim` after its camera moved. */
  aimsAtPointer: boolean;
  /** The predicted foot the session's aim is measured from (simulation px). */
  aimFromX: number;
  aimFromY: number;
  flags: number;
  effects: number;
  entangled: number;
  dashing: boolean;
  sinking: boolean;
}

export interface DebugDraw {
  on: boolean;
  path: [number, number][];
  ogre: [number, number][];
  cove: [number, number][];
  notice: [number, number][];
  dodges: { x0: number; y0: number; x1: number; y1: number; at: number }[];
}

/** What the session hands the view each display frame. A frame and the objects in it are valid only during the
 *  call: the session reuses them, so a view must not keep references to them. A view may write `own.aim` through
 *  `settleOwnAim` (after its camera moved), and nothing else. */
export interface RunFrame {
  dt: number;
  now: number; // seconds
  ents: ReadonlyMap<number, EntState>; // interpolated
  you: number;
  own: OwnHero;
  watching: number | null; // the spectated teammate
  camera: { x: number; y: number }; // ground position, simulation px
  snap: Snapshot | undefined; // lights, looks, drain, me.vision, me.darkvision
  shots: readonly ShotView[];
  hiddenShots: ReadonlySet<number>; // entity ids of server projectiles not to draw
  useHint: UseHint | null;
  /**
   * The ids marked as in the dark (`Snapshot.dark`) by the snapshot `ents` are drawn from: sent, but nothing is
   * drawn over them. The set belongs to that snapshot and is valid only during `frame()`: copy it to keep it.
   */
  dark: ReadonlySet<number>;
  debug: DebugDraw;
}

export interface ViewStats {
  fps: number;
  wholeMs: number;
  renderMs: number;
  systems: readonly (readonly [name: string, ms: number])[];
  objects: number;
  drawCalls: number;
  canvas: { w: number; h: number; cssZoom: number };
}

export const NO_STATS: ViewStats = {
  fps: 0,
  wholeMs: 0,
  renderMs: 0,
  systems: [],
  objects: 0,
  drawCalls: 0,
  canvas: { w: 0, h: 0, cssZoom: 1 },
};

export type PictureEv = Extract<Ev, { t: 'Dmg' | 'Heal' | 'Boom' | 'Zap' | 'Died' | 'Sink' | 'Raise' | 'Immune' | 'Effect' | 'Coins' }>;

export interface RunView {
  frame(f: RunFrame): ViewStats;
  /** `own` is the predicted hero position (camera shake tests against it). */
  /** `own`: the predicted hero. `server`: the own hero's position in the snapshot that carried the event (null if absent). */
  /** `dark`: the event is in the dark (`Snapshot.dark_ev`). */
  event(ev: PictureEv, own: { x: number; y: number }, server?: { x: number; y: number } | null, dark?: boolean): void;
  /** The session has already updated the map and the LightField. */
  tileChanged(x: number, y: number, v: number): void;
  shotEnded(shot: ShotView, how: 'wall' | 'enemy' | 'gone'): void;
  /** The aimed point at the foot plane (simulation px): the point under the pointer moved `SHOT_LIFT_PX` art px down
   *  the screen, then onto the ground. Null: no pointer (outside the canvas, before the first frame, during a
   *  middle-mouse drag). */
  pointerWorld(): { x: number; y: number } | null;
  destroy(): void;
}

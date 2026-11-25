// The pieces the dungeon air takes from a frame, the 3D air reads.

/** A moving figure (r = body radius) or projectile (shot = true); v in px/s. */
export interface AirMover {
  /** The entity id; the own hero's is `f.you`; a predicted shot keeps its tracker key. */
  id: number;
  /** `FLAG` bits (0 for shots). */
  flags: number;
  x: number;
  y: number;
  /** The y where the air is injected (default `y`): a shot is drawn 8 px above its ground position. */
  airY?: number;
  vx: number;
  vy: number;
  r: number;
  shot: boolean;
  /** 0..1: how much a shot warms the air it passes (0 for figures). */
  heat: number;
}

/** A moving light: `kind` is a `LIGHT_KIND` (fire trails embers, a blast throws a burst). */
export interface AirShot {
  x: number;
  y: number;
  kind: number;
}

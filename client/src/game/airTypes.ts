// The pieces the dungeon air takes from a frame, shared by the 2D air (mood.ts) and the 3D air. No Phaser.

/** A moving figure (r = body radius) or projectile (shot = true); v in px/s. */
export interface AirMover {
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

/** A torch in the window; its smoke needs `lit` and a seen, lit floor tile. */
export interface AirTorch {
  x: number;
  y: number;
  side: number;
  lit: boolean;
}

/** A moving light: `kind` is a `LIGHT_KIND` (fire trails embers, a blast throws a burst). */
export interface AirShot {
  x: number;
  y: number;
  kind: number;
}

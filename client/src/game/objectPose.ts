// Poses of the board's objects (chests, barrels, mimics, torches) as pure
// functions, free of Phaser: the 2D views (chest.ts, barrel.ts, mimic.ts,
// torch.ts) draw from them, and so can the 3D view.
import { ANIM, CONST, FLAG } from '../generated/defs';

// ---- chest ----

/** Tag height; a hidden mimic uses the same, so the log's tags cannot tell them apart. */
export const CHEST_HEIGHT = 16;
const OPEN_T = 0.3;
const EMPTY_AFTER = 0.5;

/** The chest's atlas frame; `opened`: seconds since it was opened, or -1 while closed. */
export function chestFrame(opened: number): string {
  if (opened >= EMPTY_AFTER) return 'chest_empty_open_anim_f2';
  if (opened >= 0) return `chest_full_open_anim_f${Math.min(2, Math.floor((opened / OPEN_T) * 3))}`;
  return 'chest_full_open_anim_f0';
}

// ---- barrel ----

/** The barrel's pose: `fill` a flash colour (or null), `dx` the fuse's shake, `dy` how far the body sank (px), body scale and alpha, and whether the ground shadow shows. */
export interface BarrelPose {
  fill: number | null;
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
  shadow: boolean;
}

/** Server anim: 0 resting, 1 fuse burning (anim_ms since lit), 2 falling into a chasm, 3 sinking in deep water (anim_ms since it started). */
export function barrelPose(anim: number, animMs: number): BarrelPose {
  const t = animMs / 1000;
  const p: BarrelPose = { fill: null, dx: 0, dy: 0, scale: 1, alpha: 1, shadow: true };
  if (anim === 1) {
    // The fuse: flashes faster as it burns down.
    const rate = 6 + (t / CONST.BARREL_FUSE) * 18;
    if (Math.floor(t * rate) % 2 === 0) p.fill = 0xfff0c0;
    p.dx = Math.round(Math.sin(t * 90));
  } else if (anim === 2) {
    const k = Math.min(1, t / CONST.FALL_TIME);
    p.scale = 1 - 0.8 * k;
    p.alpha = 1 - k;
    p.shadow = false;
  } else if (anim === 3) {
    const k = Math.min(1, t / CONST.DROWN_TIME);
    p.dy = 10 * k;
    p.alpha = 1 - k;
    p.shadow = false;
  }
  return p;
}

// ---- torch ----

/** Where the sprite's foot goes relative to the torch's position, and whether it is mirrored, by side. */
export function torchOffset(side: number): [dx: number, dy: number, flip: boolean] {
  return side === 0 ? [0, -3, false] : side === 1 ? [1, 2, false] : [-1, 2, true];
}

/** The tip of the flame (px) for a torch at (x, y) on `side`: the frames' flame reaches about 17 px above the foot, half a pixel towards the flame side. */
export function flameTip(x: number, y: number, side: number): [number, number] {
  const [dx, dy, flip] = torchOffset(side);
  return [Math.round(x + dx) + (flip ? -0.5 : 0.5), Math.round(y + dy) - 17];
}

const TORCH_FPS = 8;

/** The torch's atlas frame: a flame frame by time `t` (s) while lit, else `torch_out`. */
export function torchFrame(lit: boolean, t: number, frames: readonly string[]): string {
  return lit ? frames[Math.floor(t * TORCH_FPS) % frames.length] : 'torch_out';
}

// ---- mimic ----

/** Peak height of a hop in pixels. */
export const HOP_H = 7;

/** Hop cycle split (fractions of one cycle, from the server). The mimic moves only while airborne. */
export const HOP_CYCLE = CONST.MIMIC_HOP_CYCLE;
export const HOP = { crouch: CONST.MIMIC_HOP_AIR_START, air: CONST.MIMIC_HOP_AIR_END, land: CONST.MIMIC_HOP_AIR_END + 0.15 };
export const BITE_T = 0.35;
export const WAKE_T = CONST.MIMIC_WAKE_T;
/** A hiding mimic rattles now and then when a hero is this close (px). */
const RATTLE_NEAR = 40;

export interface MimicState {
  x: number;
  y: number;
  /** Still a chest: closed lid, occasional rattle when `rattle` > 0 (0..1 intensity). */
  hiding: boolean;
  rattle?: number;
  /** Seconds since waking (the reveal pop), or -1. */
  wakeT?: number;
  /** Hop cycle phase 0..1, or -1 when not hopping. */
  hop?: number;
  /** Seconds since a bite started, or -1. */
  biteT?: number;
  /** Direction it faces / bites towards (radians). */
  aim: number;
  hurt?: boolean;
}

/** What the server sends for a mimic (an EntSnap, unpacked). */
export interface MimicSnap {
  x: number;
  y: number;
  anim: number;
  animT: number;
  aim: number;
  flags: number;
}

/** The mimic's wake clock and rattle timer: turns server snapshots into a MimicState. */
export class MimicTracker {
  private wasHiding: boolean | undefined;
  private wakeClock = -1;
  private rattleAt = 1 + Math.random() * 3;

  /** `heroDist`: distance to the nearest hero (px). */
  step(e: MimicSnap, dt: number, heroDist: number): MimicState {
    const hiding = (e.flags & FLAG.HIDING) !== 0;
    // The reveal plays only when we saw it hiding; a late joiner just sees the mimic.
    if (this.wasHiding && !hiding) this.wakeClock = 0;
    else if (this.wakeClock >= 0) this.wakeClock += dt;
    this.wasHiding = hiding;
    // A disguised mimic gives itself away now and then when a hero comes close.
    let rattle = 0;
    if (hiding && heroDist < RATTLE_NEAR) {
      this.rattleAt -= dt;
      if (this.rattleAt < 0) rattle = 0.5;
      if (this.rattleAt < -0.35) this.rattleAt = 1.5 + Math.random() * 2.5;
    }
    return {
      x: e.x,
      y: e.y,
      hiding,
      rattle,
      wakeT: this.wakeClock,
      hop: e.anim === ANIM.Move ? (e.animT / HOP_CYCLE) % 1 : e.anim === ANIM.Windup ? HOP.crouch * 0.8 : -1,
      biteT: e.anim === ANIM.Melee ? e.animT : -1,
      aim: e.aim,
      hurt: (e.flags & FLAG.HURT) !== 0,
    };
  }
}

/** The mimic's pose: chest frame 0..2, `lift` pixels above the floor, squash/stretch, body offset and tilt (degrees). */
export interface MimicPose {
  frame: number;
  lift: number;
  sx: number;
  sy: number;
  bx: number;
  by: number;
  angle: number;
  hurtFill: boolean;
  shadowScale: number;
  shadowAlpha: number;
  /** Faces left (mirrored): the aim points left of the screen's vertical by more than a margin. */
  flip: boolean;
  /** One-shot cues for the 2D effects: the reveal pop and the landing dust. */
  wakeCue: boolean;
  landCue: boolean;
}

/** `clock`: the view's running time (s). `mem` is the one-shot memory of the view and is updated here. */
export function mimicPose(s: MimicState, clock: number, mem: { lastHop: number; wakeFx: boolean }): MimicPose {
  const left = Math.cos(s.aim) < -0.15;
  let frame = 0;
  let lift = 0; // pixels above the floor
  let sx = 1;
  let sy = 1;
  let bx = 0;
  let by = 0;
  let angle = 0;
  let wakeCue = false;
  let landCue = false;

  if (s.hiding) {
    // Just a chest. A rattle is a quick shiver with the lid lifting a crack.
    const r = s.rattle ?? 0;
    if (r > 0 && Math.floor(clock * 24) % 2 === 0) {
      bx = Math.random() < 0.5 ? -1 : 1;
      angle = (Math.random() * 2 - 1) * 6 * r;
      if (r > 0.6) frame = 1;
    }
    mem.wakeFx = false;
  } else if ((s.wakeT ?? -1) >= 0 && s.wakeT! < WAKE_T) {
    // Reveal: the lid flies open and the chest jumps.
    const k = s.wakeT! / WAKE_T;
    frame = k < 0.15 ? 1 : 2;
    lift = Math.sin(Math.min(k / 0.7, 1) * Math.PI) * HOP_H * 1.4;
    sy = k < 0.15 ? 0.8 : 1.15 - k * 0.15;
    sx = 2 - sy;
    if (!mem.wakeFx && k >= 0.15) {
      mem.wakeFx = true;
      wakeCue = true;
    }
  } else if ((s.biteT ?? -1) >= 0 && s.biteT! < BITE_T) {
    // Snap: open wide while lunging, then clamp shut.
    const k = s.biteT! / BITE_T;
    frame = k < 0.2 ? 1 : k < 0.6 ? 2 : k < 0.8 ? 1 : 0;
    const lunge = Math.sin(Math.min(k / 0.6, 1) * Math.PI) * 3;
    bx = Math.cos(s.aim) * lunge;
    by = Math.sin(s.aim) * lunge * 0.5;
    lift = k > 0.2 && k < 0.6 ? 2 : 0;
    angle = (left ? -1 : 1) * 10 * Math.sin(k * Math.PI);
  } else if ((s.hop ?? -1) >= 0) {
    const h = s.hop!;
    if (h < HOP.crouch) {
      // Crouch: squash down, lid starts to lift.
      const k = h / HOP.crouch;
      frame = 1;
      sy = 1 - 0.2 * k;
      sx = 1 + 0.15 * k;
    } else if (h < HOP.air) {
      // Airborne: jaws open, stretched on the way up.
      const k = (h - HOP.crouch) / (HOP.air - HOP.crouch);
      frame = 2;
      lift = 4 * k * (1 - k) * HOP_H;
      sy = 1.15 - 0.15 * k;
      sx = 2 - sy;
      angle = (left ? -1 : 1) * (8 - 16 * k);
    } else if (h < HOP.land) {
      // Landing: squash and slam the lid.
      const k = (h - HOP.air) / (HOP.land - HOP.air);
      frame = k < 0.5 ? 1 : 0;
      sy = 0.78 + 0.22 * k;
      sx = 1.2 - 0.2 * k;
      if (mem.lastHop < HOP.air) landCue = true;
    } else {
      // Rest: lid ajar, panting.
      frame = Math.floor(clock * 8) % 2 ? 1 : 0;
    }
    mem.lastHop = h;
  } else {
    // Awake and standing: slow chomping.
    frame = Math.floor(clock * 3) % 3 === 2 ? 2 : 1;
  }

  const air = Math.min(lift / HOP_H, 1.4);
  return {
    frame,
    lift,
    sx,
    sy,
    bx,
    by,
    angle,
    hurtFill: !!s.hurt && Math.floor(clock * 30) % 2 === 0,
    shadowScale: 1 - 0.35 * air,
    shadowAlpha: 0.4 - 0.15 * air,
    flip: left,
    wakeCue,
    landCue,
  };
}

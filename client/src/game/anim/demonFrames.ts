// Demon frame layout, shared by the atlas build (scripts/demon-frames.ts) and
// the board (anim/defs.ts). AI-generated art for this game, imported once from
// the user's sheets into one aligned strip per action (assets-src/demon/
// demon_<action>.png, facing right): every cell has the hips at x `hipX` and
// the feet on row `footY`.

export const DEMON_FRAME = { w: 82, h: 63, hipX: 33, footY: 62 } as const;

/** Frames per strip, in strip order. */
export const DEMON_ANIMS = {
  idle: 4,
  /** Sheet images 1, 2, 3, 8 (legs apart, crossing, apart the other way), then 3, 2 back: the user's order. */
  walk: 6,
  /** Wind-up, strike, impact, follow-through, recovery. */
  cleave: 5,
  /** Wind-up (bull crouch), two charging frames (looped), the stop. */
  charge: 4,
  /** Gathering power, rising, the burst (arms flung wide), recovery. */
  cast: 4,
} as const;
export type DemonAnim = keyof typeof DEMON_ANIMS;

export const demonFrameName = (a: DemonAnim, i: number) => `demon_${a}_anim_f${i}`;

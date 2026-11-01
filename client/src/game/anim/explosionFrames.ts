// Explosion frame layout, shared by the atlas build (scripts/explosion-frames.ts)
// and the effects (effects.ts). AI-generated art for this game (ChatGPT sheets
// in assets-src/explosion/), cut from six labelled stages into square frames,
// each centred on its stage's cloud.

/** Frame size in texels; the blast's centre is the frame's centre. */
export const EXPLOSION_FRAME = 104;

/** The radius of the cloud at its peak (stage 3), in texels: drawn at scale 1 for a blast of this radius. */
export const EXPLOSION_ART_R = 38;

/** Stages per sheet: flash, grows, peak, cooling, smoke, dissipates. */
export const EXPLOSION_STAGES = 6;

/** Sheets, by the name used in their frame names; the file is assets-src/explosion/<name>_source.png. */
export const EXPLOSION_SHEETS = ['fireball'] as const;
export type ExplosionSheet = (typeof EXPLOSION_SHEETS)[number];

export const explosionFrameName = (s: ExplosionSheet, i: number) => `${s}_boom_f${i}`;

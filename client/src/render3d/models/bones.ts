// The bone and stage names of the 3D figure models (#338), with no builder code: the run's view imports these without the model builder.

/** The draw order of the pieces: the page's `ORDER`, then the weapon. Within a stage the outline hulls come first, then the pieces. */
export const STAGES = ['legs', 'body', 'head', 'collar', 'hair', 'hat', 'spikes', 'arms', 'weapon'] as const;
export const BONES = ['hips', 'body', 'head', 'hat', 'armR', 'handR', 'armL', 'handL', 'leg0', 'leg1', 'leg2', 'leg3', 'weaponR', 'weaponL'] as const;
export const MAX_BONES = 14, MAX_BENDS = 4;

export type Bone = (typeof BONES)[number];
export type Stage = (typeof STAGES)[number];

/** The weapon sprites whose model is a bow (held in the left hand). The weapon table in `weapons.ts` marks the same ones `kind: 'bow'`; a test keeps the two equal. */
export const BOW_WEAPONS: ReadonlySet<string> = new Set(['weapon_bow', 'weapon_bow_2']);

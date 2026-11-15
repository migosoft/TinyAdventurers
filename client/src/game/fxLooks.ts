// Colours and sets the 2D effects and the 3D effects (#308) both use. Phaser-free: `render3d/` may import it.
import { KIND } from '../generated/defs';

/** The lich's gloom colours. */
export const GLOOM = { dark: 0x2a0a3a, mid: 0x5a1a8a, light: 0xa060f0, spark: 0xe0c0ff };

/** Figures that leave bone, not blood, when they die. */
export const SKELETAL = new Set<number>([KIND.SkeletonWarrior, KIND.SkeletonArcher, KIND.RaisedSkeleton, KIND.Lich]);

/** The ring and motes of a minion that appears, by the Raise event's `k`: 0 green (raised skeleton), 1 fiery (summoned imp), 2 dark purple (the lich's). */
export const RAISE_LOOKS: Readonly<Record<number, { ring: number; motes: readonly number[] }>> = {
  0: { ring: 0x3ad04a, motes: [0x3ad04a] },
  1: { ring: 0xff7020, motes: [0xff7020, 0xffd040] },
  2: { ring: GLOOM.mid, motes: [GLOOM.dark, GLOOM.spark] },
};

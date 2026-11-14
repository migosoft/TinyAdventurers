// What the server says about one plant, as the tree builder needs it.
import type { PlantInfo } from '../../generated/PlantInfo';
import { PLANT_KINDS } from '../../game/vegetation';

export type TreeForm = 'round' | 'wide' | 'tall' | 'willow' | 'conifer' | 'bush';

export interface TreeSpec {
  form: TreeForm;
  /** The foot in tiles. */
  x: number;
  z: number;
  seed: number;
  scalePct: number;
  mirrored: boolean;
  /** Leaf amount 0..1. */
  leaf: number;
  dead: boolean;
}

export function treeSpecOf(p: PlantInfo): TreeSpec {
  return { form: PLANT_KINDS[p[0]] as TreeForm, x: p[1] / 16, z: p[2] / 16, seed: p[3], scalePct: p[4], mirrored: p[5], leaf: p[6] / 100, dead: p[7] };
}

/** Which mesh a tree needs: the look, without the foot and without the leaf amount (a shader input). */
export function lookKey(s: TreeSpec): string {
  return `${s.form}:${s.seed}:${s.scalePct}:${s.mirrored}:${s.dead}`;
}

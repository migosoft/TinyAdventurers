// Which extra passes a frame needs for the water (#345), and the pose of the mirror camera. Pure.
// With a pool in view the picture is drawn in two parts with a copy between them (the opaque scene, its copy, then the water and
// everything translucent: the water reads the copy), and, with reflections on, the scene above the water is drawn once more from a
// camera mirrored in the water plane, at half size. Without a pool in view nothing extra runs.
import type { Footprint } from '../lights';

/** The layer of the water's surface meshes (drawn after the scene copy), and of the ceiling only the mirror camera sees. */
export const WATER_LAYER = 2, CEILING_LAYER = 3;

/** How far outside the ground the screen shows a pool still counts as in view (tiles): its surface lies below the floor and waves reach past a cell. */
const VIEW_MARGIN = 1;

/** Whether any box (x0, z0, x1, z1 in tiles) lies within 1 tile of the ground the screen shows. */
export function waterInView(boxes: readonly { x0: number; z0: number; x1: number; z1: number }[], fp: Footprint): boolean {
  for (const b of boxes) {
    if (b.x1 >= fp.x0 - VIEW_MARGIN && b.x0 <= fp.x1 + VIEW_MARGIN && b.z1 >= fp.z0 - VIEW_MARGIN && b.z0 <= fp.z1 + VIEW_MARGIN) return true;
  }
  return false;
}

/** The extra passes of a frame whose picture is w x h px: none without a pool in view; the mirror picture is half the size, at least 1 px. */
export function waterPasses(inView: boolean, reflect: boolean, w: number, h: number): { copy: boolean; mirror: { w: number; h: number } | null } {
  if (!inView) return { copy: false, mirror: null };
  return { copy: true, mirror: reflect ? { w: Math.max(1, Math.ceil(w / 2)), h: Math.max(1, Math.ceil(h / 2)) } : null };
}

/** A camera position and target mirrored in the plane y = level; the mirror camera's up is (0, -1, 0). */
export function mirrorPose(
  pos: readonly [number, number, number], target: readonly [number, number, number], level: number,
): { pos: [number, number, number]; target: [number, number, number] } {
  return { pos: [pos[0], 2 * level - pos[1], pos[2]], target: [target[0], 2 * level - target[1], target[2]] };
}

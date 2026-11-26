// The demon's pose (#379): what the builder reads to place the skeleton, the wings and the tail. This file holds the type and the
// standing pose; the poses of the anims come with `demonPose`.
import { ARM, FOOT, J, JOINTS, RIG } from './skeleton';
import { newWing, type WingState } from './wings';

/** The tail's links: a swing travels down them. */
export const TAIL_LINKS = 6;

export interface DemonPose {
  /** The skeleton's joint values, by `J` (skeleton.ts): rad, and builder units for the hips' place and the foot points. */
  joints: Float32Array;
  wingR: WingState; wingL: WingState;
  /** Per link [yaw (+ to the demon's right), pitch (+ up)]: rad away from the link's rest direction, in the hips' frame. All equal: the tail turns as a whole. */
  tail: Float32Array;
  /** Builder units the body hangs above the floor. The view lifts the figure; the builder does not read it. */
  lift: number;
  /** The glow of the eyes and the mouth: 1 at rest. */
  heat: number;
  /** The hand the `hand` anchor follows: 1 the right, -1 the left. */
  caster: 1 | -1;
}

/** The numbers of the standing pose (the spike's standing figure: the arms a little off the body, the forearms held forward). */
export const DEMON_POSE = {
  armOut: 0.16, elbow: 0.5,
  /** The wings at rest: the spike's half-folded layout. `raise` and `sweep` are its span's direction; `pitch` counts from its own plane. */
  wing: { fold: 0.42, raise: -0.1, sweep: 0.67, pitch: 0 },
} as const;

export function restPose(): DemonPose {
  const joints = new Float32Array(JOINTS);
  for (const [a, f, sd] of [[J.armR, J.footR, 1], [J.armL, J.footL, -1]] as const) {
    joints[a + ARM.out] = DEMON_POSE.armOut; joints[a + ARM.elbow] = DEMON_POSE.elbow;
    joints[f + FOOT.x] = RIG.sole[0]; joints[f + FOOT.y] = RIG.sole[1]; joints[f + FOOT.z] = sd * RIG.legZ;
  }
  return { joints, wingR: newWing(DEMON_POSE.wing), wingL: newWing(DEMON_POSE.wing), tail: new Float32Array(TAIL_LINKS * 2), lift: 0, heat: 1, caster: 1 };
}

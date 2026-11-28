// The wall cut (#347) in the world material's vertex stage; the rule is `cut.ts`. Paint, light, sight and shadows keep the unmoved point.
import { min, mix, smoothstep, uniform, vec3 } from 'three/tsl';
import { CUT_DEFAULTS } from './cut';
import type { SeeUniforms } from './materials';

type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- TSL nodes are untyped, as in materials.ts

/** `on` 0 or 1; `floor`, `stub`, `line`, `ramp` in tiles (the view sets them each frame). */
export function cutUniforms() {
  return {
    on: uniform(CUT_DEFAULTS.on ? 1 : 0).setName('cutOn'),
    floor: uniform(0).setName('cutFloor'),
    stub: uniform(CUT_DEFAULTS.stub).setName('cutStub'),
    line: uniform(CUT_DEFAULTS.line).setName('cutLine'),
    ramp: uniform(CUT_DEFAULTS.ramp).setName('cutRamp'),
  };
}
export type CutUniforms = Record<keyof ReturnType<typeof cutUniforms>, N>;

/** How much of the cut applies at world point `p`: the distance toward the camera along the see-through ray, from the hero's line. */
export function cutWeightNode(p: N, cut: CutUniforms, see: SeeUniforms): N {
  const d = p.xz.sub(see.target.xz).dot(see.ray.xz);
  return smoothstep(cut.line, cut.line.add(cut.ramp), d).mul(cut.on);
}

/** The point after the cut: lowered toward `floor + stub`, never raised. */
export function cutPositionNode(p: N, cut: CutUniforms, see: SeeUniforms): N {
  const w = cutWeightNode(p, cut, see);
  return vec3(p.x, mix(p.y, min(p.y, cut.floor.add(cut.stub)), w), p.z);
}

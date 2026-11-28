// The wall cut (#347) in the world material's vertex stage; the rule is `cut.ts`. Paint, light, sight and shadows keep the unmoved point.
import { float, floor, fract, max, min, mix, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { Vector3 } from 'three/webgpu';
import { CUT_DEFAULTS } from './cut';
import type { SeeUniforms } from './materials';
import type { Sight } from './sightNodes';

type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- TSL nodes are untyped, as in materials.ts

/** What the hide test reads: `cellH` (a tile's height as a node, `Lighting.cellH`) and the sight. */
export interface CutEnv { cellH(cell: N): N; sight: Sight }

/** `on` 0 or 1; `floor`, `stub`, `line`, `ramp` in tiles; `edge` 0..1; `slope` = 1 / tan(pitch); `target` the followed hero's ground point (the view sets them each frame). */
export function cutUniforms(env: CutEnv) {
  return {
    target: uniform(new Vector3()).setName('cutTarget'),
    on: uniform(CUT_DEFAULTS.on ? 1 : 0).setName('cutOn'),
    floor: uniform(0).setName('cutFloor'),
    stub: uniform(CUT_DEFAULTS.stub).setName('cutStub'),
    line: uniform(CUT_DEFAULTS.line).setName('cutLine'),
    ramp: uniform(CUT_DEFAULTS.ramp).setName('cutRamp'),
    edge: uniform(CUT_DEFAULTS.edge).setName('cutEdge'),
    slope: uniform(1).setName('cutSlope'),
    env,
  };
}
export type CutUniforms = Record<keyof ReturnType<typeof cutUniforms>, N>;

/**
 * 1 where the ground at `q` (xz) is floor the followed hero sees, else 0: the heights bilinear over the four nearest tile centres
 * (the texture is nearest-filtered, so a hand-written read keeps the value continuous), a tile counting as floor when no higher than floor + stub,
 * times 1 - hard from the sight mask (1 while the sight is off). All samples at the top level: no branch.
 */
function hidesNode(q: N, cut: CutUniforms): N {
  const { cellH, sight } = cut.env as CutEnv;
  const u: N = q.sub(0.5), c0: N = floor(u), f: N = fract(u);
  const limit = cut.floor.add(cut.stub);
  const open = (dx: number, dz: number): N => float(1).sub(smoothstep(limit, limit.add(0.05), cellH(c0.add(vec2(dx, dz)))));
  const ground = mix(mix(open(0, 0), open(1, 0), f.x), mix(open(0, 1), open(1, 1), f.x), f.y);
  const seen = mix(float(1), float(1).sub(sight.unseenAt(q).x), sight.active);
  return ground.mul(seen);
}

/**
 * How much of the cut applies at world point `p`: `d`, the distance toward the camera along the see-through ray from the hero's line (through `cut.target`,
 * not the drawn camera), times the hide test at the ground point `p` covers on screen (`cut.ts`, `hiddenPoint`).
 */
export function cutWeightNode(p: N, cut: CutUniforms, see: SeeUniforms): N {
  const d = p.xz.sub(cut.target.xz).dot(see.ray.xz);
  const q = p.xz.sub(see.ray.xz.mul(max(p.y.sub(cut.floor), 0).mul(cut.slope)));
  const side = smoothstep(cut.line, cut.line.add(cut.ramp), d);
  const hides = smoothstep(float(0.5).sub(cut.edge.mul(0.5)), float(0.5).add(cut.edge.mul(0.5)), hidesNode(q, cut));
  return side.mul(hides).mul(cut.on);
}

/** The point after the cut: lowered toward `floor + stub`, never raised. */
export function cutPositionNode(p: N, cut: CutUniforms, see: SeeUniforms): N {
  const w = cutWeightNode(p, cut, see);
  return vec3(p.x, mix(p.y, min(p.y, cut.floor.add(cut.stub)), w), p.z);
}

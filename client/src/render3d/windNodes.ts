// The sway of #306 in TSL: the same formula as `sway` in wind.ts, as a vertex offset.
import { clamp, float, max, pow, select, sin, vec3 } from 'three/tsl';
import { SWAY_WAVE, WIND_DIR } from './wind';

// TSL's node types are too narrow for mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The travelling gust (0..1) at `xz` (x, z) at time `t`: `gust` in wind.ts as a node. */
export function gustNode(xz: N, t: N): N {
  return pow(max(0, sin(xz.x.add(xz.y.mul(0.3)).mul(0.33).sub(t.mul(1.5)))), 6);
}

/** The offset (tiles) of a point `y` up a plant of height `h` whose foot is `foot` (x, z): 0 when `on` < 0.5 or `amp` <= 0. */
export function swayNode(foot: N, y: N, h: N, amp: N, t: N, on: N): N {
  const k = clamp(y.div(max(h, 1e-4)), 0, 1).toVar('swayK');
  const k2 = k.mul(k);
  const g = gustNode(foot, t);
  const wave = sin(t.mul(1.3).add(foot.x.mul(0.9)).add(foot.y.mul(0.4))).mul(SWAY_WAVE.slow)
    .add(sin(t.mul(2.9).add(foot.y)).mul(SWAY_WAVE.fast))
    .add(g.mul(SWAY_WAVE.gust));
  const s = select(on.greaterThanEqual(0.5).and(amp.greaterThan(0)), amp.mul(k2).mul(wave), float(0));
  return vec3(s.mul(WIND_DIR[0]), 0, s.mul(WIND_DIR[1]));
}

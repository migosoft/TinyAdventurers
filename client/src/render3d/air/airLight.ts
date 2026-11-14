// A CPU estimate of the scene's light at a world point, for where dust may spawn (#307): the point lights as the shader's `lightAt`
// falls them off (horizontal distance, no shadows, no surface normal) plus the cracks' patches and shafts (`crackMask`, the
// CPU twin of the shader's mask). No ambient: the specks are lit by the scene minus ambient. Shader scale (1 = a torch at its centre).
import { falloff } from '../../game/light';
import type { Light } from '../light';
import { LIGHT_MARGIN } from '../lights';
import { crackMask, type Crack } from './cracks';

/** The summed light (r, g, b; shader scale, not clamped) at (x, y, z) in tiles. */
export function airLightAt(x: number, y: number, z: number, lights: readonly Light[], cracks: readonly Crack[]): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (const l of lights) {
    if (l.radius <= 0) continue;
    const dh = Math.hypot(l.x - x, l.z - z);
    if (dh >= l.radius + LIGHT_MARGIN) continue;
    const f = falloff(dh, l.radius);
    r += l.r * f;
    g += l.g * f;
    b += l.b * f;
  }
  for (const c of cracks) {
    const m = crackMask(c, x, y, z);
    if (m <= 0) continue;
    r += c.rgb[0] * m;
    g += c.rgb[1] * m;
    b += c.rgb[2] * m;
  }
  return [r, g, b];
}

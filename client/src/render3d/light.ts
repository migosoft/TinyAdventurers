// The scene's point lights, as plain numbers (the shader side is in lightNodes.ts).
import { orbAt, type SceneState } from './scene';

export interface Light { x: number; y: number; z: number; radius: number; r: number; g: number; b: number; shadow: boolean }
export const MAX_LIGHTS = 8;
export const AMBIENT: [number, number, number] = [0.075, 0.08, 0.125];

export function torchFlicker(t: number, ph: number): number {
  return 1 + 0.07 * Math.sin(11 * t + ph) + 0.05 * Math.sin(23.3 * t + 2 * ph) + 0.04 * Math.sin(5.1 * t + 3 * ph);
}

export function sceneLights(s: SceneState, t: number, orb: boolean): Light[] {
  const out: Light[] = s.torches.map((tc) => {
    const k = torchFlicker(t, tc.ph);
    return {
      x: tc.x + 0.03 * Math.sin(13 * t + tc.ph), y: tc.y + 0.25 + 0.03 * Math.sin(17 * t + tc.ph), z: tc.z + 0.1,
      radius: 8.5, r: 1.2 * k, g: 0.76 * k, b: 0.4 * k, shadow: true,
    };
  });
  if (orb) {
    const o = orbAt(t);
    out.push({ x: o.x, y: o.y, z: o.z, radius: 5.5, r: 0.5, g: 0.72, b: 1.25, shadow: true });
  }
  return out;
}

/** 8 slots each: xyz + radius, rgb + shadow flag. Unused slots have radius 0. */
export function packLights(lights: Light[]): { pos: Float32Array; col: Float32Array } {
  const pos = new Float32Array(MAX_LIGHTS * 4);
  const col = new Float32Array(MAX_LIGHTS * 4);
  for (let i = 0; i < Math.min(MAX_LIGHTS, lights.length); i++) {
    const l = lights[i];
    pos.set([l.x, l.y, l.z, l.radius], i * 4);
    col.set([l.r, l.g, l.b, l.shadow ? 1 : 0], i * 4);
  }
  return { pos, col };
}

// The scene's point lights, as plain numbers (the shader side is in lightNodes.ts).
import { orbAt, type SceneState } from './scene';
import { BASE } from '../game/covemath';

export interface Light { x: number; y: number; z: number; radius: number; r: number; g: number; b: number; shadow: boolean }
export const MAX_LIGHTS = 8;
export const AMBIENT: [number, number, number] = [0.075, 0.08, 0.125];
/** Daylight and work lighting: a bright flat ambient. */
export const WORK_AMBIENT: [number, number, number] = [0.9, 0.9, 0.9];
/** The wall top's colour. */
export const STONE: readonly [number, number, number] = [0.115, 0.1, 0.145];
/** The painter's base grass colour (0..1), shown by the ground until its image is set. */
export const GRASS_FLAT: [number, number, number] = [BASE[0] / 255, BASE[1] / 255, BASE[2] / 255];
export const WOODLAND_CLEAR: [number, number, number] = [0.05, 0.11, 0.06];

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** The shader's shoulder, in JS, for the clear colour. */
export function shoulder(c: number): number {
  const k = smoothstep(0.55, 1.1, c);
  return c * (1 - k) + (1 - Math.exp(-1.6 * c)) * k;
}
/** The colour of a lit wall top, for the clear colour. */
export function stoneClear(ambient: [number, number, number]): [number, number, number] {
  return [shoulder(STONE[0] * ambient[0]), shoulder(STONE[1] * ambient[1]), shoulder(STONE[2] * ambient[2])];
}

/** A colour (0..1 per channel, written to the canvas as is) as a CSS colour, bytes rounded. */
export function cssColour(c: readonly [number, number, number]): string {
  const b = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${b(c[0])}, ${b(c[1])}, ${b(c[2])})`;
}

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

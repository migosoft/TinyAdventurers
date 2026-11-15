// The air's quads (#307): `AirParts` into the vertex arrays of the two air meshes (additive and blended) and the haze sheets. Pure, no GPU.
// Six vertices per quad. `position` is the quad's centre; the shader spreads the corners (`corner`, -1..1) by `size` (tiles) along the camera's
// right and up (flat in x and z for a ring), so the quads stay round on screen.
import type { Footprint } from '../lights';
import { PX } from './airCtx';
import { DROP_ASPECT, type AirParts } from './airParts';
import { DROP_RGB } from './drips';

/** The quad kinds, as the shaders read them. */
export const KIND = { speck: 0, ember: 1, puff: 2, ring: 3, pixel: 4 } as const;

/** One mesh's vertex arrays (`position` 3, `corner` 2, `size` 2, `rgba` 4, `kind` 1, `sightXZ` 2 floats per vertex). */
export interface AirBuf {
  position: Float32Array; corner: Float32Array; size: Float32Array; rgba: Float32Array; kind: Float32Array; sightXZ: Float32Array;
}
export interface AirBuffers { add: AirBuf; blend: AirBuf }

const START_VERTS = 1536;

function newBuf(verts: number): AirBuf {
  return { position: new Float32Array(verts * 3), corner: new Float32Array(verts * 2), size: new Float32Array(verts * 2), rgba: new Float32Array(verts * 4), kind: new Float32Array(verts), sightXZ: new Float32Array(verts * 2) };
}

export const newAirBuffers = (): AirBuffers => ({ add: newBuf(START_VERTS), blend: newBuf(START_VERTS) });

function grown(a: Float32Array, len: number): Float32Array {
  const b = new Float32Array(len);
  b.set(a);
  return b;
}

/** Room for `verts` vertices in `b` (the arrays double until they fit). */
function ensure(b: AirBuf, verts: number): void {
  let cap = b.kind.length;
  if (verts <= cap) return;
  while (cap < verts) cap *= 2;
  b.position = grown(b.position, cap * 3);
  b.corner = grown(b.corner, cap * 2);
  b.size = grown(b.size, cap * 2);
  b.rgba = grown(b.rgba, cap * 4);
  b.kind = grown(b.kind, cap);
  b.sightXZ = grown(b.sightXZ, cap * 2);
}

const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];

/** Writes one quad at vertex `v` of `b`. */
function put(b: AirBuf, v: number, kind: number, x: number, y: number, z: number, sx: number, sy: number, r: number, g: number, bl: number, a: number, sightX: number, sightZ: number): void {
  for (let i = 0; i < 6; i++) {
    const j = v + i;
    b.position[j * 3] = x; b.position[j * 3 + 1] = y; b.position[j * 3 + 2] = z;
    b.corner[j * 2] = CORNERS[i * 2]; b.corner[j * 2 + 1] = CORNERS[i * 2 + 1];
    b.size[j * 2] = sx; b.size[j * 2 + 1] = sy;
    b.rgba[j * 4] = r; b.rgba[j * 4 + 1] = g; b.rgba[j * 4 + 2] = bl; b.rgba[j * 4 + 3] = a;
    b.kind[j] = kind;
    b.sightXZ[j * 2] = sightX; b.sightXZ[j * 2 + 1] = sightZ;
  }
}

/** The ring's quad reaches this far (tiles) beyond its radius, so its one-pixel line is not cut at the quad's edge; the shader takes it off again. */
export const RING_PAD = PX;

const DROP_R = ((DROP_RGB >> 16) & 255) / 255, DROP_G = ((DROP_RGB >> 8) & 255) / 255, DROP_B = (DROP_RGB & 255) / 255;

/**
 * Fills `out` from `parts` and returns the vertex counts of the additive mesh (specks, embers) and the blended mesh (smoke, rings, drops
 * and splash pixels). Things without a sight point of their own (all but the puffs) read the mask at their own x and z. A speck is one
 * art pixel; its colour and light are the shader's (the rgba is white with the speck's alpha).
 */
export function airQuads(parts: AirParts, out: AirBuffers): { add: number; blend: number } {
  const { specks, embers, puffs, rings, drops } = parts;
  ensure(out.add, (specks.count + embers.count) * 6);
  ensure(out.blend, (puffs.count + rings.count + drops.count) * 6);
  let a = 0, b = 0;
  for (let i = 0; i < specks.count; i++, a += 6) {
    const x = specks.pos[i * 3], y = specks.pos[i * 3 + 1], z = specks.pos[i * 3 + 2];
    put(out.add, a, KIND.speck, x, y, z, PX, PX, 1, 1, 1, specks.alpha[i], x, z);
  }
  for (let i = 0; i < embers.count; i++, a += 6) {
    const x = embers.pos[i * 3], z = embers.pos[i * 3 + 2], s = embers.size[i];
    put(out.add, a, KIND.ember, x, embers.pos[i * 3 + 1], z, s, s, embers.rgba[i * 4], embers.rgba[i * 4 + 1], embers.rgba[i * 4 + 2], embers.rgba[i * 4 + 3], x, z);
  }
  for (let i = 0; i < puffs.count; i++, b += 6) {
    const s = puffs.size[i];
    put(out.blend, b, KIND.puff, puffs.pos[i * 3], puffs.pos[i * 3 + 1], puffs.pos[i * 3 + 2], s, s, puffs.rgba[i * 4], puffs.rgba[i * 4 + 1], puffs.rgba[i * 4 + 2], puffs.rgba[i * 4 + 3], puffs.sight[i * 2], puffs.sight[i * 2 + 1]);
  }
  for (let i = 0; i < rings.count; i++, b += 6) {
    const x = rings.pos[i * 3], z = rings.pos[i * 3 + 2], d = (rings.radius[i] + RING_PAD) * 2;
    put(out.blend, b, KIND.ring, x, rings.pos[i * 3 + 1], z, d, d, DROP_R, DROP_G, DROP_B, rings.alpha[i], x, z);
  }
  for (let i = 0; i < drops.count; i++, b += 6) {
    const x = drops.pos[i * 3], z = drops.pos[i * 3 + 2], w = drops.size[i];
    put(out.blend, b, KIND.pixel, x, drops.pos[i * 3 + 1], z, w, drops.splash[i] ? w : w * DROP_ASPECT, DROP_R, DROP_G, DROP_B, drops.alpha[i], x, z);
  }
  return { add: a, blend: b };
}

/** The haze sheets' heights above the floor (tiles; first guess). */
export const HAZE_Y = [0.35, 0.9] as const;
/**
 * The two haze sheets: alpha, scale, and drift (px/s, x and z) of the cloud pattern. Scale and drift are the 2D `HAZE`'s;
 * the alphas are 3x the 2D ones (0.1 and 0.07 barely showed in 3D; the user's play-test, first guess).
 */
export const HAZE = [[0.3, 1.6, 2.2, 0.6], [0.21, 1.1, -1.4, 1.1]] as const;
/** Tiles the haze sheets reach beyond the view. */
export const HAZE_GROW = 2;

/** Two quads (12 vertices) over `fp` grown by `HAZE_GROW`: `position` (xyz) and `sheet` (the sheet's `HAZE` row) per vertex. */
export function hazeQuads(fp: Footprint, position: Float32Array, sheet: Float32Array): void {
  const x0 = fp.x0 - HAZE_GROW, x1 = fp.x1 + HAZE_GROW, z0 = fp.z0 - HAZE_GROW, z1 = fp.z1 + HAZE_GROW;
  const xs = [x0, x1, x1, x0, x1, x0], zs = [z0, z0, z1, z0, z1, z1];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < 6; i++) {
      const v = s * 6 + i;
      position[v * 3] = xs[i]; position[v * 3 + 1] = HAZE_Y[s]; position[v * 3 + 2] = zs[i];
      sheet.set(HAZE[s], v * 4);
    }
  }
}

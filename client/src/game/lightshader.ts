// The light pass on the GPU: pure helpers (texel packing, the fragment source).
// No value import of Phaser here (type only); the Shader game object is built elsewhere.
import type Phaser from 'phaser';

/** Picture px per tile (the lattice the shader renders). */
export const PIC_SUB = 2;

const byte = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

/** Writes texel `i` of the light data texture: tint r, g, b (0..255) and darkness (0..255 = tileDark * 255). */
export function packTile(dst: Uint8Array, i: number, r: number, g: number, b: number, dark: number): void {
  const o = i * 4;
  dst[o] = byte(r);
  dst[o + 1] = byte(g);
  dst[o + 2] = byte(b);
  dst[o + 3] = byte(dark);
}

/** Writes texel `i` of the darkvision data texture: strength (0..255) in red, alpha 255. */
export function packDv(dst: Uint8Array, i: number, strength: number): void {
  const o = i * 4;
  dst[o] = byte(strength);
  dst[o + 1] = 0;
  dst[o + 2] = 0;
  dst[o + 3] = 255;
}

/**
 * The fragment source (GLSL ES 1.00) that turns the per-tile data texture
 * `iChannel0` into the PIC_SUB px-per-tile picture: Catmull-Rom of the four
 * by four taps (as `upsample`), then dark tiles black (as `blackenDarkTiles`).
 * With `dv`: only the red channel, no blackening (the darkvision mask).
 * `fragCoord` is in pixels of the picture; row r of the picture is map row r.
 */
export function lightFrag(dv: boolean): string {
  return `${dv ? '#define DV\n' : ''}precision mediump float;
uniform sampler2D iChannel0;
uniform vec2 uTiles;
varying vec2 fragCoord;

// The same polynomials as catmullRom in lightview.ts (a unit test compares them).
vec4 catmullRom(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4((-t3 + 2.0 * t2 - t) * 0.5, (3.0 * t3 - 5.0 * t2 + 2.0) * 0.5, (-3.0 * t3 + 4.0 * t2 + t) * 0.5, (t3 - t2) * 0.5);
}

vec4 tap(float x, float y) {
  vec2 c = vec2(clamp(x, 0.0, uTiles.x - 1.0), clamp(y, 0.0, uTiles.y - 1.0));
  return texture2D(iChannel0, (c + 0.5) / uTiles);
}

void main() {
  vec2 p = fragCoord / ${PIC_SUB.toFixed(1)} - 0.5;
  vec2 i = floor(p);
  vec2 t = p - i;
  vec4 wx = catmullRom(t.x);
  vec4 wy = catmullRom(t.y);
  vec4 sum = vec4(0.0);
  for (int ky = 0; ky < 4; ky++) {
    float wyk = ky == 0 ? wy.x : ky == 1 ? wy.y : ky == 2 ? wy.z : wy.w;
    vec4 row = vec4(0.0);
    for (int kx = 0; kx < 4; kx++) {
      float wxk = kx == 0 ? wx.x : kx == 1 ? wx.y : kx == 2 ? wx.z : wx.w;
      row += wxk * tap(i.x + float(kx) - 1.0, i.y + float(ky) - 1.0);
    }
    sum += wyk * row;
  }
  sum = clamp(sum, 0.0, 1.0);
#ifdef DV
  gl_FragColor = vec4(sum.r, 0.0, 0.0, 1.0);
#else
  vec2 own = floor(fragCoord / ${PIC_SUB.toFixed(1)});
  float ownDark = texture2D(iChannel0, (own + 0.5) / uTiles).a;
  if (ownDark >= 254.5 / 255.0) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  else gl_FragColor = vec4(sum.rgb * (1.0 - sum.a), 1.0);
#endif
}
`;
}

/** Where LightView's per-tile result goes. dark, r, g, b and dv are 0..255; dv is 0 while darkvision is off. */
export interface LightOutput {
  readonly mask: Phaser.Textures.Texture; // what DarkvisionFX samples (2 px per tile, red = strength, LINEAR)
  put(i: number, dark: number, r: number, g: number, b: number, dv: number): void;
  flush(x0: number, y0: number, x1: number, y1: number, dv: boolean): void; // tile window; dv: darkvision > 0 this frame
}

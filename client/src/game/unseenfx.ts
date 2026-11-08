// The haze post effect for daylight maps (#278): where the vision mask's canvas says "unseen", the
// rendered world is blurred a little, washed toward a pale grey-blue and desaturated, instead of
// darkened. The mask (visionmask.ts in haze mode) is a CanvasTexture over the camera window, LINEAR
// filtered, holding the unseen strength as 1 - red; it covers the window with a border, so no edge
// clamping is needed. Attached only on daylight maps.
import Phaser from 'phaser';

/** The pipeline's name, as registered with `pipelines.addPostPipeline`. */
export const UNSEEN_FX = 'UnseenFX';

/** What unseen ground looks like. `blurPx` is in world pixels (the canvas is at screen resolution and the integer zoom lives on the camera). */
export interface HazeLook {
  /** Unseen strength beyond sight (0..1; read by VisionMask.outside). */
  outside: number;
  /** Unseen strength behind a soft blocker such as a trunk (read by VisionMask.soft). */
  soft: number;
  /** The wash colour, 0xRRGGBB. */
  colour: number;
  /** How far full unseen strength moves the colour toward `colour`. */
  mix: number;
  /** How far full unseen strength moves the colour toward grey. */
  desat: number;
  /** Blur tap distance at full strength, in world pixels. */
  blurPx: number;
}

/** First guess, tuned on the phone. */
export const DEFAULT_HAZE: HazeLook = { outside: 1.0, soft: 0.7, colour: 0xb8c4cc, mix: 0.45, desat: 0.6, blurPx: 1.5 };

/** The shader uniforms for a look on a render target of `targetW`×`targetH` texels at camera `zoom`. */
export function hazeUniforms(
  look: HazeLook,
  targetW: number,
  targetH: number,
  zoom: number,
): { colour: [number, number, number]; mix: number; desat: number; blur: [number, number] } {
  const c = look.colour;
  return {
    colour: [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255],
    mix: look.mix,
    desat: look.desat,
    blur: [(look.blurPx * zoom) / targetW, (look.blurPx * zoom) / targetH],
  };
}

/**
 * The mask UV as an affine function of the screen's texture coordinate t (x right, y down):
 * uv = xy + t * zw. Prepared on the CPU in doubles: absolute world px in a mediump shader would
 * step by 2 px at 2400+ px and make the mask's edge stair-stepped.
 */
export function maskTransform(
  view: { x: number; y: number; width: number; height: number },
  rect: { x: number; y: number; w: number; h: number },
): [number, number, number, number] {
  return [(view.x - rect.x) / rect.w, (view.y - rect.y) / rect.h, view.width / rect.w, view.height / rect.h];
}

// outTexCoord covers the camera's render target, y up; the mask canvas rows go down the world.
const FRAG = `
#define SHADER_NAME UNSEEN_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform sampler2D uMask;
uniform vec4 uMaskXf; // mask uv = xy + (x, 1 - y of outTexCoord) * zw (maskTransform)
uniform vec3 uColour;
uniform float uMix;
uniform float uDesat;
uniform vec2 uBlur;   // tap distance at full strength, in texture coordinates
varying vec2 outTexCoord;
void main() {
  vec2 uv = uMaskXf.xy + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uMaskXf.zw;
  float u = 1.0 - texture2D(uMask, uv).r;
  vec4 c0 = texture2D(uMainSampler, outTexCoord);
  vec3 c = c0.rgb;
  if (u > 0.001) {
    vec2 d = u * uBlur;
    vec3 sum = c;
    sum += texture2D(uMainSampler, outTexCoord + vec2(-d.x, -d.y)).rgb;
    sum += texture2D(uMainSampler, outTexCoord + vec2(0.0, -d.y)).rgb;
    sum += texture2D(uMainSampler, outTexCoord + vec2(d.x, -d.y)).rgb;
    sum += texture2D(uMainSampler, outTexCoord + vec2(-d.x, 0.0)).rgb;
    sum += texture2D(uMainSampler, outTexCoord + vec2(d.x, 0.0)).rgb;
    sum += texture2D(uMainSampler, outTexCoord + vec2(-d.x, d.y)).rgb;
    sum += texture2D(uMainSampler, outTexCoord + vec2(0.0, d.y)).rgb;
    sum += texture2D(uMainSampler, outTexCoord + vec2(d.x, d.y)).rgb;
    c = sum / 9.0;
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, vec3(g), u * uDesat);
    c = mix(c, uColour, u * uMix);
  }
  gl_FragColor = vec4(c, c0.a);
}`;

/** Hazes the world where the vision mask's canvas is not white. */
export class UnseenFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  mask?: Phaser.Textures.CanvasTexture;
  rect = { x: 0, y: 0, w: 1, h: 1 };
  look: HazeLook = DEFAULT_HAZE;

  constructor(game: Phaser.Game) {
    super({ game, name: UNSEEN_FX, fragShader: FRAG });
  }

  onDraw(target: Phaser.Renderer.WebGL.RenderTarget): void {
    // For a camera post pipeline, Phaser sets `gameObject` to the camera.
    const cam = this.gameObject as Phaser.Cameras.Scene2D.Camera | undefined;
    const v = cam?.worldView;
    // A destroyed canvas texture has no sources (the mask was rebuilt): skip the effect this frame.
    const tex = this.mask?.source[0]?.glTexture;
    if (tex && v && cam) {
      const u = hazeUniforms(this.look, target.width, target.height, cam.zoom);
      const xf = maskTransform(v, this.rect);
      this.set4f('uMaskXf', xf[0], xf[1], xf[2], xf[3]);
      this.set3f('uColour', u.colour[0], u.colour[1], u.colour[2]);
      this.set1f('uMix', u.mix);
      this.set1f('uDesat', u.desat);
      this.set2f('uBlur', u.blur[0], u.blur[1]);
      this.bindTexture(tex, 1);
      this.set1i('uMask', 1);
    } else {
      // no mask this frame: draw the world unchanged
      this.set1f('uMix', 0);
      this.set1f('uDesat', 0);
      this.set2f('uBlur', 0, 0);
    }
    this.bindAndDraw(target);
  }
}

/** Attaches the effect to `cam` while `on` and removes it otherwise; hands it the mask canvas, its world rectangle and the look (call every frame: the canvas can be rebuilt). */
export function syncUnseenFX(
  cam: Phaser.Cameras.Scene2D.Camera,
  on: boolean,
  mask: Phaser.Textures.CanvasTexture | undefined,
  rect: { x: number; y: number; w: number; h: number },
  look: HazeLook,
): void {
  const has = cam.postPipelines.some((p) => p.name === UNSEEN_FX);
  if (on && mask) {
    if (!has) cam.setPostPipeline(UNSEEN_FX);
    const fx = cam.getPostPipeline(UNSEEN_FX) as UnseenFX;
    fx.mask = mask;
    fx.rect = rect;
    fx.look = look;
  } else if (has) cam.removePostPipeline(UNSEEN_FX);
}

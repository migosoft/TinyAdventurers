// The greyscale post effect for darkvision: on the main camera, it desaturates
// the rendered world where LightView's darkvision mask is set (tiles the hero
// sees only by darkvision, heroes and monsters standing there included). The
// mask is a CanvasTexture of the whole map, SUB px per tile, LINEAR filtered,
// so its edge fades over about a tile. Attached only while darkvision > 0.
import Phaser from 'phaser';

/** The pipeline's name, as registered in the game config (`pipeline: { [DARKVISION_FX]: DarkvisionFX }`). */
export const DARKVISION_FX = 'DarkvisionFX';

// outTexCoord covers the camera's render target, y up (0 = the bottom of the
// screen); the mask's canvas rows go down the map from row 0.
const FRAG = `
#define SHADER_NAME DARKVISION_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform sampler2D uMask;
uniform vec4 uView;   // the camera's worldView: x, y, width, height (px)
uniform vec2 uMapPx;  // the map's size (px)
varying vec2 outTexCoord;
void main() {
  vec4 c = texture2D(uMainSampler, outTexCoord);
  vec2 world = uView.xy + vec2(outTexCoord.x, 1.0 - outTexCoord.y) * uView.zw;
  float m = texture2D(uMask, world / uMapPx).r;
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(c.rgb, vec3(g), m), c.a);
}`;

/** Greys the world where the hero sees only by darkvision (mask from LightView). */
export class DarkvisionFX extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  mask?: Phaser.Textures.CanvasTexture;
  mapPx: [number, number] = [1, 1];

  constructor(game: Phaser.Game) {
    super({ game, name: DARKVISION_FX, fragShader: FRAG });
  }

  onDraw(target: Phaser.Renderer.WebGL.RenderTarget): void {
    // For a camera post pipeline, Phaser sets `gameObject` to the camera.
    const cam = this.gameObject as Phaser.Cameras.Scene2D.Camera | undefined;
    const v = cam?.worldView;
    const tex = this.mask?.source[0].glTexture;
    if (tex && v) {
      this.set4f('uView', v.x, v.y, v.width, v.height);
      this.set2f('uMapPx', this.mapPx[0], this.mapPx[1]);
      this.bindTexture(tex, 1);
      this.set1i('uMask', 1);
    }
    this.bindAndDraw(target);
  }
}

/** Attaches the effect to `cam` while `darkvision` > 0 and removes it at 0 (no cost in normal play). */
export function syncDarkvisionFX(cam: Phaser.Cameras.Scene2D.Camera, darkvision: number, mask: Phaser.Textures.CanvasTexture, mapPx: [number, number]): void {
  const has = cam.postPipelines.some((p) => p.name === DARKVISION_FX);
  if (darkvision > 0 && !has) {
    cam.setPostPipeline(DARKVISION_FX);
    const fx = cam.getPostPipeline(DARKVISION_FX) as DarkvisionFX;
    fx.mask = mask;
    fx.mapPx = mapPx;
  } else if (darkvision <= 0 && has) cam.removePostPipeline(DARKVISION_FX);
}

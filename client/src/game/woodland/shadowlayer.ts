// The woodland's ground shadows: one map-sized render texture the plants' solid shadow rasters are stamped into
// (opaque inside, so overlapping shadows do not stack), shown at SHADOW_ALPHA as a whole.
import type Phaser from 'phaser';
import { DEPTH } from '../effects';
import { SHADOW_ALPHA } from './shadows';

/** True when a map of this size fits one texture of side `max`. */
export function fits(mapPx: { w: number; h: number }, max: number): boolean {
  return mapPx.w <= max && mapPx.h <= max;
}

export class ShadowLayer {
  /** False when the map does not fit a texture: nothing is drawn. */
  readonly ok: boolean;
  private rt?: Phaser.GameObjects.RenderTexture;

  constructor(scene: Phaser.Scene, mapPx: { w: number; h: number }) {
    const max = (scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).getMaxTextureSize?.() ?? 0;
    this.ok = fits(mapPx, max);
    if (!this.ok) { console.warn(`woodland: no plant shadows, the map (${mapPx.w}x${mapPx.h}) exceeds the texture limit ${max}`); return; }
    this.rt = scene.add.renderTexture(0, 0, mapPx.w, mapPx.h).setOrigin(0).setDepth(DEPTH.plantShadow).setAlpha(SHADOW_ALPHA);
  }

  /** Draws a frame of an uploaded texture with its top-left at (x, y) in map pixels. */
  stamp(textureKey: string, frame: string, x: number, y: number): void {
    this.rt?.drawFrame(textureKey, frame, x, y);
  }

  set visible(v: boolean) { this.rt?.setVisible(v); }
  set alpha(a: number) { this.rt?.setAlpha(a); }

  destroy(): void {
    this.rt?.destroy();
    this.rt = undefined;
  }
}

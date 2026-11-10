// The woodland's ground shadows: one map-sized render texture the plants' solid shadow rasters are stamped into
// (opaque inside, so overlapping shadows do not stack), shown at SHADOW_ALPHA as a whole.
import type Phaser from 'phaser';
import { onContextRestored } from '../contextrestore';
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
  /** Every stamp so far, to draw them again after a restored WebGL context recreates the texture empty (#298). */
  private stamps: { key: string; frame: string; x: number; y: number }[] = [];
  private offRestore = () => {};

  constructor(scene: Phaser.Scene, mapPx: { w: number; h: number }) {
    const max = (scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).getMaxTextureSize?.() ?? 0;
    this.ok = fits(mapPx, max);
    if (!this.ok) { console.warn(`woodland: no plant shadows, the map (${mapPx.w}x${mapPx.h}) exceeds the texture limit ${max}`); return; }
    this.rt = scene.add.renderTexture(0, 0, mapPx.w, mapPx.h).setOrigin(0).setDepth(DEPTH.plantShadow).setAlpha(SHADOW_ALPHA);
    this.offRestore = onContextRestored(scene, () => {
      const rt = this.rt;
      if (!rt) return;
      rt.clear();
      rt.beginDraw();
      for (const s of this.stamps) rt.batchDrawFrame(s.key, s.frame, s.x, s.y);
      rt.endDraw();
    });
  }

  /** Draws a frame of an uploaded texture with its top-left at (x, y) in map pixels. */
  stamp(textureKey: string, frame: string, x: number, y: number): void {
    if (!this.rt) return;
    this.rt.drawFrame(textureKey, frame, x, y);
    this.stamps.push({ key: textureKey, frame, x, y });
  }

  set visible(v: boolean) { this.rt?.setVisible(v); }
  set alpha(a: number) { this.rt?.setAlpha(a); }

  destroy(): void {
    this.offRestore();
    this.rt?.destroy();
    this.rt = undefined;
  }
}

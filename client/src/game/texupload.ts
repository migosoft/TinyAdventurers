// Partial uploads of a canvas texture (#292): only a rectangle of a whole-map
// image goes to the GPU, with texSubImage2D, instead of CanvasTexture.refresh(),
// which re-uploads the whole canvas. Phaser has no API for this, so it is a
// direct WebGL call on the texture's WebGLTexture, with the same pixel-store
// settings Phaser uses for that texture (premultiplied alpha, no flip). The
// canvas itself is not written: whatever the GPU texture holds outside the
// rectangle stays as it was.
import type Phaser from 'phaser';

/** Copies the rectangle [px, py, pw, ph] of RGBA pixels `src` (`sw` px per row) into `dst` (pw × ph × 4, rows packed). */
export function copyWindow(src: Uint8ClampedArray, sw: number, px: number, py: number, pw: number, ph: number, dst: Uint8ClampedArray): void {
  for (let y = 0; y < ph; y++) {
    const s = ((py + y) * sw + px) * 4;
    dst.set(src.subarray(s, s + pw * 4), y * pw * 4);
  }
}

/** Uploads a window of a whole-texture `ImageData` into one canvas texture. Keeps a window-sized buffer between calls. */
export class WindowUpload {
  private win?: ImageData;
  constructor(private gl: WebGLRenderingContext | undefined, private tex: Phaser.Textures.CanvasTexture) {}

  /** `src` covers the whole texture; [px, py, pw, ph] (canvas px) is the part that changed. */
  upload(src: ImageData, px: number, py: number, pw: number, ph: number): void {
    const gl = this.gl;
    const wrapper = this.tex.source[0].glTexture;
    if (!gl || !wrapper?.webGLTexture || pw <= 0 || ph <= 0 || gl.isContextLost()) return;
    if (!this.win || this.win.width !== pw || this.win.height !== ph) this.win = new ImageData(pw, ph);
    copyWindow(src.data, src.width, px, py, pw, ph, this.win.data);
    gl.activeTexture(gl.TEXTURE0);
    const bound = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    gl.bindTexture(gl.TEXTURE_2D, wrapper.webGLTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, wrapper.pma);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, wrapper.flipY);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, gl.RGBA, gl.UNSIGNED_BYTE, this.win);
    gl.bindTexture(gl.TEXTURE_2D, bound);
  }
}

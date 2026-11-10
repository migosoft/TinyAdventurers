// Partial uploads of a texture (#292, #293): only a rectangle of a larger
// image goes to the GPU, with texSubImage2D, instead of CanvasTexture.refresh()
// or a whole-texture re-upload. Phaser has no API for this, so it is a direct
// WebGL call on the texture's WebGLTexture, with the same pixel-store settings
// Phaser uses for that texture (premultiplied alpha, flip). The source (a
// canvas ImageData or a plain RGBA byte array) is not written: whatever the GPU
// texture holds outside the rectangle stays as it was.
import type Phaser from 'phaser';

type Bytes = Uint8Array | Uint8ClampedArray;

/** Copies the rectangle [px, py, pw, ph] of RGBA pixels `src` (`sw` px per row) into `dst` (pw × ph × 4, rows packed). */
export function copyWindow(src: Bytes, sw: number, px: number, py: number, pw: number, ph: number, dst: Bytes): void {
  for (let y = 0; y < ph; y++) {
    const s = ((py + y) * sw + px) * 4;
    dst.set(src.subarray(s, s + pw * 4), y * pw * 4);
  }
}

/** Uploads a window of a whole-texture `ImageData` or RGBA byte array into one texture. Keeps a window-sized buffer between calls. */
export class WindowUpload {
  private win?: ImageData;
  private bytes?: Uint8Array;
  constructor(private gl: WebGLRenderingContext | undefined, private tex: Phaser.Textures.Texture) {}

  /** `src` covers the whole texture; [px, py, pw, ph] (texels) is the part that changed. */
  upload(src: ImageData | { data: Uint8Array; width: number }, px: number, py: number, pw: number, ph: number): void {
    const gl = this.gl;
    const wrapper = this.tex.source[0].glTexture;
    if (!gl || !wrapper?.webGLTexture || pw <= 0 || ph <= 0 || gl.isContextLost()) return;
    const image = src instanceof ImageData;
    if (image) {
      if (!this.win || this.win.width !== pw || this.win.height !== ph) this.win = new ImageData(pw, ph);
      copyWindow(src.data, src.width, px, py, pw, ph, this.win.data);
    } else {
      if (!this.bytes || this.bytes.length !== pw * ph * 4) this.bytes = new Uint8Array(pw * ph * 4);
      copyWindow(src.data, src.width, px, py, pw, ph, this.bytes);
    }
    gl.activeTexture(gl.TEXTURE0);
    const bound = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    gl.bindTexture(gl.TEXTURE_2D, wrapper.webGLTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, wrapper.pma);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, wrapper.flipY);
    if (image) gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, gl.RGBA, gl.UNSIGNED_BYTE, this.win!);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, this.bytes!);
    gl.bindTexture(gl.TEXTURE_2D, bound);
  }
}

// The GPU light path (#293): the per-tile result goes into a small RGBA data
// texture (tint r, g, b and darkness in alpha, one texel per tile; only the
// camera window is uploaded, texupload.ts), and a fragment shader (lightshader.ts)
// renders the PIC_SUB px-per-tile picture from it into a texture, drawn as one
// MULTIPLY Image at DEPTH.fog, scaled up by TILE / PIC_SUB with LINEAR filtering.
//
// The Shader is not in the display list: it is drawn by hand from `flush`, which
// runs in the scene's update. A Shader in the list would unbind a camera effect's
// framebuffer (UnseenFX, DarkvisionFX) and paint over everything after it.
import Phaser from 'phaser';
import { TILE } from '../sim/map';
import { DEPTH } from './effects';
import { lightFrag, packDv, packTile, PIC_SUB } from './lightshader';
import { WindowUpload } from './texupload';

// Phaser's FilterMode.LINEAR, BlendModes.NORMAL and MULTIPLY as numbers (the tests mock Phaser, so no module-level reads of its enums).
const LINEAR = 0;
const NORMAL = 0;
const MULTIPLY = 2;

const KEYS = ['lightdata', 'dvdata', 'lightpic', 'dvpic'];

/** Where LightView's per-tile result goes (`put`, then `flush` for the window). dark, r, g, b and dv are 0..255; dv is 0 while darkvision is off. */
export class GpuLight {
  /** The darkvision picture (red = strength) that DarkvisionFX samples; never shown as an Image. */
  readonly mask: Phaser.Textures.Texture;
  private data: Uint8Array;
  private dvData: Uint8Array;
  private shader: Phaser.GameObjects.Shader;
  private dvShader: Phaser.GameObjects.Shader;
  private upload: WindowUpload;
  private dvUpload: WindowUpload;
  /** Whether the previous flush had darkvision on: then `put` also clears tiles that left its reach. */
  private dvWas = false;
  private renderer: Phaser.Renderer.WebGL.WebGLRenderer;

  constructor(scene: Phaser.Scene, private w: number, h: number) {
    for (const k of KEYS) if (scene.textures.exists(k)) scene.textures.remove(k);
    this.renderer = scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    // Dark until drawn.
    this.data = new Uint8Array(w * h * 4).fill(255);
    const tex = scene.textures.addUint8Array('lightdata', this.data, w, h)!;
    // Our alpha is darkness: no premultiplying on upload (Phaser's default for this texture).
    tex.source[0].glTexture!.pma = false;
    this.upload = new WindowUpload(this.renderer.gl, tex);

    const base = new Phaser.Display.BaseShader('lightpic', lightFrag(false), undefined, { uTiles: { type: '2f', value: { x: w, y: h } } });
    this.shader = scene.add.shader(base, 0, 0, w * PIC_SUB, h * PIC_SUB);
    this.shader.setChannel0('lightdata', { minFilter: 'nearest', magFilter: 'nearest', wrapS: 'clamp_to_edge', wrapT: 'clamp_to_edge' });
    this.shader.setRenderToTexture('lightpic');
    this.shader.removeFromDisplayList();
    scene.textures.get('lightpic').setFilter(LINEAR);
    // setRenderToTexture draws once itself, but under whatever blend mode and scissor are current, which can leave the
    // target empty; our draw() sets both.
    this.draw(this.shader);

    // The darkvision picture: same recipe, red channel only.
    this.dvData = new Uint8Array(w * h * 4);
    for (let i = 3; i < this.dvData.length; i += 4) this.dvData[i] = 255;
    const dvTex = scene.textures.addUint8Array('dvdata', this.dvData, w, h)!;
    dvTex.source[0].glTexture!.pma = false;
    this.dvUpload = new WindowUpload(this.renderer.gl, dvTex);
    const dvBase = new Phaser.Display.BaseShader('dvpic', lightFrag(true), undefined, { uTiles: { type: '2f', value: { x: w, y: h } } });
    this.dvShader = scene.add.shader(dvBase, 0, 0, w * PIC_SUB, h * PIC_SUB);
    this.dvShader.setChannel0('dvdata', { minFilter: 'nearest', magFilter: 'nearest', wrapS: 'clamp_to_edge', wrapT: 'clamp_to_edge' });
    this.dvShader.setRenderToTexture('dvpic');
    this.dvShader.removeFromDisplayList();
    this.mask = scene.textures.get('dvpic');
    this.mask.setFilter(LINEAR);
    this.draw(this.dvShader);

    scene.add.image(0, 0, 'lightpic').setOrigin(0, 0).setScale(TILE / PIC_SUB).setDepth(DEPTH.fog).setBlendMode(MULTIPLY);
    // Outside the display list the Shaders are not destroyed with the scene (that frees their programs, framebuffers and pictures).
    scene.events.once('shutdown', () => {
      this.shader.destroy();
      this.dvShader.destroy();
    });
  }

  put(i: number, dark: number, r: number, g: number, b: number, dv: number): void {
    packTile(this.data, i, r, g, b, dark);
    if (dv > 0 || this.dvWas) packDv(this.dvData, i, dv);
  }

  /** Uploads the tile window [x0,x1)×[y0,y1) and redraws the pictures; `dv`: darkvision > 0 this frame. */
  flush(x0: number, y0: number, x1: number, y1: number, dv: boolean): void {
    this.upload.upload({ data: this.data, width: this.w }, x0, y0, x1 - x0, y1 - y0);
    this.draw(this.shader);
    if (dv) {
      this.dvUpload.upload({ data: this.dvData, width: this.w }, x0, y0, x1 - x0, y1 - y0);
      this.draw(this.dvShader);
    }
    this.dvWas = dv;
  }

  /** What `setRenderToTexture` does once, by hand: the blend mode and scissor of whatever was drawn last must not apply. */
  private draw(s: Phaser.GameObjects.Shader): void {
    const r = this.renderer;
    if (r.contextLost) return;
    r.pipelines.clear();
    r.setBlendMode(NORMAL);
    r.pushScissor(0, 0, s.width, s.height, s.height);
    s.load();
    s.flush();
    r.popScissor();
    r.pipelines.rebind();
  }
}

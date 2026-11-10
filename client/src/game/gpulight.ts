// The GPU light path (#293): the per-tile result goes into a small RGBA data
// texture (tint r, g, b and darkness in alpha, one texel per tile; only the
// camera window is uploaded, texupload.ts), and a fragment shader (lightshader.ts)
// renders the PIC_SUB px-per-tile picture from it into a texture, drawn as one
// MULTIPLY Image at DEPTH.fog, scaled up by TILE / PIC_SUB with LINEAR filtering.
// Behind the LightOutput interface, like CpuLight (lightcpu.ts).
//
// The Shader is not in the display list: it is drawn by hand from `flush`, which
// runs in the scene's update. A Shader in the list would unbind a camera effect's
// framebuffer (UnseenFX, DarkvisionFX) and paint over everything after it.
import Phaser from 'phaser';
import { TILE } from '../sim/map';
import { DEPTH } from './effects';
import { lightFrag, packTile, PIC_SUB, type LightOutput } from './lightshader';
import { WindowUpload } from './texupload';

// Phaser's FilterMode.LINEAR, BlendModes.NORMAL and MULTIPLY as numbers (as in lightcpu.ts).
const LINEAR = 0;
const NORMAL = 0;
const MULTIPLY = 2;

const KEYS = ['lightdata', 'dvdata', 'lightpic', 'dvpic'];

export class GpuLight implements LightOutput {
  // Task 5: the darkvision picture; until then DarkvisionFX gets the light picture (wrong grey with darkvision on).
  readonly mask: Phaser.Textures.Texture;
  private data: Uint8Array;
  private shader: Phaser.GameObjects.Shader;
  private upload: WindowUpload;
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
    this.mask = scene.textures.get('lightpic');
    this.mask.setFilter(LINEAR);
    this.draw();

    scene.add.image(0, 0, 'lightpic').setOrigin(0, 0).setScale(TILE / PIC_SUB).setDepth(DEPTH.fog).setBlendMode(MULTIPLY);
    // Outside the display list the Shader is not destroyed with the scene (that frees its program, framebuffer and picture).
    scene.events.once('shutdown', () => this.shader.destroy());
  }

  put(i: number, dark: number, r: number, g: number, b: number, _dv: number): void {
    packTile(this.data, i, r, g, b, dark);
  }

  flush(x0: number, y0: number, x1: number, y1: number, _dv: boolean): void {
    this.upload.upload({ data: this.data, width: this.w }, x0, y0, x1 - x0, y1 - y0);
    this.draw();
  }

  /** What `setRenderToTexture` does once, by hand: the blend mode and scissor of whatever was drawn last must not apply. */
  private draw(): void {
    const r = this.renderer;
    const s = this.shader;
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

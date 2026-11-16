// One frame's effects, from the system to the view's two buffers (#308): the glue the run and the `?r3d=fx` page share. It fills the
// context, runs `Effects3d.frame`, appends the effect glows to the figures' glow quads and sorts the triangles into the buffers
// `FrameInput.fx` takes. The lights are left in `out.lights` for the caller's candidate list. Nothing is allocated per frame.
import type { Snapshot } from '../../generated/Snapshot';
import type { EntState } from '../../game/world';
import type { OwnCast, ShotView } from '../../run/view';
import type { Cam } from '../camera';
import type { Footprint } from '../lights';
import { registerHazards } from './hazards';
import { registerStatus } from './status';
import { newGlowBuf, type GlowBuf } from '../cards';
import { newFxBuf, type FxBuf } from '../models/fx';
import type { Quality } from '../quality';
import type { Effects3d, FxFrame } from './effects3d';
import { registerBooms } from './booms';
import { registerBursts } from './bursts';
import { registerField } from './field';
import { registerFigureFx } from './figureFx';
import { registerRunes } from './runes';
import { registerShots } from './shots';
import type { MV3 } from './shapes';
import { FxTris } from './tris';
import { FX_LIT_CAP, FX_TRI_CAP, type DrawnFig, type FxCtx, type FxOut, type MimicCue } from './types';

export interface FxPassIn {
  cam: Cam;
  /** Seconds, the clock the records were stamped with. */
  now: number;
  quality: Quality;
  figs: readonly DrawnFig[];
  ents: ReadonlyMap<number, EntState>;
  shots: readonly ShotView[];
  hiddenShots: ReadonlySet<number>;
  snap: Snapshot | undefined;
  hidden: ReadonlySet<number>;
  you: number;
  ownCast: OwnCast | null;
  /** The mimics' one-shot cues of this frame (`FigureOut.cues`). */
  cues?: readonly MimicCue[];
  /** The falls into a chasm that began this frame (`FigureOut.falls`). */
  falls?: readonly { id: number; x: number; z: number }[];
  /** The ground the screen shows (tiles). */
  fp?: Footprint;
}

export class FxPass {
  readonly out: FxOut = { tris: new FxTris(FX_TRI_CAP), lit: new FxTris(FX_LIT_CAP), glows: newGlowBuf(), lights: [] };
  /** The sorted triangles, for `FrameInput.fx`. */
  readonly blend: FxBuf = newFxBuf();
  readonly lit: FxBuf = newFxBuf();
  private readonly ctx: FxCtx = { cam: { x: 0, z: 0, pitch: 0, yaw: 0 }, ax: { right: [1, 0, 0], up: [0, 1, 0] }, now: 0, detail: 1, ballDetail: 2 };
  private readonly input: FxFrame;

  constructor(hidden: ReadonlySet<number>) {
    registerRunes();
    registerShots();
    registerBursts();
    registerBooms();
    registerFigureFx();
    registerHazards();
    registerField();
    registerStatus();
    this.input = { ctx: this.ctx, figs: [], ents: new Map(), shots: [], hiddenShots: new Set(), snap: undefined, hidden, you: 0, ownCast: null };
  }

  /** Triangles of the last frame (blended and lit). */
  triCount = 0;
  /** Triangles refused at the caps since the pass began; the F3 line and `window.__r3d.fx` show it, the run check wants 0. */
  droppedTotal = 0;

  /** Books the frame's triangle count and what the caps refused. */
  noteFrame(): void {
    const o = this.out;
    this.triCount = o.tris.n + o.lit.n;
    this.droppedTotal += o.tris.dropped + o.lit.dropped;
  }

  /** Draws the effects of the frame; the effect glows are appended to `glows` (the figures'), before the caller copies it. */
  run(fx: Effects3d, p: FxPassIn, glows: GlowBuf): void {
    const ctx = this.ctx, cam = p.cam;
    ctx.cam = cam;
    const ca = Math.cos(cam.yaw), sa = Math.sin(cam.yaw), spa = Math.sin(cam.pitch);
    const ax = ctx.ax as { right: MV3; up: MV3 };
    ax.right[0] = ca; ax.right[1] = 0; ax.right[2] = sa;
    ax.up[0] = sa * spa; ax.up[1] = Math.cos(cam.pitch); ax.up[2] = -ca * spa;
    ctx.now = p.now;
    ctx.detail = p.quality === 'high' ? 1 : p.quality === 'balanced' ? 0.7 : 0.5;
    ctx.ballDetail = p.quality === 'fast' ? 1 : 2;
    const fin = this.input;
    fin.figs = p.figs; fin.ents = p.ents; fin.shots = p.shots; fin.hiddenShots = p.hiddenShots; fin.snap = p.snap; fin.you = p.you; fin.ownCast = p.ownCast;
    fin.hidden = p.hidden;
    fin.cues = p.cues;
    fin.falls = p.falls;
    fin.fp = p.fp;
    const out = this.out;
    fx.frame(fin, out);
    this.noteFrame();
    const g = out.glows;
    for (let i = 0; i < g.position.length; i++) glows.position.push(g.position[i]);
    for (let i = 0; i < g.uv.length; i++) glows.uv.push(g.uv[i]);
    for (let i = 0; i < g.color.length; i++) glows.color.push(g.color[i]);
    for (let i = 0; i < g.foot.length; i++) glows.foot.push(g.foot[i]);
    glows.n += g.n;
    for (const b of [this.blend, this.lit]) { b.position.length = 0; b.rgba.length = 0; b.n = 0; }
    out.tris.flush(this.blend, cam, true);
    out.lit.flush(this.lit, cam, true);
  }
}

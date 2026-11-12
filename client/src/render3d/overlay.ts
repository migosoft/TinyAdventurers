// The overlay layer of a 3D run (#311): one Canvas 2D element over the 3D canvas, at the screen's full device resolution, cleared
// and redrawn every frame from the items `overlayLayout.ts` lays out. Never darkened and independent of the render quality. The
// looks are the 2D view's: `WORLD_TEXT` sizes in `FONT_TEXT`, the gold key cap, the effect symbols of the name tags.
import { FONT_TEXT } from '../fonts';
import { WORLD_TEXT, type WorldTextKind } from '../game/worldText';
import { effectIconDataUri } from '../ui/effectIcons';
import { BAR_FRAME, CAP_SIZE, ICON_SIZE, type OverlayItem } from './overlayLayout';

/** The em the width of a text is measured at (any size; the width scales). */
const MEASURE_PX = 100;

export class Overlay3d {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly icons = new Map<string, HTMLImageElement>();
  private readonly widths = new Map<string, number>();

  constructor(el: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'r3d-overlay';
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  /** Sets the backing store to the 3D canvas's size in device px (only when it changes: a resize clears it). */
  size(w: number, h: number): void {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /** The width in art px of `text` in the style of `kind` (cached). */
  measure(text: string, kind: WorldTextKind): number {
    const key = `${kind}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      const ctx = this.ctx;
      if (!ctx) return text.length * WORLD_TEXT[kind].size * 0.55;
      ctx.font = `${WORLD_TEXT[kind].style} ${MEASURE_PX}px ${FONT_TEXT}`;
      w = (ctx.measureText(text).width / MEASURE_PX) * WORLD_TEXT[kind].size;
      this.widths.set(key, w);
    }
    return w;
  }

  /** Clears the layer and draws `items`; `zoom` is canvas px per art px. */
  paint(items: readonly OverlayItem[], zoom: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineJoin = 'round';
    for (const it of items) {
      switch (it.t) {
        case 'bar': this.bar(ctx, it, zoom); break;
        case 'text': this.text(ctx, it, zoom); break;
        case 'cap': this.cap(ctx, it, zoom); break;
        case 'icon': this.icon(ctx, it, zoom); break;
      }
    }
    ctx.globalAlpha = 1;
  }

  private bar(ctx: CanvasRenderingContext2D, it: Extract<OverlayItem, { t: 'bar' }>, zoom: number): void {
    const frame = Math.max(1, Math.round(zoom));
    const w = Math.round(it.w * zoom);
    const h = Math.round(2 * zoom);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BAR_FRAME;
    ctx.fillRect(it.x - frame, it.y - frame, w + 2 * frame, h + 2 * frame);
    ctx.fillStyle = it.color;
    // 2D's fill: whole art px, at least 1.
    ctx.fillRect(it.x, it.y, Math.round(Math.max(1, Math.round(it.w * it.frac)) * zoom), h);
  }

  private text(ctx: CanvasRenderingContext2D, it: Extract<OverlayItem, { t: 'text' }>, zoom: number): void {
    const t = WORLD_TEXT[it.kind];
    ctx.globalAlpha = it.alpha;
    ctx.font = `${t.style} ${t.size * zoom * it.scale}px ${FONT_TEXT}`;
    ctx.textAlign = it.align === 'center' ? 'center' : 'left';
    ctx.textBaseline = it.base === 'bottom' ? 'bottom' : 'middle'; // 'bottom' is the em box's bottom, like Phaser's origin y 1
    if (it.stroke) {
      ctx.strokeStyle = it.stroke;
      ctx.lineWidth = 2 * zoom;
      ctx.strokeText(it.text, it.x, it.y);
    }
    ctx.fillStyle = it.color;
    ctx.fillText(it.text, it.x, it.y);
  }

  private cap(ctx: CanvasRenderingContext2D, it: Extract<OverlayItem, { t: 'cap' }>, zoom: number): void {
    const s = Math.round(CAP_SIZE * zoom);
    const x = Math.round(it.x - s / 2);
    const y = it.y - s;
    const r = 2 * zoom;
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, y, 0, y + s);
    g.addColorStop(0, '#f1cf63');
    g.addColorStop(1, '#c9962c');
    ctx.beginPath();
    ctx.roundRect(x, y, s, s, r);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, Math.round(zoom));
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    const m = WORLD_TEXT.mark;
    ctx.font = `${m.style} ${m.size * zoom}px ${FONT_TEXT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a1806';
    ctx.fillText('E', it.x, y + s / 2);
  }

  private icon(ctx: CanvasRenderingContext2D, it: Extract<OverlayItem, { t: 'icon' }>, zoom: number): void {
    const px = Math.max(1, Math.round(ICON_SIZE * zoom));
    const key = `${it.id}@${px}`;
    let img = this.icons.get(key);
    if (!img) {
      img = new Image();
      img.src = effectIconDataUri(it.id, px);
      this.icons.set(key, img);
    }
    if (!img.complete || img.naturalWidth === 0) return; // decoding; drawn from the next frame
    ctx.globalAlpha = 1;
    ctx.drawImage(img, it.x, Math.round(it.y - px / 2), px, px);
  }

  dispose(): void {
    this.canvas.remove();
    this.icons.clear();
    this.widths.clear();
  }
}

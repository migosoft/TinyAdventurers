// The lamp's shadow casters of the 3D models (#357): each model's side outline (every triangle of the rest pose, seen along z)
// as one opaque silhouette frame `model_<key>` (a built figure's: its rest body, in game px), one px per model px, centred on x 0, the feet on the bottom row. A lamp casts
// this instead of a card, so every model's shadow is its own shape (antlers, tail, legs).
import type { Image } from './png';
import { buildFigure } from '../src/render3d/models/model';
import { buildTubeFigure } from '../src/render3d/models/tubeModel';
import { BUILT_OF_KIND } from '../src/render3d/built';
import { DESCS, outlineFrame, TUBE_DESCS, type DescKey, type TubeKey } from '../src/render3d/models/table';

interface Frame { x: number; y: number; w: number; h: number }

/** The colour every outline px has: the models' outline colour (the shadow reads only the alpha). */
const INK = 0x22;

/** Fills a frame of `w` x `h` px with the model's triangles seen from the side: a px is set when its centre lies inside one or a vertex lies in it. */
function fill(position: Float32Array, index: Uint32Array, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const cx = w / 2;
  for (let t = 0; t < index.length; t += 3) {
    const ax = position[index[t] * 3] + cx, ay = h - position[index[t] * 3 + 1];
    const bx = position[index[t + 1] * 3] + cx, by = h - position[index[t + 1] * 3 + 1];
    const qx = position[index[t + 2] * 3] + cx, qy = h - position[index[t + 2] * 3 + 1];
    const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    if (area === 0) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, qx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, qx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, qy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, qy)));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        // Barycentric weights, all non-negative inside whichever way the triangle winds.
        const w0 = ((bx - px) * (qy - py) - (by - py) * (qx - px)) / area;
        const w1 = ((qx - px) * (ay - py) - (qy - py) * (ax - px)) / area;
        if (w0 >= 0 && w1 >= 0 && 1 - w0 - w1 >= 0) mask[y * w + x] = 1;
      }
  }
  // The pixel of every vertex too, so a thin tip (an antler point, an ear) is not lost between pixel centres.
  for (let i = 0; i < position.length; i += 3) {
    const x = Math.min(w - 1, Math.max(0, Math.floor(position[i] + cx))), y = Math.min(h - 1, Math.max(0, Math.floor(h - position[i + 1])));
    mask[y * w + x] = 1;
  }
  return mask;
}

/** The outline frames of every model in one strip `width` px wide, packed in rows. */
export function buildModelOutlines(width: number): { img: Image; frames: Record<string, Frame> } {
  type Source = { key: string; position: Float32Array; index: Uint32Array };
  const sources: Source[] = [...Object.keys(DESCS), ...Object.keys(TUBE_DESCS)].map((key) => {
    const m = key in DESCS ? buildFigure(key, DESCS[key as DescKey]) : buildTubeFigure(key, TUBE_DESCS[key as TubeKey]);
    return { key, position: m.position, index: m.index };
  });
  // The built figures (#358): the rest pose's body in game px (builder units times the figure's unit); the buffer is the figure's own, read only.
  for (const f of new Set(Object.values(BUILT_OF_KIND))) {
    if (!f) continue;
    const b = f.rest();
    const position = new Float32Array(b.verts * 3);
    for (let i = 0; i < position.length; i++) position[i] = b.position[i] * f.unit;
    sources.push({ key: f.key, position, index: b.index.subarray(0, b.indices) });
  }
  const cells = sources.map(({ key, position, index }) => {
    let maxX = 0, maxY = 0;
    for (let i = 0; i < position.length; i += 3) (maxX = Math.max(maxX, Math.abs(position[i])), maxY = Math.max(maxY, position[i + 1]));
    const w = 2 * Math.max(1, Math.ceil(maxX)), h = Math.max(1, Math.ceil(maxY));
    return { key, w, h, mask: fill(position, index, w, h) };
  });
  const frames: Record<string, Frame> = {};
  let x = 0, y = 0, rowH = 0;
  for (const c of cells) {
    if (c.w > width) throw new Error(`model-frames: ${c.key} is ${c.w} px wide, the strip ${width}`);
    if (x + c.w > width) (y += rowH, x = 0, rowH = 0);
    frames[outlineFrame(c.key)] = { x, y, w: c.w, h: c.h };
    x += c.w;
    rowH = Math.max(rowH, c.h);
  }
  const img: Image = { w: width, h: y + rowH, data: new Uint8Array(width * (y + rowH) * 4) };
  for (const c of cells) {
    const f = frames[outlineFrame(c.key)];
    for (let r = 0; r < c.h; r++)
      for (let q = 0; q < c.w; q++)
        if (c.mask[r * c.w + q]) img.data.set([INK, INK, INK, 255], ((f.y + r) * width + f.x + q) * 4);
  }
  return { img, frames };
}

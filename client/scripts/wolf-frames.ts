// The dire wolf's frames, from the Enchanted Forest pack's Wolf_Idle_1..4 and
// Wolf_Walk_1..4 (CC0, client/assets-src/enchanted-forest/frames/Wolf): 32x32
// canvases, the wolf facing right like the 0x72 figures
// (EntityView flips by aim; no mirroring needed), trimmed to one shared box (the union of the
// opaque pixels) so the frames do not wobble.
//   dire_wolf_idle_anim_f0..3, dire_wolf_run_anim_f0..3
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, type Image } from './png';

interface Frame { x: number; y: number; w: number; h: number }

const SETS: [string, string][] = [['idle', 'Idle'], ['run', 'Walk']];

/** Packs the eight wolf frames into one strip `width` px wide. */
export function buildWolf(dir: string, width: number): { img: Image; frames: Record<string, Frame> } {
  const srcs: { name: string; png: Image }[] = [];
  for (const [set, file] of SETS)
    for (let i = 0; i < 4; i++) srcs.push({ name: `dire_wolf_${set}_anim_f${i}`, png: decodePng(fs.readFileSync(path.join(dir, `Wolf_${file}_${i + 1}.png`))) });
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (const { png } of srcs)
    for (let y = 0; y < png.h; y++)
      for (let x = 0; x < png.w; x++)
        if (png.data[(y * png.w + x) * 4 + 3] > 0) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  if (x1 < 0) throw new Error('wolf: the frames are empty');
  const [w, h] = [x1 - x0 + 1, y1 - y0 + 1];
  if (srcs.length * w > width) throw new Error(`wolf: ${srcs.length} frames of ${w}px do not fit ${width}px`);
  const img: Image = { w: width, h, data: new Uint8Array(width * h * 4) };
  const frames: Record<string, Frame> = {};
  srcs.forEach(({ name, png }, n) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const s = ((y0 + y) * png.w + (x0 + x)) * 4;
        img.data.set(png.data.subarray(s, s + 4), (y * width + n * w + x) * 4);
      }
    frames[name] = { x: n * w, y: 0, w, h };
  });
  return { img, frames };
}

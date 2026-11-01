// Explosion frames: cut from the AI-generated sheets in assets-src/explosion/
// (see src/game/anim/explosionFrames.ts). Each sheet is about 1536x1024 with six
// labelled stages in a 3x2 grid on a painted checkerboard (no real
// transparency). Per stage: the checkerboard and the pale wisps on it are keyed
// out by a flood fill from the panel's border (so the white-hot core inside the
// cloud stays), the stage is centred on its cloud's centroid, and it is scaled
// down so the peak's cloud has the radius `EXPLOSION_ART_R`. A texel is opaque
// when at least half of its source pixels are, with their mean colour.
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, type Image } from './png';
import { EXPLOSION_ART_R, EXPLOSION_FRAME, EXPLOSION_SHEETS, EXPLOSION_STAGES, explosionFrameName } from '../src/game/anim/explosionFrames';

/** Panel columns are a third of the sheet wide; the art of row 0 and row 1 sits in these source rows (the labels below them are left out). */
const ROWS: [number, number][] = [
  [0, 425],
  [500, 925],
];
/** The stage whose cloud sets the scale (stage 3, the peak). */
const PEAK = 2;
/** The share of the peak's opaque pixels inside `EXPLOSION_ART_R`; the rest are flying sparks. */
const PEAK_SHARE = 0.9;

interface Stage {
  x0: number;
  y0: number;
  w: number;
  h: number;
  keep: Uint8Array;
  cx: number;
  cy: number;
}

/** Checkerboard and wisps: light and nearly grey. */
function backgroundLike(img: Image, x: number, y: number): boolean {
  const i = (y * img.w + x) * 4;
  const lo = Math.min(img.data[i], img.data[i + 1], img.data[i + 2]);
  const hi = Math.max(img.data[i], img.data[i + 1], img.data[i + 2]);
  return lo > 200 && hi - lo < 30;
}

function keyStage(img: Image, x0: number, y0: number, w: number, h: number): Stage {
  const keep = new Uint8Array(w * h).fill(1);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % w;
    const y = (k - x) / w;
    if (!keep[k] || !backgroundLike(img, x0 + x, y0 + y)) continue;
    keep[k] = 0;
    if (x > 0) stack.push(k - 1);
    if (x < w - 1) stack.push(k + 1);
    if (y > 0) stack.push(k - w);
    if (y < h - 1) stack.push(k + w);
  }
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < w * h; k++)
    if (keep[k]) {
      n++;
      sx += k % w;
      sy += Math.floor(k / w);
    }
  if (n === 0) throw new Error(`explosion: empty stage at ${x0},${y0}`);
  return { x0, y0, w, h, keep, cx: sx / n, cy: sy / n };
}

/** The radius around its centroid holding `share` of a stage's opaque pixels, in source pixels. */
function cloudRadius(s: Stage, share: number): number {
  const d: number[] = [];
  for (let k = 0; k < s.w * s.h; k++) if (s.keep[k]) d.push(Math.hypot((k % s.w) - s.cx, Math.floor(k / s.w) - s.cy));
  d.sort((a, b) => a - b);
  return d[Math.floor((d.length - 1) * share)];
}

/** Cuts one sheet into its stage frames, `EXPLOSION_FRAME` square. */
export function cutExplosion(img: Image): Image[] {
  const pw = Math.floor(img.w / 3);
  const stages = ROWS.flatMap(([a, b]) => [0, 1, 2].map((c) => keyStage(img, c * pw, a, pw, b - a)));
  if (stages.length !== EXPLOSION_STAGES) throw new Error('explosion: stage count');
  /** Source pixels per texel. */
  const f = cloudRadius(stages[PEAK], PEAK_SHARE) / EXPLOSION_ART_R;
  const half = EXPLOSION_FRAME / 2;
  return stages.map((s) => {
    const out: Image = { w: EXPLOSION_FRAME, h: EXPLOSION_FRAME, data: new Uint8Array(EXPLOSION_FRAME * EXPLOSION_FRAME * 4) };
    for (let ty = 0; ty < EXPLOSION_FRAME; ty++)
      for (let tx = 0; tx < EXPLOSION_FRAME; tx++) {
        const sx0 = Math.round(s.cx + (tx - half) * f);
        const sy0 = Math.round(s.cy + (ty - half) * f);
        const sx1 = Math.round(s.cx + (tx + 1 - half) * f);
        const sy1 = Math.round(s.cy + (ty + 1 - half) * f);
        let all = 0;
        let n = 0;
        const sum = [0, 0, 0];
        for (let y = sy0; y < sy1; y++)
          for (let x = sx0; x < sx1; x++) {
            all++;
            if (x < 0 || y < 0 || x >= s.w || y >= s.h || !s.keep[y * s.w + x]) continue;
            n++;
            const i = ((s.y0 + y) * img.w + s.x0 + x) * 4;
            for (let c = 0; c < 3; c++) sum[c] += img.data[i + c];
          }
        if (n * 2 < all) continue;
        const o = (ty * EXPLOSION_FRAME + tx) * 4;
        for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(sum[c] / n);
        out.data[o + 3] = 255;
      }
    return out;
  });
}

export function buildExplosions(dir: string, maxW: number): { img: Image; frames: Record<string, { x: number; y: number; w: number; h: number }> } {
  const F = EXPLOSION_FRAME;
  const list = EXPLOSION_SHEETS.flatMap((s) => cutExplosion(decodePng(fs.readFileSync(path.join(dir, `${s}_source.png`)))).map((frame, i) => ({ name: explosionFrameName(s, i), frame })));
  const cols = Math.floor(maxW / F);
  const img: Image = { w: F * cols, h: F * Math.ceil(list.length / cols), data: new Uint8Array(0) };
  img.data = new Uint8Array(img.w * img.h * 4);
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
  list.forEach(({ name, frame }, n) => {
    const ox = (n % cols) * F;
    const oy = Math.floor(n / cols) * F;
    for (let y = 0; y < F; y++) img.data.set(frame.data.subarray(y * F * 4, (y + 1) * F * 4), ((oy + y) * img.w + ox) * 4);
    frames[name] = { x: ox, y: oy, w: F, h: F };
  });
  return { img, frames };
}

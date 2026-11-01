// The Ghost's and the Shade's frames, cut from two AI-generated sprite sheets
// (ChatGPT, made by the user, 2026-10-31): client/assets-src/ghost/ghost_sheet.png
// and client/assets-src/shade/shade_sheet.png, 1536x1024 with a white label strip
// above an IDLE row and a MOVE row of four 384-px cells on #ff00ff. The figures are
// drawn as ~11 px blocks with soft edges, so each sheet is re-sampled to game pixels:
//   1. find the magenta band under each label strip, and the figure's mask per cell;
//   2. fit one block size per sheet and one grid phase per frame (edge positions vote);
//   3. sample every block at its centre, key out #ff00ff, snap to a k-means palette;
//   4. centre the figure in 24x24 with its lowest row on y = 23 (a tail wider than 24 is
//      clipped on the left, the trailing end).
//   ghost_idle_anim_f0..3, ghost_run_anim_f0..3, shade_idle_anim_f0..3, shade_run_anim_f0..3
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, type Image } from './png';

interface Frame { x: number; y: number; w: number; h: number }

export const SPECTRE_SIZE = 24;
const CELL = 384;
// The brief said 80, but the Shade's violet eyes (187,12,247) are only ~70 from #ff00ff.
const KEY_DIST = 45;
const PALETTE_SIZE = 6;
const TINT_DIST = 200; // an edge block this close to #ff00ff is a blend; interior violet (the Shade's eyes) stays
const SETS = ['idle', 'run'];

const px = (img: Image, x: number, y: number): [number, number, number] => {
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const isKey = ([r, g, b]: number[]) => Math.hypot(r - 255, g, b - 255) < KEY_DIST;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** First y of each magenta band under a label strip (rows that are mostly magenta). */
function bandStarts(img: Image): number[] {
  const starts: number[] = [];
  let inBand = false;
  for (let y = 0; y < img.h; y++) {
    let n = 0;
    for (let x = 0; x < img.w; x += 4) if (isKey(px(img, x, y))) n++;
    const magenta = n > img.w / 4 / 5; // figures never cover more than ~80 % of a row
    if (magenta && !inBand) starts.push(y);
    inBand = magenta;
  }
  return starts;
}

interface Cell { x0: number; y0: number; x1: number; y1: number; ex: number[]; ey: number[] }

/** The figure's bounding box in a cell plus the positions (and strengths) of its colour edges. */
function scanCell(img: Image, cx: number, cy: number, ch: number): Cell | null {
  const M = 6; // skips the faint cell border lines
  const [xa, xb, ya, yb] = [cx + M, cx + CELL - M, cy + 3, cy + ch - 3];
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  const ex = new Array<number>(img.w).fill(0);
  const ey = new Array<number>(img.h).fill(0);
  for (let y = ya; y < yb; y++)
    for (let x = xa; x < xb; x++) {
      const p = px(img, x, y);
      if (!isKey(p)) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      if (x > xa && dist(p, px(img, x - 1, y)) > 60) ex[x]++;
      if (y > ya && dist(p, px(img, x, y - 1)) > 60) ey[y]++;
    }
  return x1 < 0 ? null : { x0, y0, x1, y1, ex, ey };
}

/** Best phase of a grid of pitch p for the edge histogram `e` (edges sit on grid lines). */
function bestPhase(e: number[], p: number): { phase: number; score: number } {
  let best = { phase: 0, score: -Infinity };
  for (let o = 0; o < p; o += 0.25) {
    let s = 0;
    for (let i = 0; i < e.length; i++) if (e[i]) s += e[i] * Math.cos((2 * Math.PI * (i - o)) / p);
    if (s > best.score) best = { phase: o, score: s };
  }
  return best;
}

/**
 * One colour per block, or null when the block is background. A block counts when at least half
 * of its pixels are not magenta; its colour is the median of the non-magenta pixels in its middle
 * 60 %, so blended soft edges (a magenta tint) never reach the palette.
 */
function sample(img: Image, cx: number, cy: number, pitch: number): [number, number, number] | null {
  const r = pitch / 2;
  let total = 0;
  let solid = 0;
  const ch: number[][] = [[], [], []];
  for (let y = Math.round(cy - r); y < Math.round(cy + r); y++)
    for (let x = Math.round(cx - r); x < Math.round(cx + r); x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      total++;
      const p = px(img, x, y);
      if (isKey(p)) continue;
      solid++;
      if (Math.abs(x - cx) <= r * 0.6 && Math.abs(y - cy) <= r * 0.6) p.forEach((v, k) => ch[k].push(v));
    }
  if (solid * 2 < total || !ch[0].length) return null;
  return ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1]) as [number, number, number];
}

/** Removes edge blocks that are still magenta-tinted from the blend with the background. */
function dropTintedEdges(rows: ([number, number, number] | null)[][]): ([number, number, number] | null)[][] {
  const at = (j: number, i: number) => rows[j]?.[i] ?? null;
  return rows.map((row, j) => row.map((c, i) => {
    if (!c || dist(c, [255, 0, 255]) >= TINT_DIST) return c;
    const edge = !at(j - 1, i) || !at(j + 1, i) || !at(j, i - 1) || !at(j, i + 1);
    return edge ? null : c;
  }));
}

/** k-means with farthest-point seeding (deterministic), so small accents such as eyes get a colour. */
function kmeans(colors: number[][], k: number): number[][] {
  const centers: number[][] = [colors.reduce((a, c) => (c[0] + c[1] + c[2] < a[0] + a[1] + a[2] ? c : a))];
  while (centers.length < k) {
    let far = colors[0];
    let farD = -1;
    for (const c of colors) {
      const d = Math.min(...centers.map((m) => dist(c, m)));
      if (d > farD) [far, farD] = [c, d];
    }
    centers.push(far);
  }
  for (let it = 0; it < 20; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const c of colors) {
      let b = 0;
      for (let i = 1; i < k; i++) if (dist(c, centers[i]) < dist(c, centers[b])) b = i;
      sum[b][0] += c[0]; sum[b][1] += c[1]; sum[b][2] += c[2]; sum[b][3]++;
    }
    sum.forEach((s, i) => { if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  return centers.map((c) => c.map(Math.round));
}

/** Cuts one sheet into its 8 frames (IDLE 1-4, then MOVE 1-4), each SPECTRE_SIZE square RGBA. */
export function cutSpectre(sheet: Image): Image[] {
  const starts = bandStarts(sheet);
  if (starts.length !== 2) throw new Error(`spectre: expected 2 magenta bands, found ${starts.length}`);
  const cells: Cell[] = [];
  starts.forEach((y, row) => {
    const bandH = (row === 0 ? starts[1] : sheet.h) - y;
    for (let c = 0; c < 4; c++) {
      const cell = scanCell(sheet, c * CELL, y, Math.min(bandH, 400));
      if (!cell) throw new Error(`spectre: cell ${row}/${c} is empty`);
      cells.push(cell);
    }
  });
  // One block size for the sheet: the pitch whose best per-frame phases explain the edges best.
  let pitch = 11;
  let pitchScore = -Infinity;
  for (let p = 9; p <= 13; p += 0.1) {
    let s = 0;
    for (const c of cells) s += bestPhase(c.ex, p).score + bestPhase(c.ey, p).score;
    if (s > pitchScore) [pitch, pitchScore] = [p, s];
  }
  // Grid each frame: blocks sampled at their centres; null = keyed out.
  const grids = cells.map((c) => {
    const ox = bestPhase(c.ex, pitch).phase;
    const oy = bestPhase(c.ey, pitch).phase;
    const gx0 = Math.floor((c.x0 - ox) / pitch);
    const gy0 = Math.floor((c.y0 - oy) / pitch);
    const gw = Math.ceil((c.x1 + 1 - ox) / pitch) - gx0;
    const gh = Math.ceil((c.y1 + 1 - oy) / pitch) - gy0;
    const rows: ([number, number, number] | null)[][] = [];
    for (let j = 0; j < gh; j++) {
      const row: ([number, number, number] | null)[] = [];
      for (let i = 0; i < gw; i++) {
        row.push(sample(sheet, ox + (gx0 + i + 0.5) * pitch, oy + (gy0 + j + 0.5) * pitch, pitch));
      }
      rows.push(row);
    }
    return dropTintedEdges(rows);
  });
  const palette = kmeans(grids.flat(2).filter((c): c is [number, number, number] => c !== null), PALETTE_SIZE);
  const snap = (c: number[]) => palette.reduce((a, p) => (dist(c, p) < dist(c, a) ? p : a));
  return grids.map((rows) => {
    const img: Image = { w: SPECTRE_SIZE, h: SPECTRE_SIZE, data: new Uint8Array(SPECTRE_SIZE * SPECTRE_SIZE * 4) };
    let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
    rows.forEach((row, j) => row.forEach((c, i) => { if (c) [x0, y0, x1, y1] = [Math.min(x0, i), Math.min(y0, j), Math.max(x1, i), Math.max(y1, j)]; }));
    const [w, h] = [x1 - x0 + 1, y1 - y0 + 1];
    if (h > SPECTRE_SIZE) throw new Error(`spectre: a frame is ${h} game px tall, want at most ${SPECTRE_SIZE}`);
    const left = w > SPECTRE_SIZE ? x1 - SPECTRE_SIZE + 1 : x0; // too wide: drop the trailing left end
    const dx = Math.floor((SPECTRE_SIZE - Math.min(w, SPECTRE_SIZE)) / 2) - left;
    const dy = SPECTRE_SIZE - 1 - y1;
    rows.forEach((row, j) => row.forEach((c, i) => {
      const [x, y] = [i + dx, j + dy];
      if (!c || x < 0 || x >= SPECTRE_SIZE || y < 0 || y >= SPECTRE_SIZE) return;
      img.data.set([...snap(c), 255], (y * SPECTRE_SIZE + x) * 4);
    }));
    return img;
  });
}

/** Packs the 16 frames into one strip `width` px wide (24 px tall). */
export function buildSpectres(dir: string, width: number): { img: Image; frames: Record<string, Frame> } {
  const img: Image = { w: width, h: SPECTRE_SIZE, data: new Uint8Array(width * SPECTRE_SIZE * 4) };
  const frames: Record<string, Frame> = {};
  let n = 0;
  for (const creature of ['ghost', 'shade']) {
    const cut = cutSpectre(decodePng(fs.readFileSync(path.join(dir, creature, `${creature}_sheet.png`))));
    cut.forEach((f, k) => {
      if ((n + 1) * SPECTRE_SIZE > width) throw new Error(`spectre: 16 frames of ${SPECTRE_SIZE}px do not fit ${width}px`);
      for (let y = 0; y < SPECTRE_SIZE; y++) img.data.set(f.data.subarray(y * SPECTRE_SIZE * 4, (y + 1) * SPECTRE_SIZE * 4), (y * width + n * SPECTRE_SIZE) * 4);
      frames[`${creature}_${SETS[k >> 2]}_anim_f${k & 3}`] = { x: n * SPECTRE_SIZE, y: 0, w: SPECTRE_SIZE, h: SPECTRE_SIZE };
      n++;
    });
  }
  return { img, frames };
}

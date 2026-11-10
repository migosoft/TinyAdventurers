// Dev script for the vegetation generator (#279): the judging sheets as PNGs and the draw-cost table.
//   npx tsx scripts/plant-sheet.ts <out dir>   writes the sheets and prints their paths
//   npx tsx scripts/plant-sheet.ts --bench     prints ms per plant by kind and size, and the demo-map sum
import fs from 'node:fs';
import path from 'node:path';
import { encodePng } from './png';
import { DEFAULT_LIGHT, PLANT_KINDS, type Light, type PlantKind, type Rgba, coveTree, drawPlant, lightVector } from '../src/game/vegetation';

const GRASS: [number, number, number] = [92, 146, 74];
const FOOT: [number, number, number] = [255, 0, 255];
const SEEDS = [3, 11, 27, 48, 65, 91];
const CELL_W = 120, CELL_H = 130;

/** `bare` joins PLANT_KINDS in a later task; the sheets and the bench skip a kind that does not exist yet. */
const has = (k: string) => (PLANT_KINDS as readonly string[]).includes(k);

interface Item { kind: PlantKind; pct: number; light: Light }

/** A grid of plants on grass, one row per item, one column per seed, a magenta marker at each foot, scaled by `zoom`. */
function sheet(rows: Item[][], zoom: number): { w: number; h: number; data: Uint8Array } {
  const cw = CELL_W * zoom, ch = CELL_H * zoom, w = cw * SEEDS.length, h = ch * rows.length;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...GRASS, 255], i * 4);
  const put = (x: number, y: number, rgb: readonly number[]) => { if (x >= 0 && y >= 0 && x < w && y < h) data.set([rgb[0], rgb[1], rgb[2], 255], (y * w + x) * 4); };
  rows.forEach((items, row) => items.forEach((it, col) => {
    const d = drawPlant(it.kind, SEEDS[col % SEEDS.length], it.pct, it.light);
    // the foot sits at the bottom centre of the cell, a little above its edge
    const ox = col * cw + Math.round(cw / 2) - d.foot.x * zoom, oy = row * ch + ch - 14 * zoom - d.foot.y * zoom;
    for (let y = 0; y < d.img.h; y++) for (let x = 0; x < d.img.w; x++) {
      const i = (y * d.img.w + x) * 4;
      if (d.img.data[i + 3] === 0) continue;
      for (let j = 0; j < zoom; j++) for (let k = 0; k < zoom; k++) put(ox + x * zoom + k, oy + y * zoom + j, [d.img.data[i], d.img.data[i + 1], d.img.data[i + 2]]);
    }
    const fx = col * cw + Math.round(cw / 2), fy = row * ch + ch - 14 * zoom;
    for (let j = 0; j < Math.max(zoom, 2); j++) for (let k = 0; k < Math.max(zoom, 2); k++) put(fx + k, fy + j, FOOT);
  }));
  return { w, h, data };
}

/** A single image on grass (the cove tree). */
function single(img: Rgba, zoom: number): { w: number; h: number; data: Uint8Array } {
  const w = img.w * zoom, h = img.h * zoom, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...GRASS, 255], i * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((Math.floor(y / zoom)) * img.w + Math.floor(x / zoom)) * 4;
    if (img.data[i + 3]) data.set([img.data[i], img.data[i + 1], img.data[i + 2], 255], (y * w + x) * 4);
  }
  return { w, h, data };
}

function writeSheets(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const row = (kind: string, pct: number, light: Light = DEFAULT_LIGHT): Item[] => SEEDS.map(() => ({ kind: kind as PlantKind, pct, light }));
  const kinds: [string, number][] = [['round', 100], ['wide', 100], ['tall', 100], ['conifer', 100], ['bare', 100], ['bush', 140]];
  const main = kinds.filter(([k]) => has(k)).map(([k, p]) => row(k, p));
  const sun = lightVector({ side: 1, elevation: 45 });
  const small: Item[][] = [];
  const smallKinds: [string, number][] = [['round', 60], ['conifer', 60], ['bare', 60], ['bush', 90]];
  const lit: [string, number][] = [['round', 100], ['conifer', 100], ['bare', 100]];
  for (const [k, p] of smallKinds) if (has(k)) small.push(row(k, p));
  for (const [k, p] of lit) if (has(k)) small.push(row(k, p, sun));
  const out: [string, { w: number; h: number; data: Uint8Array }][] = [
    ['1-kinds-1x.png', sheet(main, 1)],
    ['1-kinds-3x.png', sheet(main, 3)],
    ['2-small-and-sun-right-3x.png', sheet(small, 3)],
    ['3-cove-tree-3x.png', single(coveTree(), 3)],
  ];
  for (const [name, img] of out) { const p = path.join(dir, name); fs.writeFileSync(p, encodePng(img)); console.log(p); }
}

/** Mean ms per plant over 40 seeds after a warm-up, and the sum over the distinct looks of the demo map. */
function bench(): void {
  const time = (kind: string, pct: number, seed: number) => { const t = performance.now(); drawPlant(kind as PlantKind, seed, pct); return performance.now() - t; };
  for (let i = 1; i <= 20; i++) time('round', 100, i);
  const cells: [string, number[]][] = [['round', [60, 100, 120]], ['wide', [60, 100, 120]], ['tall', [60, 100, 120]], ['conifer', [60, 100, 120]], ['bare', [60, 100, 120]], ['bush', [100, 150]]];
  console.log('kind     ms per plant (mean of 40 seeds)');
  for (const [kind, pcts] of cells) {
    if (!has(kind)) { console.log(`${kind.padEnd(8)} (none)`); continue; }
    const ms = pcts.map((p) => { let sum = 0; for (let s = 1; s <= 40; s++) sum += time(kind, p, s); return `${(sum / 40).toFixed(2)}`; });
    console.log(`${kind.padEnd(8)} ${ms.join(' / ')}   (at ${pcts.join(' / ')} %)`);
  }
  const demo = JSON.parse(fs.readFileSync(new URL('../src/generated/woodland-demo.json', import.meta.url), 'utf8'))[0];
  const looks = new Set<string>();
  for (const [kind, , , seed, scale] of demo.woodland.plants as number[][]) looks.add(`${kind},${seed},${scale}`);
  const t = performance.now();
  for (const l of looks) { const [kind, seed, scale] = l.split(',').map(Number); drawPlant(PLANT_KINDS[kind], seed, scale); }
  console.log(`demo map seed 1: ${looks.size} distinct looks, ${(performance.now() - t).toFixed(0)} ms in total`);
}

const arg = process.argv[2];
if (arg === '--bench') bench();
else if (arg) writeSheets(arg);
else { console.error('usage: plant-sheet.ts <out dir> | --bench'); process.exit(1); }

// The torch frames, from "Simple Torch Animation 16x16" by Natural_Privateer
// (CC0, client/assets-src/torch): a 3x2 grid of 16x16 frames, the last one empty.
//   torch_f0..    the flame animation
//   torch_out     frame 0 without the flame (a bare stick)
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, type Image } from './png';

const F = 16;

interface Frame { x: number; y: number; w: number; h: number }

/** Copies the torch frames into one strip `width` px wide. */
export function buildTorches(dir: string, width: number): { img: Image; frames: Record<string, Frame> } {
  const sheet = decodePng(fs.readFileSync(path.join(dir, 'torch_anim.png')));
  if (sheet.w % F || sheet.h % F) throw new Error(`torch: torch_anim.png is ${sheet.w}x${sheet.h}, expected a multiple of ${F}`);
  const cols = sheet.w / F;
  const cells: Uint8Array[] = [];
  for (let n = 0; n < cols * (sheet.h / F); n++) {
    const cell = new Uint8Array(F * F * 4);
    for (let y = 0; y < F; y++) cell.set(sheet.data.subarray(((Math.floor(n / cols) * F + y) * sheet.w + (n % cols) * F) * 4, ((Math.floor(n / cols) * F + y) * sheet.w + (n % cols + 1) * F) * 4), y * F * 4);
    if (cell.some((v, i) => i % 4 === 3 && v > 0)) cells.push(cell);
  }
  if (!cells.length) throw new Error('torch: torch_anim.png has no frames');
  // The stick keeps its colour; flame pixels are red-orange (red >= 180, green > blue).
  const out = cells[0].slice();
  for (let i = 0; i < out.length; i += 4) if (out[i] >= 180 && out[i + 1] > out[i + 2]) out.fill(0, i, i + 4);
  const all = [...cells, out];
  const img: Image = { w: width, h: F, data: new Uint8Array(width * F * 4) };
  const frames: Record<string, Frame> = {};
  all.forEach((cell, n) => {
    for (let y = 0; y < F; y++) img.data.set(cell.subarray(y * F * 4, (y + 1) * F * 4), (y * width + n * F) * 4);
    frames[n === cells.length ? 'torch_out' : `torch_f${n}`] = { x: n * F, y: 0, w: F, h: F };
  });
  return { img, frames };
}

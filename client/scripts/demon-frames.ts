// Demon frames: copied from the action strips in assets-src/demon/ (see
// src/game/anim/demonFrames.ts for the layout). The strips are already clean
// pixel art in the demon's palette; this only checks their size and lays the
// frames out in rows at most `maxW` pixels wide.
import fs from 'node:fs';
import path from 'node:path';
import { decodePng, type Image } from './png';
import { DEMON_ANIMS, DEMON_FRAME, demonFrameName, type DemonAnim } from '../src/game/anim/demonFrames';

export function buildDemon(dir: string, maxW: number): { img: Image; frames: Record<string, { x: number; y: number; w: number; h: number }> } {
  const { w: FW, h: FH } = DEMON_FRAME;
  const list = (Object.entries(DEMON_ANIMS) as [DemonAnim, number][]).flatMap(([a, n]) => {
    const strip = decodePng(fs.readFileSync(path.join(dir, `demon_${a}.png`)));
    if (strip.w !== FW * n || strip.h !== FH) throw new Error(`demon: demon_${a}.png is ${strip.w}x${strip.h}, expected ${FW * n}x${FH}`);
    return [...Array(n).keys()].map((i) => ({ name: demonFrameName(a, i), strip, i }));
  });
  const cols = Math.floor(maxW / FW);
  const img: Image = { w: FW * cols, h: FH * Math.ceil(list.length / cols), data: new Uint8Array(0) };
  img.data = new Uint8Array(img.w * img.h * 4);
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};
  list.forEach(({ name, strip, i }, n) => {
    const ox = (n % cols) * FW;
    const oy = Math.floor(n / cols) * FH;
    for (let y = 0; y < FH; y++) img.data.set(strip.data.subarray((y * strip.w + i * FW) * 4, (y * strip.w + (i + 1) * FW) * 4), ((oy + y) * img.w + ox) * 4);
    frames[name] = { x: ox, y: oy, w: FW, h: FH };
  });
  return { img, frames };
}

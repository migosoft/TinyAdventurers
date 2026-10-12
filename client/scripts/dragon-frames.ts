// Dragon frames built at atlas build time (see src/game/anim/dragonRig.ts),
// all AI-generated art for this game, facing right:
// - Sheet frames are copied from the action strips (assets-src/dragon/
//   dragon_<sheet>.png); only a jaw may open on them (fire from the air).
// - Generated frames come from the base sprite (dragon_base.png), cut into
//   body parts (masks below) and moved per pose.
// Afterwards the edges get the dark outline back and 1-pixel cracks at the
// joints are filled.
import type { Image } from './png';
import { DRAGON_ANIMS, DRAGON_FRAME, DRAGON_SHEETS, PIVOTS, dragonFrameName, unposePoint, type DragonAnim, type DragonPart, type DragonPose, type DragonSheet } from '../src/game/anim/dragonRig';

type Rgba = [number, number, number, number];
const OUTLINE: Rgba = [0x2f, 0x05, 0x17, 255];
/** Claw tips stay light on the bottom edge. */
const CLAW = 0xd4;
const MOUTH_DARK: Rgba = [0x50, 0x0a, 0x18, 255];
const FIRE: Rgba[] = [
  [0xee, 0x8e, 0x2e, 255],
  [0xfa, 0xcb, 0x3e, 255],
];

// Part masks in base pixels: polygons (pixel centres inside), checked in this order.
type Poly = [number, number][];
const JAW_ROWS: Record<number, [number, number]> = { 16: [36, 45], 17: [38, 47], 18: [42, 47], 19: [43, 46] };
const MASKS: [DragonPart, Poly][] = [
  ['head', [[22.5, 0], [49, 0], [49, 17], [45.5, 17], [45.5, 15.5], [36, 15.5], [33, 13.5], [27, 13.5], [25, 9], [26, 4], [22.5, 1.5]]],
  ['nearWing', [[0, 0], [20.5, 0], [20.5, 4.5], [17, 6], [16.5, 14], [19, 17], [23.5, 20.5], [21, 23.5], [13, 23.5], [3, 28], [0, 28]]],
  ['farWing', [[17, 6], [21, 4.6], [27, 4.6], [27, 9], [25, 12], [25, 20], [17, 20]]],
  ['tail', [[0, 23], [11, 24], [12, 31], [8.5, 37], [10, 40], [10.5, 43], [0, 43]]],
];
// Back to front. The jaw's open-mouth wedge is drawn right before the jaw.
const DRAW: DragonPart[] = ['farWing', 'tail', 'body', 'head', 'jaw', 'nearWing'];
/** Joints: body pixels kept under the moving part near its pivot, so no holes open there. */
const UNDERLAY: Partial<Record<DragonPart, number>> = { head: 5, tail: 4 };

function inside(poly: Poly, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function partOf(x: number, y: number): DragonPart {
  const r = JAW_ROWS[y];
  if (r && x >= r[0] && x <= r[1]) return 'jaw';
  for (const [part, poly] of MASKS) if (inside(poly, x + 0.5, y + 0.5)) return part;
  return 'body';
}

/** Where a frame's pixels come from, in base-sprite coordinates. */
interface Source {
  px(x: number, y: number): Rgba | null;
  part(x: number, y: number): DragonPart;
  /** Parts to draw, back to front. */
  draw: DragonPart[];
}

const pixel = (img: Image, x: number, y: number): Rgba | null => {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return null;
  const i = (y * img.w + x) * 4;
  return img.data[i + 3] ? (Array.from(img.data.subarray(i, i + 4)) as Rgba) : null;
};

/**
 * Lays the frames out in rows at most `maxW` pixels wide. `sheets` are the
 * action strips (DRAGON_SHEETS cells side by side).
 */
export function buildDragon(base: Image, sheets: Record<DragonSheet, Image>, maxW: number, anims: Record<string, DragonPose[]> = DRAGON_ANIMS): { img: Image; frames: Record<string, { x: number; y: number; w: number; h: number }> } {
  const { w: FW, h: FH } = DRAGON_FRAME;
  const parts: DragonPart[][] = [];
  for (let y = 0; y < base.h; y++) {
    parts.push([]);
    for (let x = 0; x < base.w; x++) parts[y][x] = partOf(x, y);
  }
  const baseSrc: Source = { px: (x, y) => pixel(base, x, y), part: (x, y) => parts[y][x], draw: DRAW };
  // A sheet frame is one piece except its jaw (only opened where the frame's head sits where the base head is).
  const sheetSrc = (name: DragonSheet, i: number): Source => {
    const { cell, shift } = DRAGON_SHEETS[name];
    return {
      px: (x, y) => {
        const cx = x + shift[0];
        const cy = y + shift[1];
        return cx < 0 || cy < 0 || cx >= cell[0] || cy >= cell[1] ? null : pixel(sheets[name], i * cell[0] + cx, cy);
      },
      part: (x, y) => (JAW_ROWS[y] && x >= JAW_ROWS[y][0] && x <= JAW_ROWS[y][1] ? 'jaw' : 'body'),
      draw: ['body', 'jaw'],
    };
  };
  const near = (x: number, y: number, p: DragonPart, r: number) => Math.hypot(x + 0.5 - PIVOTS[p][0], y + 0.5 - PIVOTS[p][1]) <= r;

  const list = (Object.entries(anims) as [DragonAnim, DragonPose[]][]).flatMap(([a, poses]) => poses.map((pose, i) => ({ name: dragonFrameName(a, i), pose })));
  const cols = Math.floor(maxW / FW);
  const img: Image = { w: FW * cols, h: FH * Math.ceil(list.length / cols), data: new Uint8Array(0) };
  img.data = new Uint8Array(img.w * img.h * 4);
  const frames: Record<string, { x: number; y: number; w: number; h: number }> = {};

  list.forEach(({ name, pose }, n) => {
    const src = pose.sheet ? sheetSrc(pose.sheet.name, pose.sheet.i) : baseSrc;
    const out: (Rgba | null)[] = new Array(FW * FH).fill(null);
    const owner: (DragonPart | null)[] = new Array(FW * FH).fill(null);
    // Samples part `p` of the source at frame pixel (fx, fy).
    const sample = (p: DragonPart, fx: number, fy: number): Rgba | null => {
      const [bx, by] = unposePoint(pose, p, [fx + 0.5, fy + 0.5]);
      const x = Math.floor(bx);
      const y = Math.floor(by);
      const c = src.px(x, y);
      if (!c) return null;
      const q = src.part(x, y);
      if (q === p) return c;
      // The body also draws the joint areas of its moving parts.
      if (p === 'body') for (const [part, r] of Object.entries(UNDERLAY) as [DragonPart, number][]) if (q === part && near(x, y, part, r)) return c;
      return null;
    };
    for (const p of src.draw) {
      if (p === 'jaw' && pose.jaw?.a) {
        // Open mouth: the space the jaw swept through is the dark inside of the mouth.
        const a = pose.jaw.a;
        const inMouth = new Set<number>();
        for (let k = 0; k <= 1.001; k += 0.125) {
          const partial: DragonPose = { ...pose, jaw: { ...pose.jaw, a: a * k } };
          for (let fy = 0; fy < FH; fy++)
            for (let fx = 0; fx < FW; fx++) {
              const [bx, by] = unposePoint(partial, 'jaw', [fx + 0.5, fy + 0.5]);
              const x = Math.floor(bx);
              const y = Math.floor(by);
              if (src.px(x, y) && src.part(x, y) === 'jaw') inMouth.add(fy * FW + fx);
            }
        }
        for (const i of inMouth) {
          if (owner[i] === 'head') continue;
          const fx = i % FW;
          const fy = (i - fx) / FW;
          const edge = !inMouth.has(i - 1) || !inMouth.has(i + 1) || !inMouth.has(i - FW) || !inMouth.has(i + FW);
          out[i] = edge ? OUTLINE : pose.glow ? FIRE[(fx + fy) % 2] : MOUTH_DARK;
          owner[i] = 'jaw';
        }
      }
      for (let fy = 0; fy < FH; fy++)
        for (let fx = 0; fx < FW; fx++) {
          const c = sample(p, fx, fy);
          if (c) {
            out[fy * FW + fx] = c;
            owner[fy * FW + fx] = p;
          }
        }
    }
    // Fill 1-pixel cracks (3 or 4 opaque neighbours) with the outline colour.
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < FW && y < FH && out[y * FW + x] !== null;
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++)
        if (!at(x, y) && +at(x - 1, y) + +at(x + 1, y) + +at(x, y - 1) + +at(x, y + 1) >= 3) {
          out[y * FW + x] = OUTLINE;
          owner[y * FW + x] = null;
        }
    // Outline: moved edges get the dark border back (the far wing keeps its soft edge).
    const edge: number[] = [];
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++)
        if (at(x, y) && owner[y * FW + x] !== 'farWing' && out[y * FW + x]![0] !== CLAW && (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1))) edge.push(y * FW + x);
    for (const i of edge) out[i] = OUTLINE;

    const ox = (n % cols) * FW;
    const oy = Math.floor(n / cols) * FH;
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++) {
        const c = out[y * FW + x];
        if (c) img.data.set(c, ((oy + y) * img.w + ox + x) * 4);
      }
    frames[name] = { x: ox, y: oy, w: FW, h: FH };
  });
  return { img, frames };
}

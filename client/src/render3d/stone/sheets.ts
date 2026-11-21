// The two stone sheets (#380): array textures that hold the painted stone, one page (layer) per chunk's ground and per wall page.
// RGBA8 (colour and relief), linear filtered, no mipmaps. The CPU copy stays in `image.data` (the one copy of the painted pixels), so a
// view rebuilt after a lost device takes it over with `copyFrom` instead of painting again.
import { DataArrayTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three/webgpu';
import { FACE_H, FACE_W, FLAT_A, FLAT_RGB, PAGE } from './format';
import type { FaceSlot, SheetPlan } from './plan';

/** The plan needs more layers, or a bigger page, than the device's textures allow. (Shown to the player like `GroundTooLargeError`.) */
export class StoneTooLargeError extends Error {
  constructor(what: string, need: number, limit: number) {
    super(`The stone sheets need ${need} ${what}, more than this device's texture limit (${limit}).`);
    this.name = 'StoneTooLargeError';
  }
}

export type SheetName = 'ground' | 'wall';

export interface Sheets {
  ground: DataArrayTexture;
  wall: DataArrayTexture;
  /** The layers `setPage`, `setFace` or `copyFrom` wrote so far. */
  readonly painted: { ground: ReadonlySet<number>; wall: ReadonlySet<number> };
  /** Copies a whole page (PAGE by PAGE RGBA) into its layer and marks only that layer (`addLayerUpdate`). */
  setPage(which: SheetName, layer: number, px: Uint8Array): void;
  /** Copies one face's FACE_W by FACE_H RGBA into its slot of the wall sheet and marks the slot's layer. */
  setFace(slot: FaceSlot, px: Uint8Array): void;
  /** Marks every layer set so far for upload again (a texture that must reach the GPU anew). */
  reupload(): void;
  /** Takes the painted layers of `other` (same layer counts) and marks them for upload. Used by a view rebuilt after a lost device. */
  copyFrom(other: Sheets): void;
  /** Frees the GPU textures; the CPU data stays readable (a later view may `copyFrom` it). */
  dispose(): void;
}

const PAGE_BYTES = PAGE * PAGE * 4;

function arrayTexture(layers: number): DataArrayTexture {
  const data = new Uint8Array(PAGE_BYTES * layers);
  // The flat colour, 4 bytes at a time (little endian: r in the low byte).
  new Uint32Array(data.buffer).fill(((FLAT_A << 24) | (FLAT_RGB[2] << 16) | (FLAT_RGB[1] << 8) | FLAT_RGB[0]) >>> 0);
  const t = new DataArrayTexture(data, PAGE, PAGE, layers);
  t.format = RGBAFormat;
  t.type = UnsignedByteType;
  t.colorSpace = NoColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.needsUpdate = true;
  return t;
}

export function makeSheets(plan: SheetPlan, limits: { size: number; layers: number }): Sheets {
  if (PAGE > limits.size) throw new StoneTooLargeError('px per page', PAGE, limits.size);
  if (plan.groundLayers > limits.layers) throw new StoneTooLargeError('ground layers', plan.groundLayers, limits.layers);
  if (plan.wallLayers > limits.layers) throw new StoneTooLargeError('wall layers', plan.wallLayers, limits.layers);
  const ground = arrayTexture(Math.max(1, plan.groundLayers));
  const wall = arrayTexture(Math.max(1, plan.wallLayers));
  const painted = { ground: new Set<number>(), wall: new Set<number>() };
  const tex = (w: SheetName): DataArrayTexture => (w === 'ground' ? ground : wall);
  const mark = (w: SheetName, layer: number): void => {
    painted[w].add(layer);
    tex(w).addLayerUpdate(layer);
    tex(w).needsUpdate = true;
  };
  const check = (w: SheetName, layer: number): void => {
    if (!Number.isInteger(layer) || layer < 0 || layer >= (tex(w).image as { depth: number }).depth) throw new Error(`${w} layer ${layer} is out of range`);
  };
  const s: Sheets = {
    ground, wall, painted,
    setPage(which, layer, px) {
      check(which, layer);
      if (px.length !== PAGE_BYTES) throw new Error(`a page is ${PAGE_BYTES} bytes, got ${px.length}`);
      (tex(which).image.data as Uint8Array).set(px, layer * PAGE_BYTES);
      mark(which, layer);
    },
    setFace(slot, px) {
      check('wall', slot.layer);
      if (px.length !== FACE_W * FACE_H * 4) throw new Error(`a face is ${FACE_W * FACE_H * 4} bytes, got ${px.length}`);
      const data = wall.image.data as Uint8Array;
      for (let r = 0; r < FACE_H; r++) data.set(px.subarray(r * FACE_W * 4, (r + 1) * FACE_W * 4), slot.layer * PAGE_BYTES + ((slot.v + r) * PAGE + slot.u) * 4);
      mark('wall', slot.layer);
    },
    reupload() {
      for (const w of ['ground', 'wall'] as const) {
        for (const l of painted[w]) tex(w).addLayerUpdate(l);
        if (painted[w].size > 0) tex(w).needsUpdate = true;
      }
    },
    copyFrom(other) {
      for (const w of ['ground', 'wall'] as const) {
        const from = other[w], to = tex(w);
        if ((from.image as { depth: number }).depth !== (to.image as { depth: number }).depth) throw new Error(`cannot copy ${w} sheets of different sizes`);
        for (const l of other.painted[w]) {
          (to.image.data as Uint8Array).set((from.image.data as Uint8Array).subarray(l * PAGE_BYTES, (l + 1) * PAGE_BYTES), l * PAGE_BYTES);
          painted[w].add(l);
        }
      }
      s.reupload();
    },
    dispose() {
      ground.dispose();
      wall.dispose();
    },
  };
  return s;
}

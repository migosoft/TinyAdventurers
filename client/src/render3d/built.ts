// Vertex streams of a figure that is built in code and refilled every frame (the lich, #358): the buffers the builders share, the
// per-frame data of a built figure (`BuiltInst`, `BuiltDrawn`), and the registry of built figures by kind (`BUILT_OF_KIND`).
// The registry imports `lich/figure.ts`, which imports only types from here; `lich/shape.ts` uses `newBuiltBuf`.
import { KIND } from '../generated/defs';
import { DEMON_FIGURE, ICE_DEMON_FIGURE } from './demon/figure';
import type { FigureKit } from './models/kit';
import { LICH_FIGURE } from './lich/figure';

export type V3 = [number, number, number];

/** Vertex streams of a fixed size, refilled every frame; only the first `verts` and `indices` count. `look`: 2 floats, [unlit 0|1, shade]. */
export interface BuiltBuf {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  colour: Float32Array;
  look: Float32Array;
  index: Uint32Array;
  verts: number;
  indices: number;
}

export function newBuiltBuf(maxVerts: number, maxIndices: number): BuiltBuf {
  return {
    position: new Float32Array(maxVerts * 3),
    normal: new Float32Array(maxVerts * 3),
    uv: new Float32Array(maxVerts * 2),
    colour: new Float32Array(maxVerts * 3),
    look: new Float32Array(maxVerts * 2),
    index: new Uint32Array(maxIndices),
    verts: 0,
    indices: 0,
  };
}

/** One built figure of a frame: buffers in its own model frame, placed by the view. The per-figure values are a model instance's. */
export interface BuiltInst {
  owner: number; key: string;
  x: number; z: number; lift: number; /** World rad. */ yaw: number; /** Tiles per builder unit. */ scale: number;
  body: BuiltBuf; glow: BuiltBuf | null; /** The body pushed out into the outline's hull; null: none. */ hull?: BuiltBuf | null;
  /** Four levels the builder's own material reads (the lich: rune, staff rune, wave, spare). */
  levels: [number, number, number, number];
  tint: [number, number, number]; stone: boolean; alpha: number; dark: boolean; cut: boolean; groundY: number;
  /** A skinned figure's bone matrices (`BuiltDrawn.bones`), copied by the layer each frame; `body` is then empty. */
  bones?: Float32Array;
  /** `BuiltDrawn.temper`: which material the layer makes (-1 cold). */
  temper?: 1 | -1;
  /** `BuiltDrawn.paint`: what the builder's own paint reads this frame. */
  paint?: Float32Array;
  sight: { hard: number; soft: number }; reach: number;
}

/** What a built figure reads of its entity this frame. `x`, `z`: the foot, tiles; `aim`, `look`: world rad (`look`: what the head follows, or null). */
export interface BuiltIn { anim: number; animT: number; effects: number; flags: number; aim: number; look: number | null; /** The way the last blow travelled (world rad); null: none (no flinch); undefined: not told (the plain flinch). */ hurtDir?: number | null; /** Foot, tiles. */ x: number; z: number }

/** What a built figure hands back: its buffers (owned by its memory, valid until its next `draw`), levels, yaw and the points the view lights and tags. */
export interface BuiltDrawn {
  body: BuiltBuf; glow: BuiltBuf | null; hull?: BuiltBuf | null; levels: [number, number, number, number]; yaw: number;
  /** 16 floats a bone, column-major: rest point -> model frame. The layer draws its own static geometry with them; `body` is then empty. */
  bones?: Float32Array;
  /** 1 hot, -1 cold. */
  temper?: 1 | -1;
  /** What the figure's own paint reads this frame (the demon: `PAINT_OF` in demon/figure.ts); the layer copies it into its uniforms. */
  paint?: Float32Array;
  /** Builder units the body hangs above its foot (flight). */
  lift?: number;
  /** Builder units, model frame. */
  anchors: { hand: V3; gem?: V3; eyes?: V3; chest?: V3; mouth?: V3; /** Five points along the blade's edge, grip to tip. */ blade?: V3[]; eyeL?: V3; eyeR?: V3 };
  halos: ReadonlyArray<{ at: V3; r: number; rgb: V3 }>;
  /** `chest`, `mouth`: 0..1 levels of a warm light at that anchor. */
  magic: { gem: number; flare: number; chest?: number; mouth?: number };
}

export interface BuiltFigure {
  key: string; /** The painted picture the layer reads; null: the figure draws without one. */ picture: string | null; /** Game px per builder unit. */ unit: number; /** Game px. */ top: number; hem: number;
  /** The key whose outline frame it shares when its own would not fit the atlas (the ice demon's is the fire demon's); else its own. */
  outline?: string;
  newMem(): unknown;
  draw(s: BuiltIn, dt: number, mem: unknown): BuiltDrawn;
  /** The rest pose's body without loose parts, for the lamp outline. */
  rest(): BuiltBuf;
  /** True once everything the layer needs is loaded; starts the loading. */
  ready(kit: FigureKit): boolean;
}

/** The built figures by entity kind: the lich (#358) and the demons (#379, #442). */
export const BUILT_OF_KIND: Partial<Record<number, BuiltFigure>> = { [KIND.Lich]: LICH_FIGURE, [KIND.FireDemon]: DEMON_FIGURE, [KIND.IceDemon]: ICE_DEMON_FIGURE };
export const builtOf = (kind: number): BuiltFigure | null => BUILT_OF_KIND[kind] ?? null;
/** The built figure of a key (`BuiltFigure.key`). */
export const builtWithKey = (key: string): BuiltFigure | null => Object.values(BUILT_OF_KIND).find((f) => f?.key === key) ?? null;

/**
 * A point of a built figure in the world (tiles): `a` in builder units in the model frame, turned by `yaw` (the model's +x goes to
 * (cos yaw, sin yaw), as `packInstance`'s root does), scaled by `scale`, placed at (`x`, `y`, `z`) with `y` the foot's world height.
 * `stretch` is 1 / cos(pitch) on the height. Writes `out` and returns it.
 */
export function builtPoint(a: V3, x: number, z: number, y: number, yaw: number, scale: number, stretch: number, out: V3): V3 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out[0] = x + (c * a[0] - s * a[2]) * scale;
  out[1] = y + a[1] * scale * stretch;
  out[2] = z + (s * a[0] + c * a[2]) * scale;
  return out;
}

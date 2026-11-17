// The description of a tube model (#357): an animal built from tubes, balls and drops, in the page px of the try-out
// (one page px is one wolf model px). `buildTubeFigure` (tubeModel.ts) turns it into a `FigureModel`.

import type { Bone, Stage } from './bones';
import type { Vec3 } from './desc';
import type { TubeOpts, TubePoint } from './tubes';

export type Shape =
  | { tube: readonly TubePoint[]; opts?: TubeOpts }
  | { ball: readonly [number, number, number]; pow?: number; turnZ?: number }
  | { drop: { r: number; len: number; sink: number; wide: number; dir: Vec3 } };

export interface TubePiece {
  shape: Shape; at?: Vec3; stage: Stage; bone: Bone;
  /** A flat colour, or the colour at `u` along and `d` round the tube (0 the top, 1 the underside). One painted piece per description. */
  colour: number | ((u: number, d: number) => number);
  /** The hull's thickness in page px at size 1 (the builder divides by `size`); 0: no hull (eyes). */
  line: number;
  /** Turned about `at` by this angle (rad, about z) before it is placed: a hind leg's rest angle. */
  turn?: number;
  /** A loose piece sways about its foot (a drop's or a tube's own direction and length); the neck bends as a whole about `origin`. */
  bend?: { sway: number; wag?: number } | { neck: { origin: readonly [number, number]; from: number; to: number } };
  /** The body tube the hit circle and the lying thickness are measured from. */
  torso?: boolean;
}

export interface TubeDesc {
  name: string; size: number; outline: number;
  pieces: readonly TubePiece[];
  /** Where each used bone turns (rest pose, page px). */
  pivots: Partial<Record<Bone, Vec3>>;
  /** Parents that differ from "hips": e.g. head: 'body', hat: 'head', handR: 'armR', leg1: 'leg0'. A parent must come before its child in BONES. */
  parents: Partial<Record<Bone, Bone>>;
  legs: readonly { upper: Bone; lower?: Bone; front: boolean }[];
  /** Half length and half width of the ground oval, page px at size 1. */
  footprint: readonly [number, number];
  hop?: number;
}

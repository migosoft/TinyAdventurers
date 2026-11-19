// The description of a tube model (#357): an animal built from tubes, balls and drops, in the page px of the try-out
// (one page px is one wolf model px). `buildTubeFigure` (tubeModel.ts) turns it into a `FigureModel`.

import type { Bone, Stage } from './bones';
import type { Vec3 } from './desc';
import type { TubeOpts, TubePoint } from './tubes';

/** One human's height in game px (a tile is 16): the default the two-legged tube models are sized by (#356). */
export const HUMAN_HEIGHT = 18;
/** The height factors of the two-legged models, of `HUMAN_HEIGHT`. The robes are drawn to their factor (robed.ts); the others are scaled by `fitSize`. */
export const HEIGHT_FACTOR = { knight: 1, robed: 1, orc: 1.1, goblin: 0.65, imp: 0.45, chort: 1.05, spectre: 1 } as const;
/**
 * The woodland animals' height factors, of `HUMAN_HEIGHT` (a human of 18 px is 1.75 m): the shoulder (the top of the chest) of the deer
 * and the boar, the ears' base of the sitting bunny. The stag (shoulder 12 px, head top 16) is within 10 % of its target and keeps its size.
 */
export const ANIMAL_FACTOR = { deer: 9 / 18, boar: 8 / 18, bunny: 3.5 / 18 } as const;
/** The glow of the demons' eyes (the Imp, the Chort): a bright saturated yellow (not a pack colour: the user's wish, 2026-11-18). */
export const DEMON_EYE = 0xffd21f;
/** `TubeDesc.size` that makes a figure drawn `drawn` game px high (at size 1; each description names the measured value) as tall as `factor` humans. */
export const fitSize = (factor: number, drawn: number): number => factor * HUMAN_HEIGHT / drawn;

/** Eyes painted on the head's surface by the material (never pieces): two ovals mirrored in z, slanted down toward the middle. Model px, rest pose. */
export interface EyeSpec {
  y: number; z: number;                 // the centre of one eye: height, and |z| off the middle
  front: number;                        // only where the rest x is at least this (the front of the head)
  half: readonly [number, number];      // half width (across z) and half height
  slant: number;                        // rad
  core: number; ring: number;           // colours
  strength: number;                     // 0..1
}
/** The second tone mixed into the black smoke (linear rgb). Purple is kept for a later, stronger creature. */
export const SMOKE_TONES = { grey: [0.105, 0.105, 0.125], purple: [0.13, 0.03, 0.26] } as const;
/** A body of smoke (the effects draw it; `fx/smoke.ts`). Model px, rest pose. */
export interface SmokeSpec {
  /** The body's middle line from the hump down to the tail's tip: [x forward, y up, half depth, half width]. */
  line: readonly (readonly [number, number, number, number])[];
  tone: readonly [number, number, number];
  /** Smoke the hard parts carry: a point on a bone, its radius, its share of the wisps, its rise factor. A point with `r` over 1 also gets a dense core patch. */
  on: readonly { bone: Bone; at: Vec3; r: number; weight: number; rise: number }[];
}
/** What makes a figure a spectre (#359): the Ghost and the Shade. */
export interface SpectreSpec {
  /** A body of smoke round the hard parts (the Shade). */
  smoke?: SmokeSpec;
  /** Drawn blended, nearest surface only. `peak`: the instance alpha that shows the approved look. */
  seeThrough?: { peak: number };
  eyes: EyeSpec;
  /** Black fog clings to it (the effects). */
  fog?: true;
  /** A soft glow quad and a floor light: `size` and `height` in px, `k` the glow's strength. */
  halo?: { size: number; height: number; glow: number; k: number; light: number; radius: number };
  /** The melee swoosh's colour on the model path, and the colour of its leading edge. */
  swoosh: { colour: number; head?: number };
}

export type Shape =
  | { tube: readonly TubePoint[]; opts?: TubeOpts }
  | { ball: readonly [number, number, number]; pow?: number; turnZ?: number }
  | { drop: { r: number; len: number; sink: number; wide: number; dir: Vec3 } }
  | { prism: { outline: readonly (readonly [number, number])[]; z: readonly [number, number] } };

export interface TubePiece {
  shape: Shape; at?: Vec3; stage: Stage; bone: Bone;
  /** A flat colour, or the colour at `u` along and `d` round the tube (0 the top, 1 the underside). One painted piece per description. */
  colour: number | ((u: number, d: number) => number);
  /** The hull's thickness in page px at size 1 (the builder divides by `size`); 0: no hull (eyes). */
  line: number;
  /** Turned about `at` by this angle (rad, about z) before it is placed: a hind leg's rest angle. */
  turn?: number;
  /** A loose piece sways about its foot (a drop's or a tube's own direction and length); the neck bends as a whole about `origin`. */
  bend?:
    | {
      sway: number; wag?: number;
      /**
       * The piece also flutters: `rate` in Hz, `angle` in rad at the tip. `axis` (a unit vector in the rest pose) is what the beat turns
       * about: for a wing, a line in its surface across its span, so the wing beats across its surface. Absent: about the line of sight (x),
       * the two sides opposite ways.
       */
      flutter?: { rate: number; angle: number; axis?: Vec3 };
      /** The share of the piece's length over which the bend builds up (default 1: the whole piece curls). Below 1 the piece is stiff beyond it: it turns about its foot like a hinged wing. */
      hinge?: number;
    }
    | { neck: { origin: readonly [number, number]; from: number; to: number } }
    /** The piece bends with an earlier swaying piece of the description on the same bone, as one part of it (a wing's finger bones on its membrane): the same foot, line and turn. It takes no bend of its own. */
    | { with: TubePiece };
  /** The part of this piece below `TubeDesc.robeTop` swings as the robe's hem. */
  robe?: true;
  /** Polished steel (look value 1). */
  metal?: true;
  /** The piece glows (look value 3): it shows its own colour whatever light falls on it (eyes in the dark). Give it `line` 0. */
  glow?: true;
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
  /** 'two': an upright figure that walks on two legs (or none). Absent: four legs, as before. */
  stance?: 'two';
  /**
   * 'two' only: both arms hang straight down from the pivots of armR and armL; a hand ball ends each, its middle `length` below the
   * shoulder. A held weapon's grip lies in that middle (the weapon bones' pivots).
   */
  arms?: {
    length: number; radius: number;
    /** The share of a blow's arm lengthening these arms take (default 1); arms of a natural length need little. Arms with an elbow are never lengthened. */
    stretch?: number;
    /**
     * The upper arm's length: the arm has an elbow that far below the shoulder. The pieces of the upper arm hang on `armR` / `armL`;
     * the forearm's and the hand's hang on `handR` / `handL`, which then turn about the elbow. Such an arm carries a weapon with the
     * forearm held forward, and draws a bow with a bent arm (pose3d.ts).
     */
    elbow?: number;
    /** With an elbow: how far forward (rad) the forearm of an empty hand is held, instead of hanging nearly straight (pose3d.ts, `ELBOW.free`): claws held ready in front of the body. */
    free?: number;
    /**
     * With an elbow: in a shot the bow arm points straight ahead from its shoulder, instead of crossing to the body's middle line. For a
     * figure whose head stands in front of its shoulders: on the middle line the bow would pass through its face.
     */
    bowAhead?: true;
  };
  /** The height (page px) below which `robe` pieces swing. */
  robeTop?: number;
  /** A factor on the size of the held weapon (default 1). */
  weapon?: number;
  legs: readonly { upper: Bone; lower?: Bone; front: boolean; /** -1: the knee bends the other way. */ knee?: -1 }[];
  /** Half length and half width of the ground oval, page px at size 1. */
  footprint: readonly [number, number];
  hop?: number;
  /** The figure floats: no legs step, nothing moves in time with the speed (pose3d.ts). Two-legged descriptions (`stance: 'two'`) only; the builder ignores it otherwise. */
  float?: true;
  /** With `float`: a melee swings the arm from its limp hang (the Ghost; the user, 2026-11-19). Without it the arms stay limp in a blow (the Shade). */
  swipe?: true;
  /** With `float`: the parts float apart. Nothing joins them; each drifts on its own and a blow moves an arm's root (pose3d.ts, `APART`). The description gives explicit pivots for armR, handR (the elbow), armL, handL and no `arms`. */
  apart?: true;
  spectre?: SpectreSpec;
}

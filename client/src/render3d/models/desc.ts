// The description format of the 3D figure models (#338). A creature is only a description: a base (a side view of
// head and body in flat colours, the front on the right) and a list of add-ons. The numbers are in sprite pixels
// (16 columns, rows counted from the top of a 28 row grid) unless a field says otherwise.

/** One letter of a side view stands for a colour of `FigureDesc.colours`. */
export type ColourKey = string;

export type Vec3 = readonly [number, number, number];

/** Which part an add-on is placed on or measured from. */
export type PartRef = 'head' | 'body' | 'hair';

export interface PartDesc {
  /** The sprite rows the part covers: from, to. */
  rows?: readonly [number, number];
  /** The body narrows (or widens) from row `from` to the factor `to` at its lower end. */
  taper?: { from: number; to: number };
  /** The lower end is open (a robe with a flat end, no rounded bottom). */
  open?: boolean;
  /** The profile's exponent (a squarish ball for below 1). */
  pow?: number;
  /** The part's own side view (otherwise the figure's `side`). */
  side?: readonly string[];
  /** The sprite row of this part's first `side` line. */
  firstRow?: number;
  /** The part lies (a quadruped's body): its side view is turned about its length. */
  lie?: boolean;
  paintFrom?: number;
}

export interface EyesDesc {
  rows: readonly [number, number];
  width: number;
  colour: number;
  /** Degrees to each side of straight ahead. */
  at: number;
}

export interface HairDesc {
  colour: ColourKey;
  thick: number;
  from: number;
  below?: boolean;
  /** Per sprite row from `from`, how far it reaches from the back towards the front (1 = all round). */
  cover: readonly number[];
}

export interface SpikeDesc {
  colour: ColourKey;
  row: number;
  x?: number;
  /** The part it hangs on (the head if left out). */
  on?: 'head' | 'body';
  front?: { of: PartRef; inset: number };
  side?: { of: PartRef; inset: number };
  dir: Vec3;
  radius: number;
  length: number;
  sink: number;
  sway?: number;
  shape?: 'wave' | 'drop' | 'ball';
  wave?: number;
  flat?: number;
  flatAxis?: 'x' | 'z';
  line?: number;
  wag?: number;
}

export interface ShellDesc {
  colour: ColourKey;
  thick: number;
  lift: number;
  from: number;
  to?: number;
  below?: boolean;
  front?: boolean;
  cover: readonly number[];
  line?: number;
}

/** A turned-up collar: it starts on the shirt (`row`), is open at the front by `gap` degrees to each side. */
export interface CollarDesc {
  colour: ColourKey;
  row: number;
  like: number;
  gap: number;
  back: number;
  tip: number;
  tilt: number;
  thick: number;
}

export interface SeamDesc {
  row: number;
  like: number;
}

/** Thin rings around the body (ribs). */
export interface RingDesc {
  colour: ColourKey;
  row: number;
  like: number;
  out: number;
  thick: number;
  high: number;
  line: number;
}

export interface HatDesc {
  colour: ColourKey;
  band: ColourKey;
  row: number;
  brim: number;
  radius: number;
  height: number;
  lean: number;
  /** Pushed back, so the brim does not hide the face. */
  tilt: number;
  sway: number;
}

export interface LegsDesc {
  top: number;
  colour: ColourKey;
  radius: number;
  foot: number;
  apart: number;
  /** Two pairs: how far in front of and behind the body's middle. */
  at?: readonly [number, number];
}

export interface ArmsDesc {
  row: number;
  colour: ColourKey;
  hand: ColourKey;
  radius: number;
  length: number;
  metal?: boolean;
  out?: number;
}

/** The visor's painted lines, narrower than a sprite pixel. */
export interface VisorDesc {
  rows: readonly [number, number];
  half: number;
  line: number;
  slits: number;
  slitWide: number;
  frame: number;
  slit: number;
}

export interface FigureDesc {
  name: string;
  scale?: number;
  outline: number;
  centre: number;
  /** Polished steel instead of flat colours. */
  metal?: boolean;
  /** Four legs. */
  quad?: boolean;
  colours: Readonly<Record<ColourKey, number>>;
  firstRow: number;
  /** Lines of 16 characters, one letter per sprite pixel. */
  side: readonly string[];
  /** Head, then body. */
  parts: readonly [PartDesc, PartDesc];
  /** Colours (by key) lightened by this much on raised parts. */
  raised?: Readonly<Record<ColourKey, number>>;
  eyes?: EyesDesc;
  visor?: VisorDesc;
  hair?: HairDesc;
  shells?: readonly ShellDesc[];
  collar?: CollarDesc;
  seams?: readonly SeamDesc[];
  rings?: readonly RingDesc[];
  hat?: HatDesc;
  spikes?: readonly SpikeDesc[];
  legs?: LegsDesc;
  arms?: ArmsDesc;
  /** How far in front of the body's middle the head sits. */
  headAt?: number;
  /** Where the head turns: sprite pixels forward, sprite row. */
  neck?: readonly [number, number];
}

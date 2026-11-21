// The texel format of the stone sheets (#380): one RGBA8 texel is colour (rgb) and relief (a). Pure: it imports no three.

/** A page of a sheet is one chunk: PAGE by PAGE px (16 tiles of 32 px). */
export const PAGE = 512;
/** A wall face's slot in a wall page: one tile wide, `WALL_H` (2) tiles tall, in px. */
export const FACE_W = 32, FACE_H = 64;

/** What the relief's flag says about a texel: a joint or crack (embers and moss follow it), or the black of a crevice. */
export const FLAG = { plain: 0, groove: 1, pit: 2 } as const;

/**
 * The seven slopes a texel can lean by along one sheet axis, in height per px, symmetric about zero (index 3 is flat). A first guess:
 * the steepest, 0.5, is a face leaning about 27 degrees; the painter picks the nearest.
 */
export const SLOPES: readonly number[] = [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5];

/** The nearest index of `SLOPES` to a slope (beyond the table: the end). */
function slopeIndex(s: number): number {
  let best = 0;
  for (let i = 1; i < SLOPES.length; i++) if (Math.abs(SLOPES[i] - s) < Math.abs(SLOPES[best] - s)) best = i;
  return best;
}

/** The relief byte: `flag << 6 | sx << 3 | sy`, sx for the slope along u, sy along v. Slopes snap to the table, a flag is masked to its two bits. */
export function encodeRelief(dhdu: number, dhdv: number, flag: number): number {
  return ((flag & 3) << 6) | (slopeIndex(dhdu) << 3) | slopeIndex(dhdv);
}

/** What `encodeRelief` kept: the table's slopes and the flag. */
export function decodeRelief(a: number): { dhdu: number; dhdv: number; flag: number } {
  return { dhdu: SLOPES[(a >> 3) & 7] ?? 0, dhdv: SLOPES[a & 7] ?? 0, flag: (a >> 6) & 3 };
}

/** Flat and plain: the relief byte of a texel nobody has painted. */
export const FLAT_A = encodeRelief(0, 0, FLAG.plain);

/** The colour (0..255) a page has until it is painted: a flat brown-grey stone, so a page that is not ready yet does not flash. */
export const FLAT_RGB: readonly [number, number, number] = [104, 94, 84];

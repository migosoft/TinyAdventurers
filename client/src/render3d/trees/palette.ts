// The leaf palettes of the 3D trees: one set of ramps per `LEAF_PALETTE` id, and the 5 x 4 texture data the tree material reads.
import { LEAF_PALETTE } from '../../generated/defs';
import { P } from './kinds';
import { RAMP } from './mesh';

type Rgb = [number, number, number];

export interface TreePalette { leaf: Rgb[]; conifer: Rgb[]; bark: Rgb[]; dead: Rgb[] }

const ramp = (keys: string): Rgb[] => [...keys].map((k) => P[k]);

/** The ramps by palette id, dark to light: leaf (5 tones), conifer (5), bark (4), dead wood (4). */
export const LEAF_PALETTES: Record<number, TreePalette> = {
  [LEAF_PALETTE.Summer]: { leaf: ramp('01234'), conifer: ramp('56789'), bark: ramp('abcd'), dead: ramp('efgh') },
};

/** RGBA texels of a palette: 5 columns (tones, dark to light), one row per `RAMP` row; the 4-tone rows repeat their last tone. */
export function paletteBytes(id: number): Uint8Array {
  const pal = LEAF_PALETTES[id];
  const rows: Rgb[][] = [];
  rows[RAMP.leaf] = pal.leaf;
  rows[RAMP.conifer] = pal.conifer;
  rows[RAMP.bark] = pal.bark;
  rows[RAMP.dead] = pal.dead;
  const out = new Uint8Array(5 * rows.length * 4);
  rows.forEach((r, y) => {
    for (let x = 0; x < 5; x++) out.set([...r[Math.min(x, r.length - 1)], 255], (y * 5 + x) * 4);
  });
  return out;
}

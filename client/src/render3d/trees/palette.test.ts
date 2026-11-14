import { describe, expect, it } from 'vitest';
import { LEAF_PALETTE } from '../../generated/defs';
import { P } from '../../game/vegetation/canvas';
import { LEAF_PALETTES, paletteBytes } from './palette';
import { RAMP } from './mesh';

const texel = (b: Uint8Array, row: number, col: number): number[] => [...b.slice((row * 5 + col) * 4, (row * 5 + col) * 4 + 4)];

describe('the leaf palettes', () => {
  it('has an entry for every palette id', () => {
    for (const id of Object.values(LEAF_PALETTE)) expect(LEAF_PALETTES[id], `id ${id}`).toBeDefined();
  });

  it('Summer is the generator\'s ramps', () => {
    const s = LEAF_PALETTES[LEAF_PALETTE.Summer];
    expect(s.leaf).toEqual(['0', '1', '2', '3', '4'].map((c) => P[c]));
    expect(s.conifer).toEqual(['5', '6', '7', '8', '9'].map((c) => P[c]));
    expect(s.bark).toEqual(['a', 'b', 'c', 'd'].map((c) => P[c]));
    expect(s.dead).toEqual(['e', 'f', 'g', 'h'].map((c) => P[c]));
  });

  it('the bytes are 5 x 4 RGBA texels, rows in RAMP order, 4-tone rows repeating their last tone', () => {
    const b = paletteBytes(LEAF_PALETTE.Summer);
    expect(b).toHaveLength(5 * 4 * 4);
    expect(texel(b, RAMP.leaf, 0)).toEqual([...P['0'], 255]);
    expect(texel(b, RAMP.leaf, 4)).toEqual([...P['4'], 255]);
    expect(texel(b, RAMP.conifer, 2)).toEqual([...P['7'], 255]);
    expect(texel(b, RAMP.bark, 3)).toEqual([...P.d, 255]);
    expect(texel(b, RAMP.bark, 4)).toEqual([...P.d, 255]);
    expect(texel(b, RAMP.dead, 0)).toEqual([...P.e, 255]);
    expect([0, 1, 2, 3, 4].map((c) => texel(b, 3, c))).toEqual([P.e, P.f, P.g, P.h, P.h].map((c) => [...c, 255]));
  });
});

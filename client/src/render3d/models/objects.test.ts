import { describe, expect, it } from 'vitest';
import { KIND } from '../../generated/defs';
import { HITBOX } from '../../generated/defs';
import { buildJob } from './build';
import { chest, chestShell } from './descs/chest';
import { mimic } from './descs/mimic';
import { expectFinite, expectStreams } from './modelChecks.testutil';
import { MODEL_OF_KIND, objectModelOf, TUBE_DESCS } from './table';
import type { Shape, TubePiece } from './tubeDesc';
import { hitRadius } from './tubeModel';
import { ball, prism, tube } from './tubes';

const meshOf = (s: Shape) => ('tube' in s ? tube(s.tube, s.opts) : 'ball' in s ? ball(s.ball[0], s.ball[1], s.ball[2], s.pow, s.turnZ) : 'prism' in s ? prism(s.prism.outline, s.prism.z[0], s.prism.z[1]) : null)!;
/** The box a piece fills in the rest pose: [lo, hi] per axis. */
function boxOf(pieces: readonly TubePiece[]): { lo: number[]; hi: number[] } {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pieces) {
    const m = meshOf(p.shape), at = p.at ?? [0, 0, 0];
    for (let i = 0; i < m.position.length; i++) { const v = m.position[i] + at[i % 3]; lo[i % 3] = Math.min(lo[i % 3], v); hi[i % 3] = Math.max(hi[i % 3], v); }
  }
  return { lo, hi };
}
const recoloured = (ps: TubePiece[]): TubePiece[] => ps.map((p) => ({ ...p, colour: p.colour === 1 || p.colour === 2 ? 0 : p.colour }));

describe('the chest and the Mimic', () => {
  it('the server circle is 6 for both', () => {
    expect(hitRadius(chest)).toBe(6);
    expect(hitRadius(mimic)).toBe(6);
    expect(HITBOX[KIND.Chest].r).toBe(6);
    expect(HITBOX[KIND.Mimic].r).toBe(6);
  });

  for (const [name, desc] of [['chest', chest], ['mimic', mimic]] as const) {
    describe(name, () => {
      const m = buildJob(name, null);
      it('has consistent, finite streams', () => { expectStreams(m); expectFinite(m); });
      it('is one game px per description px, 9 high closed', () => {
        expect(m.scale).toBeCloseTo(1, 3);
        expect(m.baseHeight).toBeCloseTo(9, 2);
        expect(m.stands!).toBeLessThanOrEqual(9.3);
      });
      it('the trough and the arch span the closed box', () => {
        const { lo, hi } = boxOf(desc.pieces.filter((p) => p.torso || (p.bone === 'head' && p.stage === 'head' && 'prism' in p.shape && p.colour === 0xee8e2e)));
        expect(lo[0]).toBeCloseTo(-4.5, 2); expect(hi[0]).toBeCloseTo(4.5, 2);
        expect(lo[2]).toBeCloseTo(-7, 2); expect(hi[2]).toBeCloseTo(7, 2);
        expect(lo[1]).toBeCloseTo(0, 2); expect(hi[1]).toBeCloseTo(9, 2);
      });
    });
  }

  it('both are hollow; the same size in both', () => {
    expect(buildJob('chest', null).stands).toBe(buildJob('mimic', null).stands);
  });

  it('the Mimic starts with the chest shell in its own lining; the lining is the only difference', () => {
    const shell = chestShell(0x5f2d56);
    expect(mimic.pieces.slice(0, shell.length)).toEqual(shell);
    expect(recoloured(chestShell(1))).toEqual(recoloured(chestShell(2)));
    expect(chestShell(1)).not.toEqual(chestShell(2));
  });

  it('the lid is at the hinge height or above, the base at it or below', () => {
    for (const p of chestShell(1)) {
      const { lo, hi } = boxOf([p]);
      if (p.bone === 'head') expect(lo[1], 'head piece').toBeGreaterThanOrEqual(5.5 - 1e-6);
      else { expect(p.bone).toBe('body'); expect(hi[1], 'body piece').toBeLessThanOrEqual(5.5 + 1e-6); }
    }
  });

  it('the chest has loot on the hat bone', () => {
    expect(chest.pieces.filter((p) => p.bone === 'hat').length).toBeGreaterThanOrEqual(4);
  });

  it('the Mimic has eleven teeth inside the closed shell and one swaying tongue', () => {
    const teeth = mimic.pieces.filter((p) => p.colour === 0xfdf7ed);
    expect(teeth).toHaveLength(11);
    expect(teeth.filter((p) => p.bone === 'body')).toHaveLength(6);
    expect(teeth.filter((p) => p.bone === 'head')).toHaveLength(5);
    for (const t of teeth) {
      const { lo, hi } = boxOf([t]);
      expect(Math.max(-lo[0], hi[0])).toBeLessThan(3.5);
      expect(Math.max(-lo[2], hi[2])).toBeLessThan(6);
      expect(lo[1]).toBeGreaterThanOrEqual(1);
      expect(hi[1]).toBeLessThanOrEqual(8.2);
    }
    const tongue = mimic.pieces.filter((p) => p.colour === 0xdc4a7b);
    expect(tongue).toHaveLength(1);
    expect(tongue[0].bone).toBe('hat');
    expect(tongue[0].bend).toMatchObject({ sway: 1 });
  });

  it('the object table maps the chest and the Mimic, and the creature table has neither', () => {
    expect(objectModelOf(KIND.Chest)).toBe('chest');
    expect(objectModelOf(KIND.Mimic)).toBe('mimic');
    expect(objectModelOf(KIND.Wizard)).toBeNull();
    expect(MODEL_OF_KIND[KIND.Chest]).toBeUndefined();
    expect(MODEL_OF_KIND[KIND.Mimic]).toBeUndefined();
    expect(TUBE_DESCS.chest).toBe(chest);
    expect(TUBE_DESCS.mimic).toBe(mimic);
  });
});

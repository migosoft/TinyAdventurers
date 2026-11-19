import { describe, expect, it } from 'vitest';
import { KIND } from '../../generated/defs';
import { HITBOX } from '../../generated/defs';
import { buildJob } from './build';
import { barrel } from './descs/barrel';
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

  it('the chest and the Mimic stand the same height', () => {
    expect(buildJob('chest', null).stands).toBe(buildJob('mimic', null).stands);
  });

  it('both are hollow: no body piece but the lining has a mesh point inside the cavity', () => {
    const lining = chestShell(0).map((p) => p.colour === 0);
    expect(lining.some(Boolean)).toBe(true);
    for (const [name, desc] of [['chest', chest], ['mimic', mimic]] as const) {
      const solid = desc.pieces.slice(0, lining.length).filter((p, i) => !lining[i] && p.bone === 'body');
      expect(solid.length, name).toBeGreaterThan(0);
      for (const p of solid) {
        const m = meshOf(p.shape), at = p.at ?? [0, 0, 0];
        for (let i = 0; i < m.position.length; i += 3) {
          const [x, y, z] = [m.position[i] + at[0], m.position[i + 1] + at[1], m.position[i + 2] + at[2]];
          expect(Math.abs(x) < 3.4 && Math.abs(z) < 5.9 && y > 1.1 && y < 5.5, `${name} point ${x}, ${y}, ${z}`).toBe(false);
        }
      }
    }
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

  it('all trim (gold and seams, not the lining) is stage collar, on both bones', () => {
    // With the lining colour 0 the only gold and seam-coloured pieces are the trim.
    const shell = chestShell(0), trim = shell.filter((p) => p.colour === 0xfacb3e || p.colour === 0x38262d);
    expect(trim.length).toBeGreaterThan(0);
    expect(new Set(trim.map((p) => p.bone))).toEqual(new Set(['body', 'head']));
    for (const p of trim) expect(p.stage).toBe('collar');
    // The wood, the end walls and plates and the linings are not trim.
    for (const p of shell.filter((q) => !trim.includes(q))) expect(p.stage).toBe(p.bone === 'body' ? 'body' : 'head');
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

describe('the barrel', () => {
  it('the server circle is 6', () => {
    expect(hitRadius(barrel)).toBe(6);
    expect(HITBOX[KIND.Barrel].r).toBe(6);
  });

  it('has consistent, finite streams', () => {
    const m = buildJob('barrel', null);
    expectStreams(m); expectFinite(m);
  });

  it('reaches 6.4 in x and z and is 15 high', () => {
    const { lo, hi } = boxOf(barrel.pieces);
    expect(Math.max(-lo[0], hi[0])).toBeCloseTo(6.4, 1);
    expect(Math.max(-lo[2], hi[2])).toBeCloseTo(6.4, 1);
    // The lid top sits at 15.4, the tolerance of 0.4 is met by 0.005.
    expect(Math.abs(hi[1] - lo[1] - 15), `y ${lo[1]}..${hi[1]}`).toBeLessThanOrEqual(0.4);
  });

  it('has one painted piece, holding the hoop, band, seam and stave colours', () => {
    const painted = barrel.pieces.filter((p) => typeof p.colour === 'function');
    expect(painted).toHaveLength(1);
    const paint = painted[0].colour as (u: number, d: number) => number, seen = new Set<number>();
    for (let u = 0; u <= 1; u += 0.01) for (let d = 0; d < 1; d += 0.01) seen.add(paint(u, d));
    expect(seen).toEqual(new Set([0x7b8994, 0xda4e38, 0x38262d, 0xc56025]));
    expect(paint(0.23, 0.5)).toBe(0x7b8994);
    expect(paint(0.5, 0.5)).toBe(0xda4e38);
    expect(paint(0.1, 0.02)).toBe(0x38262d);
    expect(paint(0.1, 0.125)).toBe(0xc56025);
  });

  it('the baked paint has 8 even staves round: 8 seams of 2 rows, 8 woods of 6 rows', () => {
    const { paint } = buildJob('barrel', null), x = Math.floor(0.1 * paint.w);
    const seam = Array.from({ length: paint.h }, (_, y) => {
      const i = (y * paint.w + x) * 4, c = (paint.data[i] << 16) | (paint.data[i + 1] << 8) | paint.data[i + 2];
      expect([0x38262d, 0xc56025]).toContain(c);
      return c === 0x38262d;
    });
    // Runs counted cyclically: start at a change of colour, so a run across the wrap is one.
    const start = seam.findIndex((s, y) => s !== seam[(y + paint.h - 1) % paint.h]);
    const runs: { seam: boolean; len: number }[] = [];
    for (let k = 0; k < paint.h; k++) {
      const s = seam[(start + k) % paint.h];
      if (runs.length && runs[runs.length - 1].seam === s) runs[runs.length - 1].len++; else runs.push({ seam: s, len: 1 });
    }
    expect(runs.filter((r) => r.seam)).toHaveLength(8);
    expect(runs.filter((r) => !r.seam)).toHaveLength(8);
    for (const r of runs) expect(r.len).toBe(r.seam ? 2 : 6);
  });

  it('has no bends', () => {
    for (const p of barrel.pieces) expect(p.bend).toBeUndefined();
  });

  it('the object table maps the barrel, and the creature table does not', () => {
    expect(objectModelOf(KIND.Barrel)).toBe('barrel');
    expect(MODEL_OF_KIND[KIND.Barrel]).toBeUndefined();
    expect(TUBE_DESCS.barrel).toBe(barrel);
  });
});

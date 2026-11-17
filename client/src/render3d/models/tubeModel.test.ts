import { describe, expect, it } from 'vitest';
import { BONES, MAX_BENDS, STAGES } from './bones';
import { buildJob, transferList } from './build';
import { buildFigure } from './model';
import { PAGE_TO_GAME, hitRadius } from './tubeModel';
import { tube } from './tubes';
import { DESCS, TUBE_DESCS } from './table';

const keys = ['stag', 'deer'] as const;
const bone = (n: (typeof BONES)[number]): number => BONES.indexOf(n);
const rgb = (hex: number): number[] => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

describe('buildTubeFigure', () => {
  it('PAGE_TO_GAME is the wolf model fitted scale', () => {
    expect(buildFigure('wolf', DESCS.wolf, 19).scale).toBeCloseTo(PAGE_TO_GAME, 3);
  });

  for (const key of keys) {
    const m = buildJob(key, null), d = TUBE_DESCS[key], n = m.position.length / 3;

    describe(key, () => {
      it('has consistent streams, ranges and index lists', () => {
        expect(m.normal.length).toBe(n * 3);
        expect(m.uv.length).toBe(n * 2);
        expect(m.skin.length).toBe(n * 4);
        expect(m.look.length).toBe(n * 4);
        for (const i of m.index) expect(i).toBeLessThan(n);
        expect(m.pieceIndex.length + m.lineIndex.length).toBe(m.index.length);
        let at = 0, lastStage = -1, hullSeen = false;
        for (const r of m.ranges) {
          expect(r.start).toBe(at); at += r.count;
          expect(r.stage).toBeGreaterThanOrEqual(lastStage);
          if (r.stage !== lastStage) hullSeen = false;
          if (r.line) { expect(hullSeen, 'hull after a piece').toBe(false); } else hullSeen = true;
          lastStage = r.stage;
        }
        expect(at).toBe(m.index.length);
        expect(lastStage).toBeLessThan(STAGES.length);
      });

      it('scale, size and flags', () => {
        expect(m.scale).toBeCloseTo((key === 'stag' ? 0.95 : 0.88) * PAGE_TO_GAME, 6);
        expect(m.size).toBe(1);
        expect(m.quad).toBe(true);
        expect(m.armLength).toBe(0);
        expect(m.hatSway).toBe(0);
        expect(m.varies).toBe(true);
        expect(m.robeTop).toBeNull();
      });

      it('stands on the ground', () => {
        let low = Infinity;
        for (let i = 0; i < n; i++) if (m.skin[i * 4 + 1] === 0) low = Math.min(low, m.position[i * 3 + 1]);
        expect(Math.abs(low)).toBeLessThan(0.3 / m.scale);
        expect(m.stands).toBeGreaterThan(0);
      });

      it('bones: parents, legs and hat', () => {
        for (let b = 0; b < BONES.length; b++) { if (b === 0) expect(m.parents[b]).toBe(-1); else expect(m.parents[b]).toBeLessThan(b); }
        const onHat = Array.from({ length: n }, (_, i) => m.skin[i * 4]).filter((b) => b === bone('hat')).length;
        if (key === 'stag') { expect(onHat).toBeGreaterThan(0); expect(m.butt).toBe(true); } else { expect(onHat).toBe(0); expect(m.butt).toBeFalsy(); }
        expect(m.legs).toHaveLength(4);
        expect(m.legs!.every((l) => l.lower >= 0)).toBe(true);
        expect(m.legs!.filter((l) => l.front)).toHaveLength(2);
        expect(m.legs!.filter((l) => l.front).map((l) => [l.upper, l.lower])).toEqual([[bone('armR'), bone('handR')], [bone('armL'), bone('handL')]]);
        expect(m.legs!.filter((l) => !l.front).map((l) => [l.upper, l.lower])).toEqual([[bone('leg0'), bone('leg1')], [bone('leg2'), bone('leg3')]]);
      });

      it('bends: the neck, a tail and two ears', () => {
        expect(m.bends).toHaveLength(MAX_BENDS);
        expect(m.bends[m.neckBend!].neck).toBe(true);
        expect(m.bends.filter((b) => !b.neck)).toHaveLength(3);
        const w: number[] = [];
        for (let i = 0; i < n; i++) if (m.skin[i * 4 + 2] === m.neckBend && m.skin[i * 4 + 1] === 0) w.push(m.skin[i * 4 + 3]);
        expect(Math.min(...w)).toBe(0);
        expect(Math.max(...w)).toBe(1);
        const torso = d.pieces.findIndex((p) => p.torso);
        expect(torso).toBeGreaterThanOrEqual(0);
        // the torso (painted) vertices bend with nothing
        for (let i = 0; i < n; i++) if (m.look[i * 4] === -1) expect(m.skin[i * 4 + 2]).toBe(-1);
      });

      it('colours: neck, paint and hull offset', () => {
        const neckColour = key === 'stag' ? rgb(0x6e4028) : rgb(0x9a5a34);
        let found = 0;
        for (let i = 0; i < n; i++) if (m.skin[i * 4 + 2] === m.neckBend && m.skin[i * 4 + 1] === 0) {
          found++;
          for (let c = 0; c < 3; c++) expect(m.look[i * 4 + c]).toBeCloseTo(neckColour[c], 5);
        }
        expect(found).toBeGreaterThan(0);
        expect(m.look.some((v, i) => i % 4 === 0 && v === -1)).toBe(true);
        const px = new Set<number>();
        for (let i = 0; i < m.paint.data.length; i += 4) px.add((m.paint.data[i] << 16) | (m.paint.data[i + 1] << 8) | m.paint.data[i + 2]);
        for (const c of [0xf2e6cf, 0xd9b88a, 0x9a5a34]) expect(px.has(c)).toBe(true);
        expect(m.paint.w).toBe(128); expect(m.paint.h).toBe(64);
      });

      it('survives the worker hand-over', () => {
        const c = structuredClone(m);
        for (const k of Object.keys(m) as (keyof typeof m)[]) expect(c[k], k).toEqual(m[k]);
        const bufs = transferList(m);
        for (const a of [m.position, m.normal, m.uv, m.skin, m.look, m.index, m.pieceIndex, m.lineIndex, m.pivots, m.parents, m.paint.data]) expect(bufs).toContain(a.buffer);
      });
    });
  }

  it('the stag stands 22 to 25 game px, the deer lower', () => {
    const s = buildJob('stag', null), e = buildJob('deer', null);
    expect(s.stands! * s.scale).toBeGreaterThan(22);
    expect(s.stands! * s.scale).toBeLessThan(25);
    expect(e.stands! * e.scale).toBeLessThan(s.stands! * s.scale);
  });

  it('hulls are line / size model px out; the eyes have none', () => {
    const d = TUBE_DESCS.stag, m = buildJob('stag', null);
    const hullPieces = d.pieces.filter((p) => p.line > 0).length;
    expect(hullPieces).toBe(d.pieces.length - 2);   // the two eyes
    // The body stage: the torso's and the neck's hulls first, then the torso and the neck themselves.
    const torso = d.pieces[0], neck = d.pieces[1];
    const count = (p: typeof torso): number => {
      const sh = p.shape as Extract<typeof p.shape, { tube: unknown }>;
      return tube(sh.tube, sh.opts).position.length / 3;
    };
    const ct = count(torso), cn = count(neck);
    let s = 0;
    while (!(m.skin[s * 4] === bone('body') && m.skin[s * 4 + 1] === 1 && m.skin[(s + ct + cn) * 4 + 1] === 0)) s++;
    const want = 0.45 / d.size;
    for (let i = 0; i < ct; i++) {
      const h = s + i, p = s + ct + cn + i;
      expect(Math.hypot(m.position[h * 3] - m.position[p * 3], m.position[h * 3 + 1] - m.position[p * 3 + 1], m.position[h * 3 + 2] - m.position[p * 3 + 2])).toBeCloseTo(want, 4);
    }
    // the eyes are the only pieces without a hull
    expect(m.ranges.filter((r) => r.line).length).toBeGreaterThan(0);
  });

  it('hit radius', () => {
    expect(hitRadius(TUBE_DESCS.stag)).toBe(5);
    expect(hitRadius(TUBE_DESCS.deer)).toBe(5);
  });

  it('a bad description throws an error that names it', () => {
    const base = TUBE_DESCS.stag, ear = base.pieces.find((p) => p.bend && 'sway' in p.bend)!;
    const bad = { ...base, name: 'Bad Stag' };
    expect(() => require_build({ ...bad, pieces: [...base.pieces, ear, ear] })).toThrow(/Bad Stag/);
    const painted = base.pieces.find((p) => typeof p.colour === 'function')!;
    expect(() => require_build({ ...bad, pieces: [...base.pieces, painted] })).toThrow(/Bad Stag/);
    expect(() => require_build({ ...bad, parents: { ...base.parents, leg0: 'leg1' } })).toThrow(/Bad Stag/);
  });
});

import { buildTubeFigure } from './tubeModel';
import type { TubeDesc } from './tubeDesc';
const require_build = (d: TubeDesc) => buildTubeFigure('bad', d);

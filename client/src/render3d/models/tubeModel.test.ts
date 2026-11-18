import { describe, expect, it } from 'vitest';
import { KIND } from '../../generated/defs';
import { FIGURES } from '../../game/anim/defs';
import { BONES, MAX_BENDS, STAGES, weaponBoneOf } from './bones';
import { buildJob, transferList } from './build';
import { buildFigure, type FigureModel } from './model';
import { PAGE_TO_GAME, hitRadius } from './tubeModel';
import { tube, type TubePoint } from './tubes';
import { DESCS, MODEL_OF_KIND, TUBE_DESCS, type TubeKey } from './table';
import { orcDesc } from './descs/orc';
import { HUMAN_HEIGHT } from './tubeDesc';
import { robedDesc } from './descs/robed';
import { DEMON_EYE } from './descs/imp';

const keys = ['stag', 'deer', 'boar', 'bunny'] as const;
const SIZE = { stag: 0.95, deer: 0.88, boar: 0.9, bunny: 0.75 } as const;
const deers = (key: string): boolean => key === 'stag' || key === 'deer';
const bone = (n: (typeof BONES)[number]): number => BONES.indexOf(n);
const rgb = (hex: number): number[] => [(hex >> 16) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** The streams are as long as the vertex count says, the index stays inside it, and the ranges tile the index by stage, hulls first. */
function expectStreams(m: FigureModel): void {
  const n = m.position.length / 3;
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
}

function expectFinite(m: FigureModel): void {
  for (const arr of [m.position, m.normal, m.pivots]) expect(arr.every(Number.isFinite)).toBe(true);
  for (const bd of m.bends) {
    const nums = [bd.bone, ...bd.origin, ...bd.dir, bd.len, bd.k, bd.up, bd.wag, ...(bd.flutter ? [bd.flutter.rate, bd.flutter.angle] : [])];
    expect(nums.every(Number.isFinite), JSON.stringify(bd)).toBe(true);
  }
}

/** Every colour a model shows: the flat colours of its pieces (not the hulls) and the pixels of its paint. */
function coloursOf(m: FigureModel): Set<number> {
  const seen = new Set<number>(), n = m.position.length / 3, c = (v: number): number => Math.round(v * 255);
  for (let i = 0; i < n; i++) if (m.skin[i * 4 + 1] === 0 && m.look[i * 4] !== -1) seen.add((c(m.look[i * 4]) << 16) | (c(m.look[i * 4 + 1]) << 8) | c(m.look[i * 4 + 2]));
  if (m.look.some((v, i) => i % 4 === 0 && v === -1)) for (let i = 0; i < m.paint.data.length; i += 4) seen.add((m.paint.data[i] << 16) | (m.paint.data[i + 1] << 8) | m.paint.data[i + 2]);
  return seen;
}

describe('buildTubeFigure', () => {
  it('PAGE_TO_GAME is the wolf model fitted scale', () => {
    expect(buildFigure('wolf', DESCS.wolf, 19).scale).toBeCloseTo(PAGE_TO_GAME, 3);
  });

  for (const key of keys) {
    const m = buildJob(key, null), d = TUBE_DESCS[key], n = m.position.length / 3;

    describe(key, () => {
      it('has consistent streams, ranges and index lists', () => expectStreams(m));

      it('has finite positions, normals, pivots and bends', () => expectFinite(m));

      it('scale, size and flags', () => {
        expect(m.scale).toBeCloseTo(SIZE[key] * PAGE_TO_GAME, 6);
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
        if (key === 'stag' || key === 'boar') { expect(onHat).toBeGreaterThan(0); expect(m.butt).toBe(true); } else { expect(onHat).toBe(0); expect(m.butt).toBeFalsy(); }
        expect(m.legs).toHaveLength(4);
        expect(m.legs!.every((l) => (key === 'bunny' ? l.lower === -1 : l.lower >= 0))).toBe(true);
        expect(m.legs!.filter((l) => l.front)).toHaveLength(2);
        const low = (b: string): number => (key === 'bunny' ? -1 : bone(b as (typeof BONES)[number]));
        expect(m.legs!.filter((l) => l.front).map((l) => [l.upper, l.lower])).toEqual([[bone('armR'), low('handR')], [bone('armL'), low('handL')]]);
        expect(m.legs!.filter((l) => !l.front).map((l) => [l.upper, l.lower])).toEqual([[bone('leg0'), low('leg1')], [bone('leg2'), low('leg3')]]);
      });

      it('bends: the neck, a tail and two ears', () => {
        if (!deers(key)) return;
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
        if (!deers(key)) return;
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

  it('the boar: three bends, tusks on the hat, a heavy body', () => {
    const m = buildJob('boar', null), d = TUBE_DESCS.boar;
    expect(m.bends).toHaveLength(3);
    expect(m.bends.some((b) => b.neck)).toBe(false);
    expect(m.neckBend).toBe(-1);
    expect(m.butt).toBe(true);
    expect(m.scale).toBeCloseTo(0.9 * PAGE_TO_GAME, 6);
    const torso = d.pieces.find((p) => p.torso)!, sh = torso.shape as Extract<typeof torso.shape, { tube: unknown }>;
    expect(Math.max(...sh.tube.map((q) => q.r))).toBeCloseTo(3.5 * 1.25, 9);
    expect(hitRadius(d)).toBe(6);
    expect(d.pieces.filter((p) => p.bone === 'hat')).toHaveLength(2);
  });

  it('the bunny: two ear bends, a fixed tail, a hop, thigh and foot on one bone', () => {
    const m = buildJob('bunny', null), d = TUBE_DESCS.bunny;
    expect(m.bends).toHaveLength(2);
    expect(m.bends.every((b) => !b.neck)).toBe(true);
    expect(d.pieces.filter((p) => p.bend)).toHaveLength(2);
    expect(d.pieces.some((p) => p.bone === 'body' && 'ball' in p.shape && !p.bend)).toBe(true);
    expect(m.hop).toBe(1.3);
    expect(m.butt).toBeFalsy();
    expect(m.scale).toBeCloseTo(0.75 * PAGE_TO_GAME, 6);
    expect(hitRadius(d)).toBe(4);
    for (const b of ['leg0', 'leg2'] as const) expect(d.pieces.filter((p) => p.bone === b)).toHaveLength(2);
  });

  it('standing heights: stag > deer > boar > bunny, the bunny under 10 game px', () => {
    const h = (k: (typeof keys)[number]): number => { const m = buildJob(k, null); return m.stands! * m.scale; };
    expect(h('stag')).toBeGreaterThan(h('deer'));
    expect(h('deer')).toBeGreaterThan(h('boar'));
    expect(h('boar')).toBeGreaterThan(h('bunny'));
    expect(h('bunny')).toBeLessThan(10);
  });

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

  it("the stag's antlers are at the page's thickness: beam base radius 0.52, tines 0.4", () => {
    const radii = TUBE_DESCS.stag.pieces.filter((p) => p.bone === 'hat').map((p) => (p.shape as Extract<typeof p.shape, { tube: unknown }>).tube[0].r);
    expect(radii).toHaveLength(8);
    expect(radii.filter((r) => Math.abs(r - 0.52) < 1e-9)).toHaveLength(2);
    expect(radii.filter((r) => Math.abs(r - 0.4) < 1e-9)).toHaveLength(6);
  });

  it('hit radius', () => {
    expect(hitRadius(TUBE_DESCS.stag)).toBe(5);
    expect(hitRadius(TUBE_DESCS.deer)).toBe(5);
  });

  it("each animal's baseR is its model's hit radius", () => {
    const kinds = { stag: KIND.Stag, deer: KIND.Deer, boar: KIND.Boar, bunny: KIND.Bunny } as const;
    for (const key of keys) expect(FIGURES[kinds[key]].baseR, key).toBe(hitRadius(TUBE_DESCS[key]));
    expect(keys.map((k) => FIGURES[kinds[k]].baseR)).toEqual([5, 5, 6, 4]);
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
import type { TubeDesc, TubePiece } from './tubeDesc';
import { biped, robedBiped } from './bipedFixture';
const require_build = (d: TubeDesc) => buildTubeFigure('bad', d);

describe('two-legged tube figures', () => {
  const m = buildTubeFigure('biped', biped), b = (n: (typeof BONES)[number]): number => BONES.indexOf(n), piv = (n: (typeof BONES)[number]): number[] => [...m.pivots.subarray(b(n) * 3, b(n) * 3 + 3)];
  const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
  it('is not a quad, walks, and lists two legs with knees', () => {
    expect(m.quad).toBe(false); expect(m.gait).toBe('walk');
    expect(m.legs).toEqual([{ upper: b('leg0'), lower: b('leg1'), front: false, knee: 1 }, { upper: b('leg2'), lower: b('leg3'), front: false, knee: 1 }]);
  });
  it('takes the knee that bends the other way, and the weapon factor', () => {
    const k = buildTubeFigure('k', { ...biped, weapon: 1.5, legs: [{ upper: 'leg0', lower: 'leg1', front: false, knee: -1 }, biped.legs[1]] });
    expect(k.legs!.map((l) => l.knee)).toEqual([-1, 1]);
    expect(k.weaponScale).toBe(1.5);
    expect(m.weaponScale).toBeUndefined();
    expect(buildTubeFigure('s', { ...biped, arms: { ...biped.arms!, stretch: 0.3 } }).armStretch).toBe(0.3);
    expect(m.armStretch).toBeUndefined();
  });
  it('hangs hands and weapons on the arms', () => {
    const A = biped.arms!;
    expect(m.armLength).toBe(A.length); expect(m.armRadius).toBe(A.radius);
    expect(piv('handR')).toEqual(piv('armR'));
    expect(piv('weaponR')[1]).toBeCloseTo(piv('armR')[1] - A.length + 0.8 * A.radius, 6);
    expect(m.handY).toBeCloseTo(-A.length + 0.8 * A.radius, 6);
    expect(m.parents[b('handL')]).toBe(b('armL')); expect(m.parents[b('weaponL')]).toBe(b('handL')); expect(m.parents[b('armR')]).toBe(b('body'));
    expect(m.shoulderY).toBe(piv('armR')[1]);
  });
  it('marks steel and carries the flutter', () => {
    const n = m.position.length / 3;
    let steel = 0;
    for (let i = 0; i < n; i++) if (m.look[i * 4 + 3] === 1) { steel++; expect(m.skin[i * 4 + 1], 'hull vertex').toBe(0); }
    expect(steel).toBeGreaterThan(0);
    expect(m.bends).toHaveLength(1);
    expect(m.bends[0].flutter).toEqual({ rate: 3, angle: 0.4 });
  });
  it('takes a beat axis and a hinge, lets a piece bend with another, and marks a glow', () => {
    const ear = biped.pieces.find((p) => p.bend)!, GLOW = 0xffd23a;
    const wing: TubePiece = { ...ear, bend: { sway: 0.8, flutter: { rate: 3, angle: 0.4, axis: [0, 1, 0] }, hinge: 0.5 } };
    const rider: TubePiece = { shape: { ball: [0.5, 0.5, 0.5] }, at: [-0.6, 17.2, 3.8], stage: 'hair', bone: 'head', line: 0.3, colour: GLOW, glow: true, bend: { with: wing } };
    const others = biped.pieces.filter((p) => p !== ear);
    const g = buildTubeFigure('g', { ...biped, pieces: [...others, wing, rider] }), n = g.position.length / 3;
    // The rider adds no bend of its own; the bend carries the axis.
    expect(g.bends).toHaveLength(1);
    expect(g.bends[0].flutter).toEqual({ rate: 3, angle: 0.4, axis: [0, 1, 0] });
    expect(g.bends[0].len).toBeCloseTo(m.bends[0].len, 9);
    const B = g.bends[0], [gr, gg, gb] = [0xff / 255, 0xd2 / 255, 0x3a / 255];
    let riders = 0, stiff = 0, glowing = 0;
    for (let i = 0; i < n; i++) {
      const hullVertex = g.skin[i * 4 + 1] === 1, w = g.look[i * 4 + 3];
      if (w === 3) { glowing++; expect(hullVertex, 'a hull never glows').toBe(false); }
      if (g.skin[i * 4 + 2] !== 0) continue;
      // Every bending vertex, the rider's too: how far along the bend's own line from the bend's foot, over half the length (the hinge).
      const s = (g.position[i * 3] - B.origin[0]) * B.dir[0] + (g.position[i * 3 + 1] - B.origin[1]) * B.dir[1] + (g.position[i * 3 + 2] - B.origin[2]) * B.dir[2];
      expect(Math.abs(g.skin[i * 4 + 3] - Math.max(0, Math.min(1, s / (B.len * 0.5))))).toBeLessThan(1e-5);
      if (s > B.len * 0.5 && s < B.len * 0.9) { stiff++; expect(g.skin[i * 4 + 3]).toBe(1); }
      if (!hullVertex && Math.abs(g.look[i * 4] - gr) < 1e-6 && Math.abs(g.look[i * 4 + 1] - gg) < 1e-6 && Math.abs(g.look[i * 4 + 2] - gb) < 1e-6) { riders++; expect(w).toBe(3); }
    }
    expect(riders).toBeGreaterThan(0); expect(stiff).toBeGreaterThan(0); expect(glowing).toBe(riders);
    // Without the new data nothing glows and the bend has no axis.
    expect(m.look.some((v, i) => i % 4 === 3 && v === 3)).toBe(false);
    expect(m.bends[0].flutter).not.toHaveProperty('axis');
    // Riders do not count against the bend limit; a rider must name an earlier swaying piece of the same description.
    const many = Array.from({ length: 6 }, (): TubePiece => ({ ...rider, glow: undefined }));
    expect(buildTubeFigure('many', { ...biped, pieces: [...others, wing, ...many] }).bends).toHaveLength(1);
    expect(() => buildTubeFigure('x', { ...biped, name: 'RiderFirst', pieces: [...others, rider, wing] })).toThrow(/RiderFirst/);
    expect(() => buildTubeFigure('x', { ...biped, name: 'RiderAlone', pieces: [...others, rider] })).toThrow(/RiderAlone/);
    expect(() => buildTubeFigure('x', { ...biped, name: 'RiderOtherBone', pieces: [...others, wing, { ...rider, bone: 'body' }] })).toThrow(/RiderOtherBone/);
    expect(() => buildTubeFigure('x', { ...biped, name: 'RiderOfRider', pieces: [...others, wing, rider, { ...rider, bend: { with: rider } }] })).toThrow(/RiderOfRider/);
  });
  it('weights a robe from 0 at robeTop to 1 at the hem', () => {
    const r = buildTubeFigure('robed', robedBiped), n = r.position.length / 3;
    let robe = 0;
    for (let i = 0; i < n; i++) {
      const y = r.position[i * 3 + 1];
      if (r.skin[i * 4 + 2] === -2) { robe++; expect(y).toBeLessThan(6); expect(Math.abs(r.skin[i * 4 + 3] - smooth((6 - y) / 6))).toBeLessThan(1e-6); } else if (y >= 6) expect(r.skin[i * 4 + 2]).not.toBe(-2);
    }
    expect(robe).toBeGreaterThan(0);
    expect(r.robeTop).toBe(6);
    expect(r.legs).toEqual([]);
  });
  it('throws for arms without a shoulder pivot, a robe without robeTop, a robe that bends, and a piece on a bone without a pivot', () => {
    const { armR: _a, ...noShoulder } = biped.pivots, { leg1: _l, ...noKnee } = biped.pivots;
    expect(() => buildTubeFigure('x', { ...biped, name: 'NoShoulder', pivots: noShoulder })).toThrow(/NoShoulder/);
    expect(() => buildTubeFigure('x', { ...robedBiped, name: 'NoRobeTop', robeTop: undefined })).toThrow(/NoRobeTop/);
    const robe = robedBiped.pieces[0];
    expect(() => buildTubeFigure('x', { ...robedBiped, name: 'BendingRobe', pieces: [{ ...robe, bend: { sway: 1 } }, ...robedBiped.pieces.slice(1)] })).toThrow(/BendingRobe/);
    expect(() => buildTubeFigure('x', { ...biped, name: 'NoKnee', pivots: noKnee })).toThrow(/NoKnee.*leg1/);
  });
  it('throws for arms that state a hand or weapon pivot, and for arms without stance two', () => {
    for (const b of ['handR', 'handL', 'weaponR', 'weaponL'] as const) {
      expect(() => buildTubeFigure('x', { ...biped, name: 'OwnHand', pivots: { ...biped.pivots, [b]: [0, 5, 0] } }), b).toThrow(/OwnHand: hand and weapon pivots are derived from arms/);
    }
    expect(() => buildTubeFigure('x', { ...biped, name: 'NoStance', stance: undefined })).toThrow(/NoStance: arms need stance 'two'/);
  });
  it('leaves the four animals as they were', () => {
    for (const key of keys) {
      const a = buildJob(key, null);
      expect(a.quad).toBe(true); expect(a.gait).toBeUndefined(); expect(a.armLength).toBe(0); expect(a.robeTop).toBeNull();
      expect(a.legs!.every((l) => l.knee === undefined)).toBe(true);
    }
  });
});

/** What each two-legged creature (#356) must be: a new creature adds a row here, the loop below checks it. */
interface BipedFacts {
  key: TubeKey;
  /** The game kind that wears it: its `FIGURES` entry says which weapon it carries. */
  kind: number;
  /** Game px to the top of the head (the `head` stage). */
  height: number;
  bends: number;
  /** The `knee` of each leg, the right one first; [] for a robe without legs. */
  knees: (1 | -1)[];
  robe: boolean;
  /** Colours that must show, in the pieces or in the paint. */
  colours: number[];
  /** The bone its weapon hangs on; null: it holds nothing. */
  weapon: 'weaponR' | 'weaponL' | null;
}
const BIPEDS: BipedFacts[] = [
  { key: 'goblin', kind: KIND.GoblinArcher, height: HUMAN_HEIGHT * 0.65, bends: 2, knees: [1, 1], robe: false, colours: [0x3d734f, 0x314152, 0xfdf7ed], weapon: 'weaponL' },
  { key: 'orc', kind: KIND.OrcWarrior, height: HUMAN_HEIGHT * 1.1, bends: 0, knees: [1, 1], robe: false, colours: [0x3d734f, 0x8f4029, 0x62232f, 0xfdf7ed], weapon: 'weaponR' },
  { key: 'orcArcher', kind: KIND.OrcArcher, height: HUMAN_HEIGHT * 1.1, bends: 0, knees: [1, 1], robe: false, colours: [0x3d734f, 0x8f4029, 0x62232f, 0xfdf7ed], weapon: 'weaponL' },
  { key: 'npcKnight', kind: KIND.Knight, height: HUMAN_HEIGHT, bends: 0, knees: [1, 1], robe: false, colours: [0x72d6ce, 0x417089], weapon: 'weaponR' },
  { key: 'necromancer', kind: KIND.Necromancer, height: HUMAN_HEIGHT, bends: 1, knees: [], robe: true, colours: [0x5f2d56, 0x9f294e, 0x2a2a3a, 0xfdf7ed], weapon: 'weaponR' },
  { key: 'summoner', kind: KIND.Summoner, height: HUMAN_HEIGHT, bends: 1, knees: [], robe: true, colours: [0x62232f, 0xda4e38, 0x2a2a3a, 0xfdf7ed], weapon: 'weaponR' },
  { key: 'disciple', kind: KIND.Disciple, height: HUMAN_HEIGHT, bends: 0, knees: [], robe: true, colours: [0x531d28, 0x9f294e, 0x2a2a3a, 0xfdf7ed], weapon: null },
  { key: 'imp', kind: KIND.Imp, height: HUMAN_HEIGHT * 0.45, bends: 3, knees: [1, 1], robe: false, colours: [0xda4e38, 0x5f2d56, 0x62232f, DEMON_EYE], weapon: null },
  { key: 'chort', kind: KIND.Chort, height: HUMAN_HEIGHT * 1.05, bends: 1, knees: [-1, -1], robe: false, colours: [0xda4e38, 0x9f294e, 0xfdf7ed], weapon: null },
];

describe('the two-legged creatures', () => {
  for (const f of BIPEDS) {
    describe(f.key, () => {
      const m = buildJob(f.key, null), d = TUBE_DESCS[f.key], n = m.position.length / 3;
      const piv = (b: (typeof BONES)[number]): number[] => [...m.pivots.subarray(bone(b) * 3, bone(b) * 3 + 3)];

      it('has consistent streams, ranges and index lists', () => expectStreams(m));
      it('has finite positions, normals, pivots and bends', () => expectFinite(m));

      it('stands upright on the ground at its height and walks', () => {
        expect(d.stance).toBe('two');
        expect(m.quad).toBe(false); expect(m.gait).toBe('walk'); expect(m.varies).toBe(true);
        expect(Math.abs(m.baseHeight - f.height)).toBeLessThan(0.1);
        let low = Infinity;
        for (let i = 0; i < n; i++) if (m.skin[i * 4 + 1] === 0) low = Math.min(low, m.position[i * 3 + 1]);
        expect(Math.abs(low)).toBeLessThan(0.3 / m.scale);
        expect(m.stands! * m.scale).toBeGreaterThanOrEqual(m.baseHeight - 1e-6);
      });

      it('bends, arms, legs and robe', () => {
        expect(m.bends).toHaveLength(f.bends);
        expect(m.bends.length).toBeLessThanOrEqual(MAX_BENDS);
        expect(m.armLength).toBeGreaterThan(0);
        expect(m.legs!.map((l) => l.knee)).toEqual(f.knees);
        expect(m.legs!.every((l) => l.lower >= 0 && !l.front)).toBe(true);
        if (f.knees.length) expect(m.legs!.map((l) => [l.upper, l.lower])).toEqual([[bone('leg0'), bone('leg1')], [bone('leg2'), bone('leg3')]]);
        if (f.robe) expect(m.robeTop).not.toBeNull(); else expect(m.robeTop).toBeNull();
        for (let b = 1; b < BONES.length; b++) expect(m.parents[b]).toBeLessThan(b);
      });

      it('shows its colours', () => {
        const seen = coloursOf(m);
        for (const c of f.colours) expect(seen.has(c), c.toString(16)).toBe(true);
        expect(d.pieces.filter((p) => p.torso)).toHaveLength(1);
      });

      it('holds its weapon below the shoulder, at the side of its hand: the hand the figure code hangs its weapon on', () => {
        // The row's hand is the one `Figures3d` picks for the weapon this kind carries (a bow in the left); a kind without a weapon states null.
        const carried = FIGURES[f.kind].weapon;
        expect(MODEL_OF_KIND[f.kind]).toBe(f.key);
        expect(carried ? weaponBoneOf(carried) : null).toBe(f.weapon);
        if (!f.weapon) return;
        const side = f.weapon === 'weaponR' ? 'armR' : 'armL';
        expect(piv(f.weapon)[1]).toBeLessThan(piv(side)[1]);
        expect(piv(f.weapon)[2]).toBe(piv(side)[2]);
        expect(Math.sign(piv(f.weapon)[2])).toBe(f.weapon === 'weaponR' ? 1 : -1);
        expect(m.parents[bone(f.weapon)]).toBe(bone(f.weapon === 'weaponR' ? 'handR' : 'handL'));
      });

      it('survives the worker hand-over', () => {
        expect(structuredClone(m)).toEqual(m);
      });
    });
  }

  it('the imp: two bat wings on the back that mirror each other and beat across their surface, a wagging tail, horns on the hat bone above the head, claws on the hands, glowing eyes', () => {
    const d = TUBE_DESCS.imp, m = buildJob('imp', null);
    const wings = m.bends.filter((b) => b.flutter), tail = m.bends.filter((b) => !b.flutter);
    expect(wings.map((b) => [b.flutter!.rate, b.flutter!.angle])).toEqual([[5, 0.9], [5, 0.9]]);
    // The beat's axis: a unit vector across the span, mirrored like the wings (an axis mirrors with x and y turned round).
    const [a0, a1] = wings.map((b) => b.flutter!.axis!);
    expect(Math.hypot(...a0)).toBeCloseTo(1, 6);
    expect([a1[0], a1[1], a1[2]]).toEqual([-a0[0], -a0[1], a0[2]]);
    for (const w of wings) expect(Math.abs(w.flutter!.axis![0] * w.dir[0] + w.flutter!.axis![1] * w.dir[1] + w.flutter!.axis![2] * w.dir[2])).toBeLessThan(0.4);
    // Each wing: one membrane (a flat tube, the thinnest allowed, that sways with a hinge), and four bones and a claw that bend with it.
    const webs = d.pieces.filter((p) => p.bend && 'flutter' in p.bend && p.bend.flutter);
    expect(webs).toHaveLength(2);
    for (const web of webs) {
      expect(web.colour).toBe(0x62232f);
      expect(web.bend && 'hinge' in web.bend && web.bend.hinge).toBeLessThan(0.5);
      if (!('tube' in web.shape)) throw new Error('the membrane is a tube');
      for (const q of web.shape.tube) expect(q.r * Math.min(1, q.wide ?? 1)).toBeLessThan(0.4);
      const riders = d.pieces.filter((p) => p.bend && 'with' in p.bend && p.bend.with === web);
      expect(riders.filter((p) => 'tube' in p.shape && p.colour === 0xda4e38)).toHaveLength(4);
      expect(riders.filter((p) => 'drop' in p.shape && p.colour === 0x5f2d56)).toHaveLength(1);
    }
    // The eyes: two glowing yellow slits on the head, without a hull and without pupils.
    const eyes = d.pieces.filter((p) => p.glow);
    expect(eyes).toHaveLength(2);
    expect(eyes.every((p) => p.colour === DEMON_EYE && p.line === 0 && p.bone === 'head' && 'tube' in p.shape)).toBe(true);
    expect(d.pieces.some((p) => p.colour === 0x222222 || p.colour === 0xfdf7ed)).toBe(false);
    // Back, up and outwards, one to each side, from behind the shoulders; on the body, so the head's turn leaves them.
    for (const w of wings) {
      expect(w.bone).toBe(bone('body'));
      expect(w.dir[0]).toBeLessThan(0); expect(w.dir[1]).toBeGreaterThan(0);
      expect(w.origin[0]).toBeLessThan(d.pivots.armR![0]);
    }
    expect(wings[0].dir[2]).toBeCloseTo(-wings[1].dir[2], 6);
    expect(Math.abs(wings[0].dir[2])).toBeGreaterThan(0.3);
    expect(wings[0].origin[2]).toBe(-wings[1].origin[2]);
    expect(tail).toHaveLength(1);
    expect([tail[0].k, tail[0].wag, tail[0].bone]).toEqual([1, 1, bone('body')]);
    expect(tail[0].dir[1]).toBeGreaterThan(0);   // the end stands up, so the wag shows
    // The horns: the only pieces on the hat bone, 0x5f2d56, their foot (the hat pivot) inside the head and their tips above it.
    const horns = d.pieces.filter((p) => p.bone === 'hat');
    expect(horns).toHaveLength(2);
    expect(horns.every((p) => p.colour === 0x5f2d56 && 'drop' in p.shape)).toBe(true);
    expect(m.parents[bone('hat')]).toBe(bone('head'));
    expect(d.pivots.hat![1] * m.scale).toBeLessThan(m.baseHeight);
    expect(m.stands! * m.scale).toBeGreaterThan(m.baseHeight + 0.5);
    // Three claws on each hand, drops; arms, so it claws and casts (never butts with the horns).
    for (const h of ['handR', 'handL'] as const) expect(d.pieces.filter((p) => p.bone === h && 'drop' in p.shape)).toHaveLength(3);
    expect(m.butt).toBe(true); expect(m.armLength).toBeGreaterThan(0);
    expect(d.weapon).toBeUndefined();
  });

  it('the chort: goat legs whose rest angles are in the geometry, a darker painted back, long white horns on the hat bone, a grin wider than the eyes, long claws, a tail', () => {
    const d = TUBE_DESCS.chort, m = buildJob('chort', null);
    // The legs: the thigh leans forward and the shin back (both turned pieces of the upper bone), so the joint the walk bends lies
    // behind the hip; the lower piece leans forward again and ends in a hoof under the hip, where a swing of the hip lifts it least.
    for (const [upper, lower] of [['leg0', 'leg1'], ['leg2', 'leg3']] as const) {
      const up = d.pieces.filter((p) => p.bone === upper).map((p) => p.turn ?? 0), low = d.pieces.filter((p) => p.bone === lower).map((p) => p.turn ?? 0);
      expect(up.some((a) => a > 0.2), upper).toBe(true);
      expect(up.some((a) => a < -0.2), upper).toBe(true);
      expect(low.some((a) => a > 0.1), lower).toBe(true);
      expect(low.every((a) => a >= 0), lower).toBe(true);
      const hip = d.pivots[upper]!, hock = d.pivots[lower]!;
      expect(hock[0]).toBeLessThan(hip[0] - 1);
      expect(hock[1]).toBeLessThan(hip[1]);
      expect(hock[2]).toBe(hip[2]);
      // The foot: the lowest tenth of the lower bone's vertices lies under the hip (within 1 px before and behind).
      let lo = Infinity, x0 = Infinity, x1 = -Infinity;
      const n = m.position.length / 3, b = bone(lower);
      for (let i = 0; i < n; i++) if (m.skin[i * 4] === b && m.skin[i * 4 + 1] === 0) lo = Math.min(lo, m.position[i * 3 + 1]);
      for (let i = 0; i < n; i++) if (m.skin[i * 4] === b && m.skin[i * 4 + 1] === 0 && m.position[i * 3 + 1] < lo + 0.3) { x0 = Math.min(x0, m.position[i * 3]); x1 = Math.max(x1, m.position[i * 3]); }
      expect(Math.abs(lo)).toBeLessThan(0.05);
      expect((x0 + x1) / 2 - hip[0]).toBeGreaterThan(-1);
      expect((x0 + x1) / 2 - hip[0]).toBeLessThan(1);
    }
    // The painted torso: the back (d 0) darker, the front (d 1) the skin's red.
    const torso = d.pieces.find((p) => p.torso)!;
    expect(typeof torso.colour).toBe('function');
    const paint = torso.colour as (u: number, d: number) => number;
    for (const u of [0.1, 0.5, 0.9]) { expect(paint(u, 0)).toBe(0x9f294e); expect(paint(u, 1)).toBe(0xda4e38); }
    // The horns: the only pieces on the hat bone, white, long (their tips well above the head), their foot inside the head.
    const horns = d.pieces.filter((p) => p.bone === 'hat');
    expect(horns).toHaveLength(2);
    expect(horns.every((p) => p.colour === 0xfdf7ed)).toBe(true);
    expect(m.parents[bone('hat')]).toBe(bone('head'));
    expect(d.pivots.hat![1] * m.scale).toBeLessThan(m.baseHeight);
    expect(m.stands! * m.scale).toBeGreaterThan(m.baseHeight + 3);
    // The face: the two highest white pieces on the head are the eyes; the rest is the grin, at least five teeth, all below the eyes
    // and reaching further to each side than the eyes do.
    const white = d.pieces.filter((p) => p.bone === 'head' && p.colour === 0xfdf7ed && p.at).sort((a, b) => b.at![1] - a.at![1]);
    const eyes = white.slice(0, 2), teeth = white.slice(2);
    expect(teeth.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...teeth.map((p) => p.at![1]))).toBeLessThan(Math.min(...eyes.map((p) => p.at![1])));
    expect(Math.max(...teeth.map((p) => Math.abs(p.at![2])))).toBeGreaterThan(Math.max(...eyes.map((p) => Math.abs(p.at![2]))));
    // Three long claws on each hand: drops, white, longer than the hand is wide.
    for (const h of ['handR', 'handL'] as const) {
      const claws = d.pieces.filter((p) => p.bone === h && 'drop' in p.shape);
      expect(claws).toHaveLength(3);
      for (const c of claws) {
        expect(c.colour).toBe(0xfdf7ed);
        if ('drop' in c.shape) expect(c.shape.drop.len - c.shape.drop.sink).toBeGreaterThan(2 * d.arms!.radius * 1.5);
      }
    }
    // The tail: the one bend, on the body, out of the back, wagging.
    expect(m.bends).toHaveLength(1);
    expect([m.bends[0].k, m.bends[0].wag, m.bends[0].bone]).toEqual([1, 1, bone('body')]);
    expect(m.bends[0].dir[0]).toBeLessThan(0);
    expect(m.bends[0].origin[0]).toBeLessThan(d.pivots.body![0]);
    expect(m.butt).toBe(true); expect(m.armLength).toBeGreaterThan(0);
    expect(d.weapon).toBeUndefined();
  });

  it('the orcs: one build; the archer has arms 0.75 as thick, a bone mask instead of tusks, and a strap', () => {
    const w = buildJob('orc', null), a = buildJob('orcArcher', null);
    expect(a.armRadius / w.armRadius).toBeCloseTo(0.75, 6);
    expect(a.armLength).toBe(w.armLength);
    expect(a.baseHeight).toBeCloseTo(w.baseHeight, 6);
    expect(a.scale).toBe(w.scale);
    const white = (d: TubeDesc): number => d.pieces.filter((p) => p.colour === 0xfdf7ed).length;
    const drops = (d: TubeDesc): number => d.pieces.filter((p) => 'drop' in p.shape && p.colour === 0xfdf7ed).length;
    expect(drops(TUBE_DESCS.orc)).toBe(2);         // the two tusks
    expect(white(TUBE_DESCS.orc)).toBe(2);
    expect(drops(TUBE_DESCS.orcArcher)).toBe(0);   // none through the mask
    expect(white(TUBE_DESCS.orcArcher)).toBeGreaterThan(0);
    expect(orcDesc({ name: 'Plain', arms: 1, mask: false, strap: false }).pieces).toHaveLength(TUBE_DESCS.orc.pieces.length);
    expect(orcDesc({ name: 'Strapped', arms: 1, mask: false, strap: true }).pieces).toHaveLength(TUBE_DESCS.orc.pieces.length + 1);
  });

  it('the robes: one build; the Summoner is the Necromancer in other colours, the Disciple is as tall, has no tip and shows no hands', () => {
    const [n, s, d] = [TUBE_DESCS.necromancer, TUBE_DESCS.summoner, TUBE_DESCS.disciple];
    const shapes = (t: TubeDesc): string => JSON.stringify(t.pieces.map((p) => [p.shape, p.at, p.stage, p.bone, p.line, p.bend, p.robe, p.torso]));
    expect(shapes(s)).toBe(shapes(n));
    expect(s.pieces.map((p) => p.colour)).not.toEqual(n.pieces.map((p) => p.colour));
    const [mn, ms, md] = [buildJob('necromancer', null), buildJob('summoner', null), buildJob('disciple', null)];
    expect(ms.position).toEqual(mn.position);
    // All three are exactly as tall (one human to the top of the hood) and, from one build, as thick (#356 rework 1).
    expect([mn.baseHeight, md.baseHeight]).toEqual([ms.baseHeight, ms.baseHeight]);
    expect(md.armRadius).toBeLessThanOrEqual(mn.armRadius);
    expect(md.radius).toBeLessThanOrEqual(mn.radius);
    const hands = (t: TubeDesc): number => t.pieces.filter((p) => p.bone === 'handR' || p.bone === 'handL').length;
    expect([hands(n), hands(s), hands(d)]).toEqual([2, 2, 0]);
    expect(md.armLength).toBeGreaterThan(0);   // sleeve arms: it casts, it does not bite
    expect([mn.weaponScale, ms.weaponScale]).toEqual([0.8, 0.8]);   // the staff a little smaller than on the card
    // The tip is the one bending piece, on the head; it has fallen back: it hangs down behind the head and adds no height (#356 rework 1).
    // The Disciple has none.
    const tips = n.pieces.filter((p) => p.bend);
    expect(tips).toHaveLength(1);
    expect(tips[0].bone).toBe('head');
    const tip = tips[0].shape as { drop: { dir: readonly number[] } };
    expect(tip.drop.dir[0]).toBeLessThan(0);
    expect(tip.drop.dir[1]).toBeLessThan(0);
    expect(tips[0].at![0]).toBeLessThan(n.pivots.head![0]);
    expect(mn.stands! * mn.scale).toBeCloseTo(mn.baseHeight, 6);
    expect(d.pieces.some((p) => p.bend)).toBe(false);
    expect(md.stands! * md.scale).toBeCloseTo(md.baseHeight, 6);
    for (const t of [n, d]) {
      // The body has real depth: above the hem's flare no ring is thinner front to back than 2.1 px, nor less than 0.8 as deep as wide.
      const robe = (t.pieces.find((p) => p.torso)!.shape as { tube: readonly TubePoint[] }).tube;
      for (const q of robe.slice(2)) { expect(q.r).toBeGreaterThanOrEqual(2.1); expect(1 / q.wide!).toBeGreaterThanOrEqual(0.8); }
      // The hood is a cowl that falls back: its line starts on the upper back, below the shoulders' pivot and behind it, climbs to the
      // crown and ends at the open front, which is lower than the crown.
      const hood = (t.pieces.find((p) => p.stage === 'head')!.shape as { tube: readonly TubePoint[] }).tube;
      const ys = hood.map((q) => q.p[1]), crown = ys.indexOf(Math.max(...ys));
      expect(crown).toBeGreaterThan(0);
      expect(crown).toBeLessThan(hood.length - 1);
      expect(hood[0].p[0]).toBeLessThan(t.pivots.head![0] - 1.5);
      expect(hood[0].p[1]).toBeLessThan(t.pivots.head![1]);
    }
    expect(robedDesc({ name: 'Bare', height: 19, robe: 1, edge: 2, hood: 'deep', tip: false, hands: false }).pieces).toHaveLength(n.pieces.length - 3);
  });

  it('the robes: no legs; one robe piece, the torso, whose part below the waist swings, and nothing else does', () => {
    for (const key of ['necromancer', 'summoner', 'disciple'] as const) {
      const d = TUBE_DESCS[key], m = buildJob(key, null), n = m.position.length / 3;
      expect(d.legs).toEqual([]);
      expect(d.pieces.filter((p) => p.robe)).toHaveLength(1);
      expect(d.pieces.find((p) => p.robe)!.torso).toBe(true);
      expect(m.robeTop).toBe(d.pivots.body![1]);   // at the waist
      expect(m.robeTop! * m.scale / m.baseHeight).toBeGreaterThan(0.3);
      expect(m.robeTop! * m.scale / m.baseHeight).toBeLessThan(0.5);
      let swings = 0, hem = 0;
      for (let i = 0; i < n; i++) if (m.skin[i * 4 + 2] === -2) {
        swings++;
        expect(m.skin[i * 4]).toBe(bone('body'));
        expect(m.position[i * 3 + 1]).toBeLessThan(m.robeTop!);
        if (m.skin[i * 4 + 3] > 0.9) hem++;
      }
      expect(swings).toBeGreaterThan(0);
      expect(hem).toBeGreaterThan(0);
      // Nothing but the robe and the sleeves reaches below the waist: every vertex under it swings with the robe or belongs to an arm or hand.
      const armBones = [bone('armR'), bone('armL'), bone('handR'), bone('handL')];
      for (let i = 0; i < n; i++) if (m.position[i * 3 + 1] < m.robeTop!) {
        expect(m.skin[i * 4 + 2] === -2 || armBones.includes(m.skin[i * 4]), `${key} vertex ${i}: bone ${m.skin[i * 4]}, bend ${m.skin[i * 4 + 2]}, y ${m.position[i * 3 + 1]}`).toBe(true);
      }
    }
  });

  it('the Knight: every turquoise piece is polished steel and no dark one is; the round shield hangs on the left arm, outside it', () => {
    const d = TUBE_DESCS.npcKnight, m = buildJob('npcKnight', null), n = m.position.length / 3;
    for (const p of d.pieces) expect(!!p.metal, `${p.stage} on ${p.bone}`).toBe(p.colour === 0x72d6ce);
    let steel = 0;
    for (let i = 0; i < n; i++) if (m.look[i * 4 + 3] === 1) { steel++; expect(m.skin[i * 4 + 1], 'hull vertex').toBe(0); }
    expect(steel).toBeGreaterThan(0);
    // The shield: the one flat steel ball on the left arm (the pauldron there is a thick ball); wholly beyond the arm's outer side, between the knee and the shoulder.
    const shields = d.pieces.filter((p) => p.bone === 'armL' && 'ball' in p.shape && p.metal && p.shape.ball[2] < p.shape.ball[0] / 3);
    expect(shields).toHaveLength(1);
    const s = shields[0], ball = (s.shape as { ball: readonly [number, number, number] }).ball, arm = d.pivots.armL!;
    expect(s.bone).toBe('armL');
    expect(ball[0]).toBe(ball[1]);
    expect(s.at![2] + ball[2]).toBeLessThanOrEqual(arm[2] - d.arms!.radius);
    expect(s.at![1] - ball[1]).toBeGreaterThan(d.pivots.leg1![1]);
    expect(s.at![1] + ball[1]).toBeLessThan(arm[1]);
  });
});

describe('the tube descriptions', () => {
  // The limit of the tube models: a thinner tube is a sliver that flickers at game zoom. `wide` scales one axis of a ring, so a
  // point's thinnest half-width is r x min(1, wide). Checked for the two-legged descriptions (#356); the stag's antler tines (#357) are thinner.
  for (const key of (Object.keys(TUBE_DESCS) as TubeKey[]).filter((k) => TUBE_DESCS[k].stance === 'two')) {
    it(`${key}: no tube point is thinner than 0.35 px`, () => {
      const d = TUBE_DESCS[key], thin: string[] = [];
      d.pieces.forEach((p, i) => {
        if (!('tube' in p.shape)) return;
        for (const q of p.shape.tube) {
          const half = q.r * Math.min(1, q.wide ?? 1);
          if (half < 0.35 - 1e-9) thin.push(`piece ${i} (${p.stage} on ${p.bone}): ${half.toFixed(3)}`);
        }
      });
      expect(thin).toEqual([]);
    });
  }
});

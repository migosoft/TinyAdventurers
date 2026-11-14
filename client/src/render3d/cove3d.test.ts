import { describe, expect, it } from 'vitest';
import type { CoveInfo } from '../generated/CoveInfo';
import { coveLayout, placeCovePlants } from '../game/covemath';
import { CanvasEdgeError } from '../game/vegetation/canvas';
import { PIXIE_COLOURS, PIXIE_COUNT, PIXIE_WING_ALPHA, PIXIE_RX, PIXIE_RY } from '../game/pixieMath';
import { BufferAttribute, BufferGeometry, DataTexture, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import type { Cam } from './camera';
import { newCardBuf, newGlowBuf } from './cards';
import { CAST_ID0, COVE_PIXIES, Cove3d, PIXIE_LIGHT, Pixies3d, coveWillow } from './cove3d';
import { Forest } from './trees/forest';
import type { TreeSpec } from './trees/spec';
import { makeLighting } from './lightNodes';
import { makeSight } from './sightNodes';
import { seeUniforms } from './materials';
import { fragment, type Builder } from './shaderCode.testutil';
import { buildTree, type BuiltTree } from './trees/build';
import { newLeafBuf, pushLeaves } from './trees/leaves';
import { leafGeometry } from './trees/treeLayer';
import { makeTreeShared, packTreeStreams, treeMaterials } from './trees/treeNodes';
import { TILE_ID } from '../generated/defs';
import { DEFAULT_HAZE } from '../game/sightField';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import { SightMask } from './sightmask';
import type { FrameRects } from './worldMesh';

const cove: CoveInfo = { x: 10, y: 8, w: 14, h: 10, tree_x: 16, tree_y: 12, seed: 5 };
const frames: FrameRects = {
  cove_tree: { x: 0, y: 0, w: 96, h: 100 }, cove_bush_a: { x: 100, y: 0, w: 24, h: 20 }, cove_bush_b: { x: 130, y: 0, w: 24, h: 20 },
  cove_tuft_a: { x: 160, y: 0, w: 12, h: 8 }, cove_tuft_b: { x: 180, y: 0, w: 12, h: 8 }, cove_fern: { x: 200, y: 0, w: 14, h: 14 },
  floor_1: { x: 300, y: 0, w: 16, h: 16 },
};
const cam: Cam = { x: 16, z: 12, pitch: Math.PI / 4, yaw: 0 };
const { foot } = coveLayout(cove);

/** The real room: 26 x 20 tiles, the trunk at its middle. */
const room = (seed: number): CoveInfo => ({ x: 10, y: 8, w: 26, h: 20, tree_x: 23, tree_y: 18, seed });

describe('coveWillow', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`keeps the willow of seed ${seed} 0.5 tiles inside the room, as large as the steps allow`, () => {
      const c = room(seed);
      const w = coveWillow(c);
      const built = buildTree(w);
      const f = coveLayout(c).foot;
      expect(w.form).toBe('willow');
      expect(w.seed).toBe(seed);
      expect(w.x).toBeCloseTo(f.x / 16, 6);
      expect(w.z).toBeCloseTo(f.y / 16, 6);
      expect(w.scalePct % 5).toBe(0);
      expect(w.scalePct).toBeGreaterThanOrEqual(60);
      expect(w.scalePct).toBeLessThanOrEqual(200);
      expect(w.x - built.radius).toBeGreaterThanOrEqual(c.x + 0.5 - 1e-9);
      expect(w.x + built.radius).toBeLessThanOrEqual(c.x + c.w - 0.5 + 1e-9);
      expect(w.z - built.radius).toBeGreaterThanOrEqual(c.y + 0.5 - 1e-9);
      expect(w.z + built.radius).toBeLessThanOrEqual(c.y + c.h - 0.5 + 1e-9);
      // Every larger step either does not fit or cannot be drawn (the generator's canvas is finite).
      for (let pct = w.scalePct + 5; pct <= 200; pct += 5) {
        let bigger: BuiltTree | null = null;
        try { bigger = buildTree({ ...w, scalePct: pct }); } catch { /* too large to draw */ }
        if (!bigger) continue;
        const fits = w.x - bigger.radius >= c.x + 0.5 && w.x + bigger.radius <= c.x + c.w - 0.5 && w.z - bigger.radius >= c.y + 0.5 && w.z + bigger.radius <= c.y + c.h - 0.5;
        expect(fits, `${pct} %`).toBe(false);
      }
    });
  }

  it('shrinks the willow to fit a narrower room, and is allowed past the ordinary willows\' 130', () => {
    const tight = coveWillow({ x: 10, y: 8, w: 14, h: 12, tree_x: 17, tree_y: 13, seed: 2 });
    expect(tight.scalePct).toBeLessThan(200);
    expect(tight.scalePct).toBeGreaterThanOrEqual(60);
    expect(coveWillow(room(1)).scalePct).toBeGreaterThan(130);
  });

  it('treats only the generator\'s canvas-edge error as too large a size, and rethrows any other', () => {
    const c = room(1);
    const edge = (s: TreeSpec): BuiltTree => { if (s.scalePct > 100) throw new CanvasEdgeError(); return buildTree(s); };
    expect(coveWillow(c, edge).scalePct).toBeLessThanOrEqual(100);
    const broken = (): BuiltTree => { throw new RangeError('not the canvas'); };
    expect(() => coveWillow(c, broken)).toThrow('not the canvas');
  });

  it('falls back to the smallest size in a room too small for it', () => {
    expect(coveWillow({ x: 10, y: 8, w: 4, h: 4, tree_x: 12, tree_y: 10, seed: 1 }).scalePct).toBe(60);
  });
});

describe('the cove tree in the colour pass without a sun', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`builds the willow's materials and the falling leaves for ${B.name}`, () => {
      const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
      const mats = treeMaterials({ lighting, sight: makeSight(), see: seeUniforms(), mask: new Texture(), palette: new Texture(), shared: makeTreeShared(), hasSun: false });
      expect(mats.sun).toBeNull();
      const built = buildTree(coveWillow(room(1)));
      expect(built.drops).toBe(true);
      const m = built.mesh;
      const g = new BufferGeometry();
      const set = (name: string, data: ArrayLike<number>, size: number) => g.setAttribute(name, new BufferAttribute(Float32Array.from(data), size));
      set('position', m.position, 3); set('grad', m.grad, 4); set('part', m.part, 4); set('misc', m.misc, 4); set('tuft', m.tuft, 4);
      const packed = packTreeStreams(m.normal, m.sway, Array.from({ length: m.verts }, () => [3, 4, 1, 0]).flat());
      g.setAttribute('nrm', new BufferAttribute(packed.nrm, 4));
      g.setAttribute('plant', new BufferAttribute(packed.plant, 4));
      set('look', Array.from({ length: m.verts }, () => [1, 0, 1, 0]).flat(), 4);
      g.setIndex(m.index);
      for (const mat of [mats.depth, mats.colour]) expect(fragment(B, mat, { geometry: g }).length).toBeGreaterThan(0);
      const leaves = newLeafBuf();
      pushLeaves(leaves, built, 3, 4, 1);
      expect(leaves.n).toBeGreaterThan(0);
      for (let i = 0; i < leaves.n; i++) { leaves.leaf.push(1); leaves.look.push(1, 0, 1, 0); }
      expect(fragment(B, mats.leaf, { geometry: leafGeometry(leaves) }).length).toBeGreaterThan(0);
    });
  }
});

describe('Cove3d', () => {
  const c = new Cove3d(cove, frames);
  const placed = placeCovePlants(coveLayout(cove).spec);
  const small = placed.filter((p) => frames[p.frame]);

  it('plants the willow on the layout foot, as the cove coveWillow says', () => {
    const t = c.tree();
    expect(t).toEqual(coveWillow(cove));
    expect(t.x).toBeCloseTo(foot.x / 16, 6);
    expect(t.z).toBeCloseTo(foot.y / 16, 6);
  });

  it('turns every bush spot into a bush spec and no tuft or fern', () => {
    const bushes = placed.map((p, i) => ({ p, i })).filter(({ p }) => p.frame.startsWith('cove_bush'));
    expect(bushes.length).toBeGreaterThan(0);
    const specs = c.bushes();
    expect(specs).toHaveLength(bushes.length);
    const { origin } = coveLayout(cove);
    specs.forEach((s, k) => {
      const { p, i } = bushes[k];
      expect(s).toEqual({ form: 'bush', x: (origin.x + p.x) / 16, z: (origin.y + p.y) / 16, seed: cove.seed + i + 1, scalePct: (frames[p.frame]!.w / 32) * 100, mirrored: false, leaf: 1, dead: false });
    });
  });

  it('hands a bushel spot to every tuft and fern and none to a bush', () => {
    const tufts = small.filter((p) => !p.frame.startsWith('cove_bush'));
    const { origin } = coveLayout(cove);
    const spots = c.bushelSpots();
    expect(spots).toHaveLength(tufts.length);
    spots.forEach((s, i) => {
      const p = tufts[i];
      expect(s.x).toBeCloseTo((origin.x + p.x) / 16, 9);
      expect(s.z).toBeCloseTo((origin.y + p.y) / 16, 9);
      expect(s.fern).toBe(p.frame === 'cove_fern');
      expect(s.count).toBeGreaterThanOrEqual(s.fern ? 2 : 3);
      expect(s.count).toBeLessThanOrEqual(s.fern ? 3 : 5);
    });
    expect(spots.some((s) => s.fern)).toBe(true);
    expect(spots.some((s) => !s.fern)).toBe(true);
    expect(new Cove3d(cove, frames).bushelSpots()).toEqual(spots);
  });

  it('casts the willow with CAST_ID0 sized to it and one caster per bush, each keeping its id from the plant order', () => {
    const k = c.casters();
    expect(k).toHaveLength(1 + c.bushes().length);
    const built = buildTree(c.tree());
    expect(k[0].id).toBe(CAST_ID0);
    expect(k[0].w).toBeCloseTo(2 * built.radius, 6);
    expect(k[0].y1).toBeCloseTo(built.height, 6);
    expect(k[0].x).toBeCloseTo(c.tree().x, 6);
    expect(k[0].z).toBeCloseTo(c.tree().z, 6);
    expect(k[0].u1 - k[0].u0).toBe(frames.cove_tree.w);
    const bushIds = small.map((p, i) => ({ p, i })).filter(({ p }) => p.frame.startsWith('cove_bush')).map(({ i }) => CAST_ID0 - 1 - i);
    expect(k.slice(1).map((e) => e.id)).toEqual(bushIds);
    expect(new Set(k.map((e) => e.id)).size).toBe(k.length);
    for (const e of k) {
      expect(e.id).toBeLessThan(0);
      expect(e.w).toBeGreaterThan(0);
      expect(e.y1).toBeGreaterThan(e.y0);
      expect(e.u1).toBeGreaterThan(e.u0);
      expect(e.v1).toBeGreaterThan(e.v0);
    }
  });

  it('has 7 pixie lights without shadows, at the pixies', () => {
    const ls = c.lights(3);
    expect(ls).toHaveLength(PIXIE_COUNT);
    ls.forEach((l, i) => {
      expect(l.id).toBe(`x${i}`);
      expect(l.shadow).toBe(false);
      expect(l.radius).toBe(PIXIE_LIGHT.radius);
      expect(l.r).toBeCloseTo(((PIXIE_COLOURS.glow >> 16) & 255) / 255 * PIXIE_LIGHT.gain, 6);
      expect(l.base).toBeGreaterThan(0);
    });
  });

  it('flies some pixies above the crown and the others round outside the curtains, all inside the walls', () => {
    for (const info of [cove, room(3)]) {
      const cv = new Cove3d(info, frames);
      const t0 = cv.tree(), b = buildTree(t0);
      const reach = Math.min(t0.x - (info.x + 0.5), info.x + info.w - 0.5 - t0.x, t0.z - (info.y + 0.5), info.y + info.h - 0.5 - t0.z);
      const ring0 = Math.min(b.radius + COVE_PIXIES.ringGap, reach - COVE_PIXIES.ringWobble);
      for (let t = 0; t < 120; t += 3.1) {
        cv.lights(t).forEach((l, i) => {
          const d = Math.hypot(l.x - t0.x, l.z - t0.z);
          expect(Math.abs(l.x - t0.x)).toBeLessThanOrEqual(reach + 1e-6);
          expect(Math.abs(l.z - t0.z)).toBeLessThanOrEqual(reach + 1e-6);
          if (i < COVE_PIXIES.above) {
            expect(Math.abs(l.y - (b.height + COVE_PIXIES.aboveLift))).toBeLessThanOrEqual(COVE_PIXIES.aboveBob + 1e-6);
            expect(d).toBeLessThanOrEqual(b.radius);
          } else {
            expect(Math.abs(d - ring0)).toBeLessThanOrEqual(COVE_PIXIES.ringWobble + 1e-6);
            if (b.radius + COVE_PIXIES.ringGap <= reach - COVE_PIXIES.ringWobble) expect(d).toBeGreaterThan(b.radius);
            expect(l.y).toBeGreaterThanOrEqual(b.height * COVE_PIXIES.ringHeight[0] - 1e-6);
            expect(l.y).toBeLessThanOrEqual(b.height * COVE_PIXIES.ringHeight[1] + 1e-6);
          }
        });
      }
    }
  });

  it('leaves the 2D pixie path alone: the shared ellipse still holds a default Pixies3d', () => {
    const p = new Pixies3d({ x: 160, y: 100 }, 114, 3, 1, 50);
    for (let t = 0; t < 60; t += 1.7) for (const l of p.lights(t)) {
      expect(Math.abs(l.x - 10)).toBeLessThanOrEqual(PIXIE_RX / 16 + 1e-6);
      expect(Math.abs(l.y - 50 / 16)).toBeLessThanOrEqual((0.4 * PIXIE_RY) / 16 + 1e-6);
    }
  });

  it('builds the willow once for the forest: its builder hands out the tree the fit already built', () => {
    const calls: string[] = [];
    const base = (s: TreeSpec): BuiltTree => { calls.push(s.form); return buildTree(s); };
    const forest = new Forest([c.tree(), ...c.bushes()], { w: 64, h: 48 }, 0, c.builder(base));
    for (let i = 0; i < 20 && forest.built < forest.total; i++) forest.step({ x: 16, z: 12 }, 1e6);
    expect(forest.built).toBe(forest.total);
    expect(calls).not.toContain('willow');
    expect(calls.filter((f) => f === 'bush').length).toBeGreaterThan(0);
  });

  it('pushes a glow and a core and two wing cards per pixie', () => {
    const glows = newGlowBuf(), ghosts = newCardBuf();
    c.push(2, cam, glows, ghosts, null);
    expect(glows.n).toBe(PIXIE_COUNT * 2);
    expect(ghosts.n).toBe(PIXIE_COUNT * 2);
    expect(ghosts.look[4]).toBeCloseTo(PIXIE_WING_ALPHA, 6); // alpha of the first wing
  });

  it('shows a pixie the viewer sees and hides one behind a wall', () => {
    const w = 40, h = 30, tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
    for (let y = 0; y < h; y++) tiles[y * w + 20] = TILE_ID.Wall;
    const map = new TileMap(w, h, tiles);
    const view = new View(w, h);
    view.compute(map, 5.5 * TILE, 15.5 * TILE, 14, 'hard');
    for (const daylight of [false, true]) {
      const mask = new SightMask(map, { daylight, feather: DEFAULT_HAZE.feather, ramp: DEFAULT_HAZE.ramp });
      mask.update(view, null, 0);
      const seen = new Pixies3d({ x: 8 * 16, y: 15 * 16 }, 15 * 16, 1, 1, 14), behind = new Pixies3d({ x: 30 * 16, y: 15 * 16 }, 15 * 16, 1, 1, 14);
      const a = newGlowBuf(), ga = newCardBuf(), b = newGlowBuf(), gb = newCardBuf();
      seen.push(2, cam, a, ga, frames, mask);
      behind.push(2, cam, b, gb, frames, mask);
      expect(a.n).toBe(2);
      expect(ga.n).toBe(2);
      expect(b.n).toBe(0);
      expect(gb.n).toBe(0);
    }
  });

  it('puts a single pixie low over the ground when asked', () => {
    const p = new Pixies3d({ x: 160, y: 100 }, 114, 1, 1, 14);
    const l = p.lights(1);
    expect(l).toHaveLength(1);
    expect(l[0].y).toBeLessThan(1.5);
  });
});

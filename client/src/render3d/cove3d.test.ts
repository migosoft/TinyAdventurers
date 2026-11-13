import { describe, expect, it } from 'vitest';
import type { CoveInfo } from '../generated/CoveInfo';
import { coveLayout, placeCovePlants } from '../game/covemath';
import { PIXIE_COLOURS, PIXIE_COUNT, PIXIE_RX, PIXIE_RY, CANOPY_UP } from '../game/pixieMath';
import type { Cam } from './camera';
import { newCardBuf, newGlowBuf } from './cards';
import { Cove3d, PIXIE_LIGHT, Pixies3d } from './cove3d';
import { PlantField } from './plantField';
import { SWAY } from './wind';
import type { FrameRects } from './worldMesh';

const cove: CoveInfo = { x: 10, y: 8, w: 14, h: 10, tree_x: 16, tree_y: 12, seed: 5 };
const frames: FrameRects = {
  cove_tree: { x: 0, y: 0, w: 96, h: 100 }, cove_bush_a: { x: 100, y: 0, w: 24, h: 20 }, cove_bush_b: { x: 130, y: 0, w: 24, h: 20 },
  cove_tuft_a: { x: 160, y: 0, w: 12, h: 8 }, cove_tuft_b: { x: 180, y: 0, w: 12, h: 8 }, cove_fern: { x: 200, y: 0, w: 14, h: 14 },
  floor_1: { x: 300, y: 0, w: 16, h: 16 },
};
const cam: Cam = { x: 16, z: 12, pitch: Math.PI / 4, yaw: 0 };
const { foot } = coveLayout(cove);

describe('Cove3d', () => {
  const c = new Cove3d(cove, frames);

  it('stands the tree on the layout foot, swaying as the cove tree', () => {
    const tree = c.plants()[0];
    expect(tree.place.x).toBeCloseTo(foot.x / 16, 6);
    expect(tree.place.z).toBeCloseTo(foot.y / 16, 6);
    expect(tree.place.amp).toBe(SWAY.coveTree);
    expect(tree.sprite.page).toBe(-1);
    expect(tree.sprite.shape).toBeNull();
    expect(tree.sprite.rect).toEqual(frames.cove_tree);
  });

  it('turns every placed plant into one atlas sprite that sways lightly', () => {
    const placed = placeCovePlants(coveLayout(cove).spec);
    expect(placed.length).toBeGreaterThan(0);
    expect(c.plants()).toHaveLength(placed.length + 1);
    for (const p of c.plants().slice(1)) {
      expect(p.sprite.page).toBe(-1);
      expect(p.place.amp).toBe(SWAY.small);
      expect(p.sprite.foot.y).toBe(p.sprite.rect.h);
    }
  });

  it('hands over to a plant field that shows every sprite at once', () => {
    const f = PlantField.fromAtlas(c.plants(), { w: 64, h: 48 });
    expect(f.drawn).toBe(c.plants().length);
    const chunks = [...f.frame(true, 1).chunks.values()].flat();
    expect(chunks.every((k) => k.page === -1)).toBe(true);
    expect(chunks.reduce((n, k) => n + k.cards.n, 0)).toBeGreaterThan(0);
  });

  it('casts one shadow per plant, with negative ids and positive widths', () => {
    const k = c.casters();
    expect(k).toHaveLength(c.plants().length);
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

  it('keeps the pixies inside the 2D ellipse span', () => {
    for (let t = 0; t < 60; t += 1.7) {
      for (const l of c.lights(t)) {
        expect(Math.abs(l.x - foot.x / 16)).toBeLessThanOrEqual(PIXIE_RX / 16 + 1e-6);
        expect(Math.abs(l.z - foot.y / 16)).toBeLessThanOrEqual((0.6 * PIXIE_RY) / 16 + 1e-6);
        expect(Math.abs(l.y - CANOPY_UP / 16)).toBeLessThanOrEqual((0.4 * PIXIE_RY) / 16 + 1e-6);
      }
    }
  });

  it('pushes a glow and a core and two wing cards per pixie', () => {
    const glows = newGlowBuf(), ghosts = newCardBuf();
    c.push(2, cam, glows, ghosts, null);
    expect(glows.n).toBe(PIXIE_COUNT * 2);
    expect(ghosts.n).toBe(PIXIE_COUNT * 2);
    expect(ghosts.look[4]).toBeCloseTo(0.7, 6); // alpha of the first wing
  });

  it('puts a single pixie low over the ground when asked', () => {
    const p = new Pixies3d({ x: 160, y: 100 }, 114, 1, 1, 14);
    const l = p.lights(1);
    expect(l).toHaveLength(1);
    expect(l[0].y).toBeLessThan(1.5);
  });
});

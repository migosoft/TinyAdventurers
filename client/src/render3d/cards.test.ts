import { describe, expect, it } from 'vitest';
import { ART, project, snapGround, viewRay, type Cam } from './camera';
import { buildDynamic, LIE_Y, newCardBuf, pushCard, pushFlat, pushGlow, pushLying, pushShadow, sortBackToFront, type Card, type CardBuf, type GlowBuf, type ShadowBuf } from './cards';
import { newScene } from './scene';
import type { FrameRects } from './worldMesh';

const frames: FrameRects = {};
for (const b of ['knight_m', 'wizzard_m', 'elf_f', 'orc_warrior', 'skelet', 'big_demon'])
  for (const a of ['idle', 'run']) for (let i = 0; i < 4; i++) frames[`${b}_${a}_anim_f${i}`] = { x: 100, y: 200, w: 16, h: 28 };
frames.crate = { x: 10, y: 20, w: 16, h: 16 };
for (let i = 0; i < 5; i++) frames[`torch_f${i}`] = { x: 300 + i * 16, y: 0, w: 16, h: 16 };

const cam = (yaw: number): Cam => ({ x: 10, z: 6, pitch: Math.PI / 4, yaw });

/** The quad (6 vertices from the first card) as its distinct corner positions. */
function corners(pos: Float32Array, q = 0): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const p = [pos[(q * 6 + i) * 3], pos[(q * 6 + i) * 3 + 1], pos[(q * 6 + i) * 3 + 2]];
    if (!out.some((o) => o.every((v, k) => v === p[k]))) out.push(p);
  }
  return out;
}

describe('cards', () => {
  it('stands a 16x28 figure on its snapped foot, 1 wide along x at yaw 0', () => {
    const s = newScene();
    const d = buildDynamic(s, frames, cam(0), 0, false);
    const c = corners(d.cards.position);
    expect(c.length).toBe(4);
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]), zs = c.map((p) => p[2]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 5);
    expect(Math.max(...ys)).toBeCloseTo(1.75, 5);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    const foot = snapGround(Math.PI / 4, 0, s.ents[0].x, s.ents[0].z);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(foot.x, 5);
    expect(zs[0]).toBeCloseTo(foot.z, 5);
    expect(zs.every((z) => Math.abs(z - zs[0]) < 1e-6)).toBe(true);
    expect(d.cards.count).toBe(s.ents.length + s.props.length);
  });

  it('is 1 wide along z at yaw 90 degrees', () => {
    const s = newScene();
    const d = buildDynamic(s, frames, cam(Math.PI / 2), 0, false);
    const c = corners(d.cards.position);
    const xs = c.map((p) => p[0]), zs = c.map((p) => p[2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1, 5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0, 5);
  });

  it('swaps u when the figure faces left', () => {
    const s = newScene();
    s.player.fx = 1; s.player.fz = 0;
    const right = buildDynamic(s, frames, cam(0), 0, false);
    s.player.fx = -1;
    const left = buildDynamic(s, frames, cam(0), 0, false);
    const us = (q: Float32Array) => new Set([...Array(6).keys()].map((i) => q[i * 2]));
    expect(us(right.cards.uv)).toEqual(new Set([100, 116]));
    const lu = [...Array(6).keys()].map((i) => left.cards.uv[i * 2]);
    const ru = [...Array(6).keys()].map((i) => right.cards.uv[i * 2]);
    expect(lu.map((u) => (u === 100 ? 116 : 100))).toEqual(ru);
    // top vertices carry rect.y, foot vertices rect.y + h
    expect(Math.min(...[...Array(6).keys()].map((i) => right.cards.uv[i * 2 + 1]))).toBe(200);
    expect(Math.max(...[...Array(6).keys()].map((i) => right.cards.uv[i * 2 + 1]))).toBe(228);
  });

  it('counts 6 glows, 8 with the orb', () => {
    const s = newScene();
    expect(buildDynamic(s, frames, cam(0), 1, false).glows.count).toBe(6);
    expect(buildDynamic(s, frames, cam(0), 1, true).glows.count).toBe(8);
  });

  it('keeps torch quads in place whatever the yaw', () => {
    const s = newScene();
    const a = buildDynamic(s, frames, cam(0), 0.3, false);
    const b = buildDynamic(s, frames, cam(Math.PI / 2), 0.3, false);
    expect(a.emissive.count).toBe(s.torches.length);
    expect(Array.from(b.emissive.position)).toEqual(Array.from(a.emissive.position));
  });

  it('spans each glow by the camera right and up axes, a square of side 2 size on screen, in front of its wall and floor', () => {
    const s = newScene();
    for (const deg of [30, 45, 60, 80]) for (const yd of [0, 45]) {
      const pitch = (deg * Math.PI) / 180, yaw = (yd * Math.PI) / 180;
      const cm: Cam = { x: 10, z: 6, pitch, yaw };
      const d = buildDynamic(s, frames, cm, 0, false);
      const size = 1.5; // the first glow is a torch glow
      const t0 = s.torches[0];
      const pts = corners(d.glows.position, 0);
      expect(pts.length).toBe(4);
      const sc = pts.map((p) => project(cm, p[0], p[1], p[2]));
      const sx = sc.map((p) => p.sx), sy = sc.map((p) => p.sy);
      // a square of side 2 size, centred on where the glow's own position projects
      const home = project(cm, t0.x, t0.y + 0.25, t0.z - 0.14);
      expect(Math.max(...sx) - Math.min(...sx)).toBeCloseTo(2 * size, 5);
      expect(Math.max(...sy) - Math.min(...sy)).toBeCloseTo(2 * size, 5);
      expect((Math.max(...sx) + Math.min(...sx)) / 2).toBeCloseTo(home.sx, 5);
      expect((Math.max(...sy) + Math.min(...sy)) / 2).toBeCloseTo(home.sy, 5);
      // the whole disc lies nearer the camera than the torch by at least its size, so it clears wall, wall top and floor
      // (project()'s depth grows away from the camera)
      for (const p of sc) expect(home.depth - p.depth).toBeGreaterThanOrEqual(size - 1e-9);
    }
    expect(ART).toBe(16);
  });
});

// ---- Card passes (#303) ----

const card = (o: Partial<Card> = {}): Card => ({
  frame: 'knight_m_idle_anim_f0', x: 3.3, z: 4.1, lift: 0, flip: false, originX: 0.5, footY: 1, scale: 1,
  tint: [1, 1, 1], mode: 0, alpha: 1, ...o,
});
/** Vertices of quad q of a CardBuf: [x, y, z] by ORDER (0 TL, 1 BL, 2 BR, 3 TL, 4 BR, 5 TR). */
const vert = (b: CardBuf, q: number, i: number): number[] => [0, 1, 2].map((k) => b.position[(q * 6 + i) * 3 + k]);
const TL = 0, BL = 1, BR = 2, TR = 5;
const corner4 = (b: CardBuf, q = 0): number[][] => [TL, TR, BR, BL].map((i) => vert(b, q, i));
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

describe('pushCard', () => {
  it('stands a 16x28 frame on the snapped foot, bottom at y 0, top at 28/16', () => {
    const b = newCardBuf();
    pushCard(b, card(), frames, cam(0));
    expect(b.n).toBe(1);
    const foot = snapGround(Math.PI / 4, 0, 3.3, 4.1);
    const [tl, tr, br, bl] = corner4(b);
    expect(near(bl, [foot.x - 0.5, 0, foot.z])).toBe(true);
    expect(near(br, [foot.x + 0.5, 0, foot.z])).toBe(true);
    expect(near(tl, [foot.x - 0.5, 28 / 16, foot.z])).toBe(true);
    expect(near(tr, [foot.x + 0.5, 28 / 16, foot.z])).toBe(true);
  });

  it('lift raises all four corners', () => {
    const a = newCardBuf(), l = newCardBuf();
    pushCard(a, card(), frames, cam(0));
    pushCard(l, card({ lift: 0.5 }), frames, cam(0));
    corner4(a).forEach((p, i) => expect(near(corner4(l)[i], [p[0], p[1] + 0.5, p[2]])).toBe(true));
  });

  it('flip swaps u', () => {
    const a = newCardBuf(), f = newCardBuf();
    pushCard(a, card(), frames, cam(0));
    pushCard(f, card({ flip: true }), frames, cam(0));
    expect(a.uv[0]).toBe(100); // TL
    expect(f.uv[0]).toBe(116);
    expect(a.uv[2 * TR]).toBe(116);
    expect(f.uv[2 * TR]).toBe(100);
  });

  it('crop shortens the quad and its uv to the crop', () => {
    const b = newCardBuf();
    pushCard(b, card({ crop: { x: 0, y: 8, w: 16, h: 20 } }), frames, cam(0));
    const [tl, , , bl] = corner4(b);
    expect(tl[1] - bl[1]).toBeCloseTo(20 / 16, 6);
    expect(bl[1]).toBeCloseTo(0, 6);
    expect(b.uv[1]).toBe(208);
    expect(b.uv[2 * BL + 1]).toBe(228);
  });

  it('angle pi/2 about a pivot turns the frame clockwise: the head points along screen right', () => {
    const b = newCardBuf();
    const cm = cam(0.7);
    pushCard(b, card({ angle: Math.PI / 2, pivot: [8, 28] }), frames, cm);
    const head = project(cm, ...(vert(b, 0, TL) as [number, number, number]));
    const foot = project(cm, ...(vert(b, 0, BL) as [number, number, number]));
    expect(head.sx - foot.sx).toBeCloseTo(28 / 16, 5);
    expect(head.sy - foot.sy).toBeCloseTo(0, 5);
  });

  it('follows the camera right vector at yaw 90 degrees', () => {
    const b = newCardBuf();
    pushCard(b, card(), frames, cam(Math.PI / 2));
    const [tl, tr] = corner4(b);
    expect(tr[0] - tl[0]).toBeCloseTo(0, 6);
    expect(tr[2] - tl[2]).toBeCloseTo(1, 6);
  });

  it('bias moves every corner along the view ray', () => {
    const a = newCardBuf(), p = newCardBuf();
    const cm = cam(0.4);
    pushCard(a, card(), frames, cm);
    pushCard(p, card({ bias: 0.5 }), frames, cm);
    const r = viewRay(cm.pitch, cm.yaw);
    corner4(a).forEach((c, i) => expect(near(corner4(p)[i], [c[0] + 0.5 * r[0], c[1] + 0.5 * r[1], c[2] + 0.5 * r[2]])).toBe(true));
  });

  it('writes the look of every vertex and skips a frame the atlas lacks', () => {
    const b = newCardBuf();
    pushCard(b, card({ tint: [0.2, 0.4, 0.6], mode: 2, alpha: 0.5 }), frames, cam(0));
    expect(b.look.length).toBe(30);
    for (let i = 0; i < 6; i++) expect(b.look.slice(i * 5, i * 5 + 5)).toEqual([0.2, 0.4, 0.6, 2, 0.5]);
    pushCard(b, card({ frame: 'nope' }), frames, cam(0));
    expect(b.n).toBe(1);
    expect(b.position.length).toBe(18);
  });
});

describe('pushLying', () => {
  it('lies flat at LIE_Y with the head toward screen right or left', () => {
    for (const headRight of [true, false]) for (const yaw of [0, 1.1, Math.PI]) {
      const b = newCardBuf();
      const cm = cam(yaw);
      pushLying(b, { ...card(), headRight }, frames, cm);
      expect(b.n).toBe(1);
      for (let i = 0; i < 6; i++) expect(vert(b, 0, i)[1]).toBe(LIE_Y);
      const sx = (i: number) => project(cm, ...(vert(b, 0, i) as [number, number, number])).sx;
      const head = (sx(TL) + sx(TR)) / 2, foot = (sx(BL) + sx(BR)) / 2;
      expect(head - foot).toBeCloseTo(headRight ? 28 / 16 : -28 / 16, 5);
    }
  });

  it('skips a frame the atlas lacks', () => {
    const b = newCardBuf();
    pushLying(b, { ...card({ frame: 'nope' }), headRight: true }, frames, cam(0));
    expect(b.n).toBe(0);
  });
});

describe('sortBackToFront', () => {
  it('puts the farther quad first, at yaw 0 and at yaw 180', () => {
    for (const yaw of [0, Math.PI]) {
      const b = newCardBuf();
      const cm = cam(yaw);
      const near_ = yaw === 0 ? 8 : 2, far_ = yaw === 0 ? 2 : 8; // at yaw 0 smaller z is farther
      pushCard(b, card({ z: near_, x: 5 }), frames, cm);
      pushCard(b, card({ z: far_, x: 5 }), frames, cm);
      sortBackToFront(b, cm);
      expect(b.n).toBe(2);
      expect(vert(b, 0, BL)[2]).toBeCloseTo(snapGround(cm.pitch, yaw, 5, far_).z, 6);
      expect(vert(b, 1, BL)[2]).toBeCloseTo(snapGround(cm.pitch, yaw, 5, near_).z, 6);
      expect(b.look.length).toBe(60);
    }
  });
});

describe('shadows and glows', () => {
  it('pushShadow makes a floor quad with uv -1..1 and the alpha on every vertex', () => {
    const b: ShadowBuf = { position: [], uv: [], alpha: [], n: 0 };
    pushShadow(b, cam(0), 4, 5, 0.4, 0.2, 0.45);
    expect(b.n).toBe(1);
    expect(b.position.length).toBe(18);
    expect(b.alpha).toEqual([0.45, 0.45, 0.45, 0.45, 0.45, 0.45]);
    expect(new Set(b.uv)).toEqual(new Set([-1, 1]));
    const xs = b.position.filter((_, i) => i % 3 === 0), zs = b.position.filter((_, i) => i % 3 === 2);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.8, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.4, 6);
  });

  it('pushShadow keeps its wide axis along screen right at any yaw', () => {
    for (const yaw of [Math.PI / 2, Math.PI / 4]) {
      const b: ShadowBuf = { position: [], uv: [], alpha: [], n: 0 };
      const c = cam(yaw);
      pushShadow(b, c, 4, 5, 0.4, 0.2, 0.45);
      const sx: number[] = [], sy: number[] = [];
      for (let i = 0; i < 6; i++) {
        const p = project(c, b.position[i * 3], b.position[i * 3 + 1], b.position[i * 3 + 2]);
        sx.push(p.sx);
        sy.push(p.sy);
      }
      expect(Math.max(...sx) - Math.min(...sx)).toBeCloseTo(0.8, 6);
      expect(Math.max(...sy) - Math.min(...sy)).toBeCloseTo(0.4 * Math.sin(c.pitch), 6);
    }
  });

  it('pushFlat lays a card on the floor with its top edge farther from the camera, at any yaw', () => {
    for (const yaw of [0, Math.PI / 2, 1]) {
      const b = newCardBuf();
      const c = cam(yaw);
      pushFlat(b, { frame: 'crate', x: 4, z: 5, lift: 0, flip: true, originX: 0.5, footY: 0.5, scale: 1, tint: [1, 1, 1], mode: 0, alpha: 1 }, frames, c);
      const depth = (v: number): number => {
        const d: number[] = [];
        for (let i = 0; i < 6; i++) if (b.uv[i * 2 + 1] === v) d.push(project(c, b.position[i * 3], b.position[i * 3 + 1], b.position[i * 3 + 2]).depth);
        return d.reduce((a, x) => a + x, 0) / d.length;
      };
      expect(depth(20)).toBeGreaterThan(depth(36)); // crate: y 20, h 16; top row first
      expect(new Set(b.position.filter((_, i) => i % 3 === 1))).toEqual(new Set([LIE_Y]));
    }
  });

  it('pushGlow adds one quad with the colour on its six vertices', () => {
    const b: GlowBuf = { position: [], uv: [], color: [], n: 0 };
    pushGlow(b, 1, 1, 1, 0.5, [0.1, 0.2, 0.3], cam(0));
    expect(b.n).toBe(1);
    expect(b.color).toEqual([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3]);
  });

  it('the demo fills only cards, flames and glows', () => {
    const d = buildDynamic(newScene(), frames, cam(0), 0, false);
    expect([d.ghosts.count, d.decals.count, d.shadows.count]).toEqual([0, 0, 0]);
    expect(d.cards.look.length).toBe(d.cards.count * 30);
  });
});

describe('Card spaces (display space, like Pose)', () => {
  it('flip with originX 0.25 keeps the anchor column and only reads the texture back to front', () => {
    const a = newCardBuf(), f = newCardBuf();
    pushCard(a, card({ originX: 0.25 }), frames, cam(0));
    pushCard(f, card({ originX: 0.25, flip: true }), frames, cam(0));
    const foot = snapGround(Math.PI / 4, 0, 3.3, 4.1);
    for (const b of [a, f]) {
      const [tl, tr] = corner4(b);
      expect(tl[0]).toBeCloseTo(foot.x - 4 / 16, 6);
      expect(tr[0]).toBeCloseTo(foot.x + 12 / 16, 6);
    }
    expect(a.uv[0]).toBe(100);
    expect(f.uv[0]).toBe(116);
  });

  it('flip with a pivot turns the same way on screen as without', () => {
    const a = newCardBuf(), f = newCardBuf();
    const o = { angle: Math.PI / 2, pivot: [4, 28] as [number, number], originX: 0.25 };
    pushCard(a, card(o), frames, cam(0));
    pushCard(f, card({ ...o, flip: true }), frames, cam(0));
    corner4(a).forEach((p, i) => expect(near(corner4(f)[i], p)).toBe(true));
  });

  it('offset is in px times scale, y down: +y moves the card down on screen', () => {
    const a = newCardBuf(), o = newCardBuf();
    pushCard(a, card({ scale: 2 }), frames, cam(0));
    pushCard(o, card({ scale: 2, offset: [4, 8] }), frames, cam(0));
    corner4(a).forEach((p, i) => {
      const q = corner4(o)[i];
      expect(q[0] - p[0]).toBeCloseTo(8 / 16, 6);
      expect(q[1] - p[1]).toBeCloseTo(-16 / 16, 6);
    });
  });

  it('a crop is in display space under flip: its uv is mirrored, its position is not', () => {
    const a = newCardBuf(), f = newCardBuf();
    const crop = { x: 2, y: 0, w: 4, h: 28 };
    pushCard(a, card({ crop }), frames, cam(0));
    pushCard(f, card({ crop, flip: true }), frames, cam(0));
    const foot = snapGround(Math.PI / 4, 0, 3.3, 4.1);
    for (const b of [a, f]) {
      const [tl, tr] = corner4(b);
      expect(tl[0]).toBeCloseTo(foot.x + (2 - 8) / 16, 6);
      expect(tr[0]).toBeCloseTo(foot.x + (6 - 8) / 16, 6);
    }
    expect([a.uv[0], a.uv[2 * TR]]).toEqual([102, 106]);
    expect([f.uv[0], f.uv[2 * TR]]).toEqual([114, 110]);
  });
});

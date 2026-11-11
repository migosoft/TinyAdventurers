import { describe, expect, it } from 'vitest';
import { ART, project, snapGround, type Cam } from './camera';
import { buildDynamic } from './cards';
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

  it('makes each glow an upright square on screen: 2 size wide along (c, 0, s), 2 size / cos(pitch) tall, centred', () => {
    const s = newScene();
    for (const deg of [30, 45, 60]) {
      const pitch = (deg * Math.PI) / 180, yaw = 0.6;
      const cm: Cam = { x: 10, z: 6, pitch, yaw };
      const d = buildDynamic(s, frames, cm, 0, false);
      const g = d.glows.position;
      const size = 1.5; // the first glow is a torch glow
      const pts = corners(g, 0);
      expect(pts.length).toBe(4);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), zs = pts.map((p) => p[2]);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo((2 * size) / Math.cos(pitch), 5);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * size * Math.abs(Math.cos(yaw)), 5);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2 * size * Math.abs(Math.sin(yaw)), 5);
      const t0 = s.torches[0];
      expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(t0.y + 0.25, 5);
      const sc = pts.map((p) => project(cm, p[0], p[1], p[2]));
      const sx = sc.map((p) => p.sx), sy = sc.map((p) => p.sy);
      expect(Math.max(...sx) - Math.min(...sx)).toBeCloseTo(2 * size, 5);
      expect(Math.max(...sy) - Math.min(...sy)).toBeCloseTo(2 * size, 5);
    }
    expect(ART).toBe(16);
  });
});

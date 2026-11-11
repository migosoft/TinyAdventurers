import { describe, expect, it } from 'vitest';
import { MAX_LIGHTS, packLights, sceneLights, torchFlicker, type Light } from './light';
import { newScene } from './scene';

const lamp = (n: number): Light => ({ x: n, y: 1, z: 2, radius: 3, r: 0.5, g: 0.6, b: 0.7, shadow: n % 2 === 0 });

describe('light', () => {
  it('flickers around 1 within 0.84..1.16', () => {
    expect(torchFlicker(0, 0)).toBe(1);
    for (let t = 0; t <= 10; t += 0.01) {
      const f = torchFlicker(t, 1.7);
      expect(f).toBeGreaterThanOrEqual(0.84);
      expect(f).toBeLessThanOrEqual(1.16);
    }
  });
  it('gives six torch lights, and the orb as a seventh', () => {
    const s = newScene();
    const a = sceneLights(s, 1.3, false);
    const b = sceneLights(s, 1.3, true);
    expect(a.length).toBe(6);
    expect(b.length).toBe(7);
    expect([...a, ...b].every((l) => l.shadow)).toBe(true);
    expect(a[0].radius).toBe(8.5);
    expect(b[6].radius).toBe(5.5);
    expect(b[6].b).toBeCloseTo(1.25);
  });
  it('places a torch light just above and in front of its torch', () => {
    const s = newScene();
    const l = sceneLights(s, 0, false)[0];
    expect(l.x).toBeCloseTo(s.torches[0].x);
    expect(l.y).toBeCloseTo(s.torches[0].y + 0.25);
    expect(l.z).toBeCloseTo(s.torches[0].z + 0.1);
  });
  it('packs 3 lights into 3 slots and leaves radius 0 elsewhere', () => {
    const p = packLights([lamp(1), lamp(2), lamp(3)]);
    expect(p.pos.length).toBe(MAX_LIGHTS * 4);
    expect(p.col.length).toBe(MAX_LIGHTS * 4);
    expect(Array.from(p.pos.slice(0, 4))).toEqual([1, 1, 2, 3]);
    expect(p.col[3]).toBe(0);
    expect(p.col[7]).toBe(1);
    for (let i = 3; i < MAX_LIGHTS; i++) expect(p.pos[i * 4 + 3]).toBe(0);
  });
  it('keeps the first 8 of 10 lights', () => {
    const p = packLights(Array.from({ length: 10 }, (_, i) => lamp(i)));
    expect(p.pos[7 * 4]).toBe(7);
    expect(p.pos.length).toBe(32);
  });
});

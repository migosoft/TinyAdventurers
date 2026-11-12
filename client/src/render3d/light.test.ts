import { describe, expect, it } from 'vitest';
import { cssColour, darkAlpha, dungeonAmbient, AMBIENT, MAX_LIGHTS, STONE, WORK_AMBIENT, packLights, sceneLights, shoulder, stoneClear, torchFlicker, type Light } from './light';
import { newScene } from './scene';

const lamp = (n: number): Light => ({ x: n, y: 1, z: 2, radius: 3, r: 0.5, g: 0.6, b: 0.7, shadow: n % 2 === 0 });

describe('light', () => {
  it('scales the dungeon ambient and turns it into a dark alpha', () => {
    expect(dungeonAmbient(0)).toEqual([0, 0, 0]);
    expect(dungeonAmbient(1)).toEqual(AMBIENT);
    expect(darkAlpha([0, 0, 0])).toBe(0);
    expect(darkAlpha(AMBIENT)).toBe(1);
    expect(darkAlpha(dungeonAmbient(0.5))).toBeCloseTo(0.5, 5);
  });
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
  it('has a shoulder that leaves low values alone and rolls off high ones', () => {
    expect(shoulder(0.2)).toBeCloseTo(0.2, 9);
    expect(shoulder(2)).toBeCloseTo(1 - Math.exp(-3.2), 6);
  });
  it('clears to the lit wall top: stone times ambient', () => {
    const c = stoneClear(AMBIENT);
    for (let i = 0; i < 3; i++) expect(c[i]).toBeCloseTo(STONE[i] * AMBIENT[i], 6);
    for (const v of stoneClear(WORK_AMBIENT)) expect(v).toBeLessThan(0.2);
  });
  it('writes a clear colour as CSS bytes (the demo hall: 2, 2, 5)', () => {
    expect(cssColour(stoneClear(AMBIENT))).toBe('rgb(2, 2, 5)');
    expect(cssColour([2, -1, 0.5])).toBe('rgb(255, 0, 128)');
  });
});

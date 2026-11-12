import { describe, expect, it } from 'vitest';
import { DataTexture, Texture } from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import { makeLighting, type Lighting } from './lightNodes';
import { cardMaterial, viewTowardUniform, worldMaterial } from './materials';

type Opts = { self?: unknown; darkOnly?: unknown } | undefined;
/** A stub `Lighting` that records the options `lightAt` was called with. */
function stub(): { lighting: Lighting; calls: Opts[] } {
  const calls: Opts[] = [];
  const lighting = {
    lightAt: (_p: unknown, _n: unknown, _w: unknown, opts?: Opts) => {
      calls.push(opts);
      return { rgb: vec3(1, 1, 1), dv: float(0) };
    },
    finish: (a: unknown) => a,
    shoulder: (c: unknown) => c,
    cellH: () => float(0),
  } as unknown as Lighting;
  return { lighting, calls };
}
const make = (opts: { flat?: boolean; translucent?: boolean }) => cardMaterial(new Texture(), 64, 64, stub().lighting, viewTowardUniform(), opts).material;

/** Whether a node graph reads the geometry attribute `name`. */
function readsAttribute(root: unknown, name: string): boolean {
  const seen = new Set<unknown>();
  const walk = (n: unknown): boolean => {
    if (!n || typeof n !== 'object' || seen.has(n)) return false;
    seen.add(n);
    if ((n as { _attributeName?: string })._attributeName === name) return true;
    return Object.values(n as object).some(walk);
  };
  return walk(root);
}

describe('cardMaterial', () => {
  it('honours the card alpha in the translucent pass, with no depth write', () => {
    const m = make({ flat: true, translucent: true });
    expect(m.transparent).toBe(true);
    expect(m.opacityNode).not.toBeNull();
    expect(m.depthWrite).toBe(false);
  });
  it('the opaque pass ignores it', () => {
    const m = make({ flat: true });
    expect(m.transparent).toBe(false);
    expect(m.opacityNode).toBeNull();
  });
  it('reads the shade attribute for its caster slot and its dark flag', () => {
    const { lighting, calls } = stub();
    const m = cardMaterial(new Texture(), 64, 64, lighting, viewTowardUniform()).material;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.self).toBeDefined();
    expect(calls[0]?.darkOnly).toBeDefined();
    expect(readsAttribute(m.colorNode, 'shade') || readsAttribute(calls[0], 'shade')).toBe(true);
  });
});

describe('worldMaterial', () => {
  it('passes no shade options to the light', () => {
    const { lighting, calls } = stub();
    worldMaterial(new Texture(), new Texture(), 64, 64, lighting, new Texture(), new Texture());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeUndefined();
  });
});

describe('makeLighting lava', () => {
  const heights = new DataTexture(new Uint8Array(12), 4, 3);
  it('accepts null and a w*h*4 array, and holds w*h*4 texels', () => {
    const l = makeLighting(heights, { w: 4, h: 3 });
    expect(() => l.setLava(null)).not.toThrow();
    const data = new Float32Array(4 * 3 * 4).fill(0.5);
    expect(() => l.setLava(data)).not.toThrow();
    expect(l.lavaTexture.image.data).toHaveLength(4 * 3 * 4);
    expect(() => l.setLava(null)).not.toThrow();
    expect(Array.from(l.lavaTexture.image.data as ArrayLike<number>).every((v) => v === 0)).toBe(true);
  });
  it('uploads a refilled array when the version changes, and not before', () => {
    const l = makeLighting(heights, { w: 4, h: 3 });
    const data = new Float32Array(4 * 3 * 4);
    data[0] = 1;
    l.setLava(data, 1);
    const tex = l.lavaTexture;
    const v = tex.version;
    const first = (tex.image.data as Uint16Array)[0];
    data[0] = 0.25;
    l.setLava(data, 1);
    expect(tex.version).toBe(v);
    expect((tex.image.data as Uint16Array)[0]).toBe(first);
    l.setLava(data, 2);
    expect(tex.version).toBeGreaterThan(v);
    expect((tex.image.data as Uint16Array)[0]).not.toBe(first);
  });
  it('accepts the darkvision light', () => {
    const l = makeLighting(heights, { w: 4, h: 3 });
    expect(() => l.setDarkvision({ x: 1, z: 2, reach: 3 })).not.toThrow();
    expect(() => l.setDarkvision(null)).not.toThrow();
  });
});

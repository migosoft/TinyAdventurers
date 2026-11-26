// The water's and the ceiling's shader code as three generates it (GLSL and WGSL), built without a GPU (#345).
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DataTexture, GLSLNodeBuilder, Matrix4, Texture, WGSLNodeBuilder, type NodeMaterial } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { viewTowardUniform } from '../materials';
import { fragment, loops, readsInBranches, vertex, type Builder } from '../shaderCode.testutil';
import { OUTLINE_EDGE, WATER_LEVEL } from '../dips/shape';
import { FISH_AWAY, FISH_CAP, FISH_STRIDE } from '../pond/fish';
import { PUDDLE_LEVEL } from '../stone/shape';
import { CURRENT, DAY, FISH_LOOK, PUDDLE_GATE, STIR, ceilingMaterial, waterMaterial, type WaterMaterial } from './waterNodes';

const lighting = () => makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture());
const water = (): WaterMaterial => waterMaterial(lighting(), makeSight(), new Texture(), { w: 4, h: 3 }, viewTowardUniform());
const both = (): [string, NodeMaterial][] => [['water', water().material], ['ceiling', ceilingMaterial(lighting(), makeSight())]];

describe('the water and ceiling materials', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: both build, and building logs no TSL error`, () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        for (const [name, m] of both()) expect(fragment(B, m).length, name).toBeGreaterThan(100);
        expect(err).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        err.mockRestore();
        warn.mockRestore();
      }
    });

    it(`${B.name}: uses no sine hash`, () => {
      for (const [name, m] of both()) expect(fragment(B, m), name).not.toContain('43758');
    });

    it(`${B.name}: reads no texture and no derivative in a branch`, () => {
      for (const [name, m] of both()) expect(readsInBranches(fragment(B, m)), name).toEqual([]);
    });

    it(`${B.name}: the water keeps its loops apart`, () => {
      const ls = loops(fragment(B, water().material));
      const names = new Set(ls.map((l) => l.name));
      // The ripples (three evaluations of the surface height), the light's loops and the glints'.
      for (const n of ['rp', 'li', 'cs', 'ws', 'gl', 'gc']) expect(names.has(n), n).toBe(true);
      expect(ls.filter((l) => l.name === 'rp').length).toBe(3);
      // No loop sits inside a loop of its own name, and a ripple loop sits in none.
      for (const l of ls) expect(l.outer, l.name).not.toContain(l.name);
      for (const l of ls.filter((x) => x.name === 'rp')) expect(l.outer).toEqual([]);
    });

    it(`${B.name}: only a puddle's sheet gets the ring sheen (#380)`, () => {
      // the gate lies above a pool's sheet and not above a puddle's, and the shader steps on the surface's own height with it
      expect(PUDDLE_GATE).toBeGreaterThan(WATER_LEVEL);
      expect(PUDDLE_GATE).toBeLessThanOrEqual(PUDDLE_LEVEL);
      const w = fragment(B, water().material);
      const gate = `${PUDDLE_GATE}`.replace('.', '\\.');
      expect(w).toMatch(new RegExp(`step\\(\\s*${gate}\\s*,\\s*\\w+\\.y\\s*\\)`));
      expect((w.match(new RegExp(gate, 'g')) ?? []).length).toBe(1);
    });

    it(`${B.name}: the water discards outside the pool's outline`, () => {
      // Every material holds the sight clip's discard; only the water adds the alpha test's (`DiffuseColor.w <= alphaTest`).
      const alphaTest = /if\s*\(\s*\(\s*DiffuseColor\.w\s*<=\s*[\w.]+\s*\)\s*\)\s*\{\s*discard/;
      const discards = (code: string): number => (code.match(/\bdiscard\b/g) ?? []).length;
      const w = fragment(B, water().material);
      const c = fragment(B, ceilingMaterial(lighting(), makeSight()));
      expect(w).toMatch(alphaTest);
      // ... and the alpha it tests is the outline mask: `step(OUTLINE_EDGE, <the field's second channel>)`.
      expect(w).toMatch(new RegExp(`DiffuseColor\\s*=\\s*vec4(?:<f32>)?\\(.*step\\(\\s*${OUTLINE_EDGE}\\s*,\\s*\\w+\\.y\\s*\\)\\s*\\)`));
      expect(c).not.toMatch(alphaTest);
      expect(discards(w)).toBe(discards(c) + 1);
    });
  }

  it('stays within the uniform buffers of a WebGPU fragment stage', () => {
    for (const [name, m] of both()) expect((fragment(WGSLNodeBuilder, m).match(/var<uniform>/g) ?? []).length, name).toBeLessThanOrEqual(12);
  });

  it('reads no caster (the walls shadow the water, cards do not)', () => {
    // The world material's light carries three caster arrays more than the water's.
    const count = (m: NodeMaterial): number => (fragment(WGSLNodeBuilder, m).match(/var<uniform>/g) ?? []).length;
    const l = lighting();
    const build = (lit: typeof l): NodeMaterial => waterMaterial(lit, makeSight(), new Texture(), { w: 4, h: 3 }, viewTowardUniform()).material;
    const full = build({ ...l, lightAt: (p, n, w, o) => l.lightAt(p, n, w, { ...o, shadow: 'full' }) });
    expect(count(full) - count(build(l))).toBe(3);
  });

  describe('in daylight (#360)', () => {
    const sunny = () => makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: true });
    const build = (l: ReturnType<typeof lighting>, daylight: boolean): WaterMaterial => waterMaterial(l, makeSight(), new Texture(), { w: 4, h: 3 }, viewTowardUniform(), { daylight });

    for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
      it(`${B.name}: builds without a TSL error, reads nothing in a branch and keeps the ripples' loops apart`, () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const code = fragment(B, build(sunny(), true).material);
          expect(code.length).toBeGreaterThan(100);
          expect(readsInBranches(code)).toEqual([]);
          const ls = loops(code);
          expect(ls.filter((l) => l.name === 'rp').length).toBe(3);
          for (const l of ls) expect(l.outer, l.name).not.toContain(l.name);
          expect(err).not.toHaveBeenCalled();
          expect(warn).not.toHaveBeenCalled();
        } finally {
          err.mockRestore();
          warn.mockRestore();
        }
      });

      it(`${B.name}: without daylight the shader is the dungeon's, whether the lighting has a sun or not`, () => {
        // the dungeon's and the cove's water: no sky, no sun, none of the daylight's work
        const plain = fragment(B, water().material);
        expect(fragment(B, build(sunny(), false).material)).toBe(plain);
        expect(fragment(B, build(lighting(), false).material)).toBe(plain);
        for (const name of ['waterZenith', 'waterHorizon', 'waterFine']) expect(plain, name).not.toContain(name);
        const day = fragment(B, build(sunny(), true).material);
        for (const name of ['waterZenith', 'waterHorizon', 'waterFine']) expect(day, name).toContain(name);
      });

      it(`${B.name}: the sparkles and the caustics sit in one branch that quality Fast skips`, () => {
        const day = fragment(B, build(sunny(), true).material);
        // one `if` on the fine switch, and the twinkle's and the caustics' noise frequencies appear nowhere before it
        const at = day.search(/if\s*\(\s*\(\s*[\w.]*waterFine\s*>\s*0\.5\s*\)\s*\)/);
        expect(at).toBeGreaterThan(0);
        expect((day.match(/waterFine\s*>/g) ?? []).length).toBe(1);
        for (const k of [DAY.caustic.freq, DAY.spark.along, DAY.spark.across]) expect(day.slice(0, at), `${k}`).not.toContain(`${k}`);
      });
    }

    it('stays within the uniform buffers of a WebGPU fragment stage', () => {
      expect((fragment(WGSLNodeBuilder, build(sunny(), true).material).match(/var<uniform>/g) ?? []).length).toBeLessThanOrEqual(12);
    });

    it('takes the sky per frame; the dungeon has none', () => {
      expect(water().sky).toBeNull();
      const w = build(sunny(), true);
      w.setSky({ zenith: [0.1, 0.2, 0.3], horizon: [0.4, 0.5, 0.6] });
      expect(w.sky!.zenith.toArray()).toEqual([0.1, 0.2, 0.3]);
      expect(w.sky!.horizon.toArray()).toEqual([0.4, 0.5, 0.6]);
      water().setSky({ zenith: [1, 1, 1], horizon: [1, 1, 1] }); // nothing to set: no throw
    });

    it('drops the fine work with the mirror (quality Fast)', () => {
      const w = build(sunny(), true);
      expect(w.fine!.value).toBe(0);
      w.setMirror({ picture: new Texture(), matrix: new Matrix4() });
      expect(w.fine!.value).toBe(1);
      w.setMirror(null);
      expect(w.fine!.value).toBe(0);
      expect(water().fine).toBeNull();
    });

    describe('with a pond (#360)', () => {
      const MOUTHS = [{ x: 1.5, z: 1, dx: 0, dz: 1 }, { x: 3, z: 2, dx: -1, dz: 0 }];
      const pond = (mouths = MOUTHS): WaterMaterial => waterMaterial(sunny(), makeSight(), new Texture(), { w: 4, h: 3 }, viewTowardUniform(), { daylight: true, pond: { mouths } });

      for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
        it(`${B.name}: builds without a TSL error, reads nothing in a branch and keeps its loops apart`, () => {
          const err = vi.spyOn(console, 'error').mockImplementation(() => {});
          const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
          try {
            for (const m of [pond(), pond([])]) {
              const code = fragment(B, m.material);
              expect(readsInBranches(code)).toEqual([]);
              expect(code).not.toContain('43758');
              const ls = loops(code);
              expect(ls.filter((l) => l.name === 'rp').length).toBe(3);
              expect(ls.filter((l) => l.name === 'fi').length).toBe(1);
              for (const l of ls) expect(l.outer, l.name).not.toContain(l.name);
            }
            expect(err).not.toHaveBeenCalled();
            expect(warn).not.toHaveBeenCalled();
          } finally {
            err.mockRestore();
            warn.mockRestore();
          }
        });

        it(`${B.name}: only a pond's water has the current, the stir and the fish`, () => {
          const marks = [`${CURRENT.streak.freq}`, `${CURRENT.wavelet.freq}`, `${FISH_LOOK.wave}`];
          const with_ = fragment(B, pond().material), without = fragment(B, build(sunny(), true).material);
          for (const k of marks) { expect(with_, k).toContain(k); expect(without, k).not.toContain(k); }
          expect(with_).toContain(`${STIR.milk[0]}`);
          // a pond without daylight is no pond: the dungeon's shader
          const dark = waterMaterial(lighting(), makeSight(), new Texture(), { w: 4, h: 3 }, viewTowardUniform(), { pond: { mouths: MOUTHS } });
          expect(fragment(B, dark.material)).toBe(fragment(B, water().material));
          expect(dark.fish).toBeNull();
        });

        it(`${B.name}: quality Fast keeps the streaks and the fish and skips the wavelets`, () => {
          const code = fragment(B, pond().material);
          // two branches on the fine switch: the sparkles' and caustics', and the wavelets'
          expect((code.match(/if\s*\(\s*\(\s*[\w.]*waterFine\s*>\s*0\.5\s*\)\s*\)/g) ?? []).length).toBe(2);
          /** The headers of the blocks open at the first place `mark` appears: the text before each `{` back to the last `;`, `{` or `}`. */
          const around = (mark: string): string[] => {
            const at = code.indexOf(mark), heads: string[] = [];
            expect(at, mark).toBeGreaterThan(0);
            for (let i = 0; i < at; i++) {
              if (code[i] === '{') heads.push(code.slice(Math.max(code.lastIndexOf(';', i), code.lastIndexOf('}', i), code.lastIndexOf('{', i - 1)) + 1, i));
              else if (code[i] === '}') heads.pop();
            }
            return heads;
          };
          const inFine = (mark: string): boolean => around(mark).some((h) => /waterFine\s*>/.test(h));
          // every use of the wavelets' noise lies in a fine branch, inside the current's own branch (an `if` in an `if`)
          expect(inFine(`${CURRENT.wavelet.freq}`)).toBe(true);
          expect(around(`${CURRENT.wavelet.freq}`).filter((h) => /\bif\b/.test(h)).length).toBeGreaterThanOrEqual(2);
          // the streaks sit in the current's branch only, the fish in none of the fine ones
          expect(inFine(`${CURRENT.streak.freq}`)).toBe(false);
          expect(around(`${CURRENT.streak.freq}`).filter((h) => /\bif\b/.test(h)).length).toBeGreaterThanOrEqual(1);
          expect(inFine(`${FISH_LOOK.wave}`)).toBe(false);
        });
      }

      it('stays within the uniform buffers of a WebGPU fragment stage', () => {
        const n = (m: WaterMaterial): number => (fragment(WGSLNodeBuilder, m.material).match(/var<uniform>/g) ?? []).length;
        // one buffer more than the daylight water: the fish
        expect(n(pond())).toBe(n(build(sunny(), true)) + 1);
        expect(n(pond())).toBeLessThanOrEqual(12);
      });

      it('takes the fish and clears them', () => {
        const w = pond();
        expect(w.fish!.length).toBe(FISH_CAP);
        w.fish!.forEach((v) => expect([v.x, v.y]).toEqual([FISH_AWAY, FISH_AWAY]));
        const pos = new Float32Array(FISH_CAP * FISH_STRIDE).fill(FISH_AWAY);
        pos.set([3, 4, 0.5, 1.5], FISH_STRIDE);
        w.setFish(pos);
        expect(w.fish![1].toArray()).toEqual([3, 4, 0.5, 1.5]);
        w.setFish(null);
        expect(w.fish![1].toArray()).toEqual([FISH_AWAY, FISH_AWAY, 0, 0]);
        // no pond: nothing to set
        expect(build(sunny(), true).fish).toBeNull();
        build(sunny(), true).setFish(pos);
        water().setFish(pos);
      });
    });
  });

  describe('the dungeon\'s and the cove\'s water is unchanged (#360)', () => {
    // The shader text of the water without daylight, as recorded before the pond's current, stir and fish were added (sha256, the
    // first 16 hex digits). A change that is meant to alter the dungeon's water (or its lighting, which is part of the text) records
    // these again; anything else must leave them alone.
    const PINNED: [Builder, string, string][] = [
      [GLSLNodeBuilder, 'b30050d3472b1d13', 'a275636aa8d970c1'],
      [WGSLNodeBuilder, 'd6385ed84efdaca4', '28943ee78d54c8bc'],
    ];
    const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
    for (const [B, frag, vert] of PINNED) {
      it(`${B.name}: the shader is the recorded one`, () => {
        const m = water().material;
        expect(sha(fragment(B, m))).toBe(frag);
        expect(sha(vertex(B, m))).toBe(vert);
      });
    }
  });

  it('has no mirror term without a mirror', () => {
    const w = water();
    expect(w.mirrorOn.value).toBe(0);
    w.setMirror({ picture: new Texture(), matrix: new Matrix4() });
    expect(w.mirrorOn.value).toBe(1);
    w.setMirror(null);
    expect(w.mirrorOn.value).toBe(0);
  });

  it('takes the packed ripples and clears them', () => {
    const w = water();
    const packed = new Float32Array(64).fill(-1);
    packed.set([3, 4, 0.5, 1.6], 4);
    w.setRipples(packed);
    expect(w.ripples.length).toBe(16);
    expect(w.ripples[1].toArray()).toEqual([3, 4, 0.5, 1.6].map(Math.fround));
    w.ripples.forEach((v, i) => { if (i !== 1) expect(v.z, `slot ${i}`).toBe(-1); });
    w.setRipples(null);
    w.ripples.forEach((v, i) => expect(v.z, `slot ${i}`).toBe(-1));
  });
});

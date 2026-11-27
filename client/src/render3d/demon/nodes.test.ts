import { describe, expect, it } from 'vitest';
import { DataTexture, DoubleSide, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { makeLighting } from '../lightNodes';
import { makeSight } from '../sightNodes';
import { fragment, fragmentTextures, readsInBranches, vertex, type Builder } from '../shaderCode.testutil';
import { makeFigureShared } from '../models/nodes';
import { buildDemonSkin } from './body';
import { SKIN_PARTS, geometryOf, materialOf } from './layer';
import { GLOW, PAINT, demonMaterials } from './nodes';

function make(kind: 'fire' | 'ice' = 'fire') {
  const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun: false });
  return demonMaterials({ lighting, sight: makeSight(), shared: makeFigureShared(), kind });
}

const MATS = ['skin', 'web', 'cloth', 'blade', 'iron'] as const;
const DERIVATIVE = /\b(fwidth|dFdx|dFdy|dpdx|dpdy)\s*\(/;
/** The 14 lines of shader code that end with the line matching `last`. */
function before(code: string, last: RegExp): string {
  const lines = code.split('\n'), i = lines.findIndex((l) => last.test(l));
  expect(i).toBeGreaterThan(14);
  return lines.slice(i - 13, i + 1).join('\n').replace(/;\s*$/, ';');
}

describe('the demon materials', () => {
  it('are opaque, cut by alpha and two-sided; one set of bones; no crystal yet', () => {
    const m = make();
    for (const k of MATS) {
      expect(m[k].side).toBe(DoubleSide);
      expect(m[k].transparent).toBe(false);
      expect(m[k].depthWrite).toBe(true);
      expect(m[k].alphaTest).toBe(0.5);
    }
    expect(new Set(MATS.map((k) => m[k])).size).toBe(5);
    expect(m.crystal).toBeNull();
    expect(m.bones.array.length).toBe(88);
    m.dispose();
  });

  it('every part of the skin has its material: body, tail and tubes the skin\'s', () => {
    const m = make();
    expect(SKIN_PARTS.map((k) => MATS.find((n) => m[n] === materialOf(m, k)))).toEqual(['skin', 'skin', 'skin', 'web', 'cloth', 'blade', 'iron']);
    m.dispose();
  });

  it('the pose uniforms are the owner\'s own: two sets share none', () => {
    const a = make(), b = make();
    for (const k of ['life', 'beat', 'gaze'] as const) {
      expect(a.u.pose[k]).not.toBe(b.u.pose[k]);
      expect(a.u.pose[k].value).not.toBe(b.u.pose[k].value);
      expect(a.u.pose[k].value.toArray().length).toBe(4);
    }
    a.dispose(); b.dispose();
  });

  it('the two numbers tuned by eye, and a stone demon\'s glow', () => {
    expect(GLOW.gain).toBeGreaterThan(0);
    expect(PAINT.albedo).toBeGreaterThan(0);
    expect(GLOW.stone).toBe(0);
  });

  for (const [name, B] of [['GLSL', GLSLNodeBuilder], ['WGSL', WGSLNodeBuilder]] as [string, Builder][]) {
    describe(name, () => {
      const skin = buildDemonSkin(0.2);
      const m = make('fire');
      const built = SKIN_PARTS.map((k) => {
        const g = geometryOf(skin[k]), mat = materialOf(m, k);
        return { k, f: fragment(B, mat, { compare: true, geometry: g }), v: vertex(B, mat, { compare: true, geometry: g }), tex: fragmentTextures(B, mat, { compare: true, geometry: g }) };
      });

      it('every material builds for the fire demon; the bones are a uniform buffer within WebGPU\'s limit', () => {
        for (const { f, v } of built) {
          expect(v.length).toBeGreaterThan(0);
          expect(f).toMatch(/lightAmbient/);
          // the bones are an array of 88 matrices in a uniform buffer (88 x 64 bytes, WebGPU's limit is 64 KiB), not a texture
          if (B === WGSLNodeBuilder) expect(v).toMatch(/array< mat4x4<f32>, 88 >/);
          expect(v).toMatch(/skinIndex/);
          expect(v).toMatch(/skinWeight/);
        }
        expect(88 * 16 * 4).toBeLessThan(65536);
      });

      it('the ice demon builds too (the fire paint until its own comes)', () => {
        const ice = make('ice');
        for (const k of SKIN_PARTS) expect(fragment(B, materialOf(ice, k), { compare: true, geometry: geometryOf(skin[k]) })).toMatch(/lightAmbient/);
        ice.dispose();
      });

      it('no picture is read: the paint binds no texture the plain lit iron does not', () => {
        const plain = built.find((b) => b.k === 'iron')!.tex;
        expect(plain.length).toBeGreaterThan(0);
        for (const { tex } of built) expect(tex.filter((t) => !plain.includes(t))).toEqual([]);
      });

      it('the light and every derivative stand outside branches', () => {
        for (const { k, f } of built) {
          const inBranch = readsInBranches(f);
          // the lighting's own lava read under its `darkOnly` switch (a uniform of this material) is the only read the heuristic reports, once per `lightAt`; the lich's has it too
          expect(inBranch.filter((l) => DERIVATIVE.test(l)), k).toEqual([]);
          expect(inBranch.length, k).toBeLessThanOrEqual(k === 'web' ? 2 : 1);
        }
        // the relief is bent from screen derivatives on the skin and the sheets; the webbing and the blade take their face normal from them
        for (const k of ['body', 'web', 'cloth', 'blade'] as const) expect(built.find((b) => b.k === k)!.f, k).toMatch(DERIVATIVE);
      });

      it('the relief, the noise and the cells are functions written once and called, not pasted three times', () => {
        const f = built.find((b) => b.k === 'body')!.f;
        for (const fn of ['demonRelief', 'demonVoro', 'demonFbm']) {
          const defs = f.split('\n').filter((l) => new RegExp(B === WGSLNodeBuilder ? `^fn ${fn}\\b` : `^\\w+ ${fn}\\s*\\(`).test(l.trim()));
          expect(defs.length, fn).toBe(1);
        }
        expect(f.length).toBeLessThan(150000);
      });

      it('the last step of every material blacks out a colour that is not finite or too large', () => {
        for (const { k, f } of built) {
          // three writes a select as an if and an else that fill a variable: `if (dot(c, c) < 1e8) v = c; else v = vec3(0);  demonSafe = v;`
          const block = before(f, /^\s*demonSafe = (\w+);/);
          expect(block, k).toMatch(/if \( \( dot\( (\w+), \1 \) < 100000000\.0 \) \) \{\s*(\w+) = \1;\s*\} else \{\s*\2 = vec3(<f32>)?\( 0\.0, 0\.0, 0\.0 \);\s*\}\s*demonSafe = \2;$/);
          // and nothing but the sight and the alpha comes after it
          const rest = f.slice(f.indexOf(block) + block.length);
          expect(rest, k).not.toMatch(/demonShown|lightAmbient/);
        }
      });

      it('a stone demon does not glow: the glow\'s factor is 0 by the tint\'s stone flag', () => {
        for (const { k, f } of built) {
          const block = before(f, /^\s*demonGlow = (\w+);/);
          // the stone flag is the tint's fourth float (`packLook`), the one the albedo's grey reads too
          expect(block, k).toMatch(/(\w+) = \( (?:object\.)?(\w+)\.w > 0\.5 \);\s*if \( \1 \) \{\s*(\w+) = 0\.0;\s*\} else \{\s*\3 = 1\.0;\s*\}\s*demonGlow = \3;$/);
          // every glow goes through it: the one sum of the emissive colours is multiplied by it
          expect(f.split('\n').filter((l) => /\* vec3(<f32>)?\( demonGlow \)/.test(l)).length, k).toBe(1);
        }
      });

      it('the webbing is pleated in the vertex stage; the other parts are not', () => {
        for (const { k, v } of built) expect(/demonPleat/.test(v), k).toBe(k === 'web');
      });
    });
  }
});

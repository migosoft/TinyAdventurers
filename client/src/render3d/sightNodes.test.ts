import { describe, expect, it } from 'vitest';
import { GLSLNodeBuilder, MeshBasicNodeMaterial, WGSLNodeBuilder } from 'three/webgpu';
import { positionWorld, vec3, vec4 } from 'three/tsl';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import { makeSight, SIGHT_OFF } from './sightNodes';
import { SightMask } from './sightmask';
import { fragment, type Builder } from './shaderCode.testutil';

describe('the sight nodes', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: a material ending in the sight step builds`, () => {
      const sight = makeSight();
      const m = new MeshBasicNodeMaterial();
      m.colorNode = sight.apply(vec3(1), positionWorld, sight.unseenAt(positionWorld.xz));
      const code = fragment(B, m);
      expect(code).toContain('sightMode');
      expect(code).toContain('sightOrigin');
      // The mask's texture node is named `sightMask`, but three does not write a texture's name into the code: its sampler is `nodeUniformN`.
      expect(code).toMatch(B === WGSLNodeBuilder ? /texture_2d<f32>/ : /uniform sampler2D/);
      sight.dispose();
    });
  }

  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the mask is sampled once, outside any if, for apply and shown together`, () => {
      const sight = makeSight();
      const m = new MeshBasicNodeMaterial();
      const u = sight.unseenAt(positionWorld.xz);
      m.colorNode = vec4(sight.apply(vec3(1), positionWorld, u), sight.shown(u.x, 0));
      const code = fragment(B, m);
      const call = B === WGSLNodeBuilder ? /textureSample\(/g : /texture\(/g;
      const hits = [...code.matchAll(call)];
      expect(hits).toHaveLength(1);
      // Top level of main(): every block opened since main began (three's own uniform flipY if/else) is closed again.
      const main = code.slice(0, hits[0].index);
      const since = main.slice(Math.max(main.lastIndexOf('void main'), main.lastIndexOf('fn main')));
      expect((since.match(/\{/g) ?? []).length - 1).toBe((since.match(/\}/g) ?? []).length);
    });
  }

  it('uploads on the first frame of a new view', () => {
    const map = new TileMap(21, 21, new Uint8Array(21 * 21).fill(TILE_ID.Floor));
    const hard = new View(21, 21);
    hard.compute(map, 10.5 * TILE, 10.5 * TILE, 6, 'hard');
    const mask = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });
    mask.update(hard, null, 0);
    const frame = { ...SIGHT_OFF, mode: 'dark' as const, mask };
    const a = makeSight(), b = makeSight();
    a.set(frame);
    b.set(frame);
    expect([a.uploads, b.uploads]).toEqual([1, 1]);
    a.set(frame);
    expect(a.uploads).toBe(1); // the same data and version: no second upload
    mask.update(hard, null, 1);
    a.set(frame);
    expect(a.uploads).toBe(2);
    a.dispose();
    b.dispose();
  });

  it('a mask of a new size gives the node a new texture and the origin follows', () => {
    const small = new TileMap(21, 21, new Uint8Array(21 * 21).fill(TILE_ID.Floor));
    const big = new TileMap(41, 41, new Uint8Array(41 * 41).fill(TILE_ID.Floor));
    const mk = (map: TileMap, c: number, vision: number) => {
      const v = new View(map.w, map.h);
      v.compute(map, c * TILE, c * TILE, vision, 'hard');
      const m = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });
      m.update(v, null, 0);
      return m;
    };
    const a = mk(small, 10.5, 4), b = mk(big, 20.5, 9);
    expect(b.n).not.toBe(a.n);
    const s = makeSight();
    s.set({ ...SIGHT_OFF, mode: 'dark', mask: a });
    const t1 = s.texture;
    expect((t1.image as { width: number }).width).toBe(a.n);
    s.set({ ...SIGHT_OFF, mode: 'dark', mask: b });
    expect(s.texture).not.toBe(t1);
    expect((s.texture.image as { width: number }).width).toBe(b.n);
    expect(s.uploads).toBe(2);
    s.dispose();
  });
});

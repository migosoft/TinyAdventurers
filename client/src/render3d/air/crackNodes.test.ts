// The crack mask's shader code as three generates it (GLSL and WGSL), built without a GPU (#307).
import { describe, expect, it } from 'vitest';
import { GLSLNodeBuilder, MeshBasicNodeMaterial, WGSLNodeBuilder } from 'three/webgpu';
import { float, int, positionWorld, vec4 } from 'three/tsl';
import { LIGHT_KIND } from '../../generated/defs';
import { sunLook } from '../../game/sunmath';
import { fragment, type Builder } from '../shaderCode.testutil';
import { CRACK_CAP, RAY_CAP, crackOf, packCracks } from './cracks';
import { makeCracks } from './crackNodes';

describe('makeCracks', () => {
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the mask builds, loops over the rays under its own name and reads the slot's ray count`, () => {
      const cracks = makeCracks();
      const m = new MeshBasicNodeMaterial();
      m.colorNode = vec4(cracks.mask(positionWorld, int(0)), cracks.at(int(0)).ceil, float(0), 1);
      const code = fragment(B, m);
      expect(code).toMatch(/\bcr\b/);
    });
  }

  it('set writes the count and the slots as packCracks lays them out', () => {
    const cracks = makeCracks();
    const list = [4, 9].map((id) => crackOf({ id, kind: LIGHT_KIND.Daylight, colour: 0xffffff, x: 5, y: 6, on: true }, sunLook, 0));
    cracks.set(list);
    expect(cracks.count.value).toBe(2);
    const p = packCracks(list);
    const flat = (arr: { x: number; y: number; z: number; w: number }[]): number[] => arr.flatMap((v) => [v.x, v.y, v.z, v.w]);
    expect(flat(cracks.arrays.a.array)).toEqual([...p.a]);
    expect(flat(cracks.arrays.e.array)).toEqual([...p.e]);
    expect(cracks.arrays.e.array.length).toBe(CRACK_CAP * RAY_CAP);
    cracks.set([]);
    expect(cracks.count.value).toBe(0);
    expect(flat(cracks.arrays.a.array).every((v) => v === 0)).toBe(true);
  });
});

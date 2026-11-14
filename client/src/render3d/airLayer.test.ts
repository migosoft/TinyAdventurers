import { describe, expect, it } from 'vitest';
import { BufferGeometry, Mesh } from 'three/webgpu';
import { AIR_SKIP_LAYER, skipInAirPrepass } from './view';

describe('the air layer', () => {
  it('is layer 1', () => {
    expect(AIR_SKIP_LAYER).toBe(1);
  });

  it('moves a mesh to the skip layer only, so the depth pre-pass camera (layer 0) does not draw it', () => {
    const m = new Mesh(new BufferGeometry());
    expect(m.layers.isEnabled(0)).toBe(true);
    skipInAirPrepass(m);
    expect(m.layers.isEnabled(AIR_SKIP_LAYER)).toBe(true);
    expect(m.layers.isEnabled(0)).toBe(false);
  });
});

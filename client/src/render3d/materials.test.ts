import { describe, expect, it } from 'vitest';
import { Texture } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import type { Lighting } from './lightNodes';
import { cardMaterial, viewTowardUniform } from './materials';

const lighting = { lightAt: () => vec3(1, 1, 1), shoulder: (c: unknown) => c } as unknown as Lighting;
const make = (opts: { flat?: boolean; translucent?: boolean }) => cardMaterial(new Texture(), 64, 64, lighting, viewTowardUniform(), opts).material;

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
});

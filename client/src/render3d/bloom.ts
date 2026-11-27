// The bloom of the 3D view's present step (#442): only a pixel that puts out more than full white (a colour above 1, painted by the
// demon's glow) bleeds light round itself. Three's `BloomNode` makes the glow (a bright pass, five half-resolution blurs, a mix by radius);
// the present step adds it to the sharp picture and presses a colour above 1 back by its largest channel, so the hue stays.
import { Fn, luminance, max, mix, select, smoothstep, vec3, vec4 } from 'three/tsl';
import type { Node, TextureNode } from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/** The settings of the look spike's page. */
export const BLOOM = { strength: 0.4, radius: 0.4, threshold: 1.0 } as const;

/** A channel above this (or not a number) counts as black in the bright pass: a broken pixel must not spread through the blur. */
export const BRIGHT_LIMIT = 64;

/** A colour pressed into 0..1 by its largest channel when that is above 1: the hue stays. */
export const pressed = (c: Node<'vec3'>): Node<'vec3'> => c.div(max(1, max(c.r, max(c.g, c.b))));

/** `pressed` in plain numbers. */
export function pressedJs(c: readonly [number, number, number]): [number, number, number] {
  const m = Math.max(1, ...c);
  return [c[0] / m, c[1] / m, c[2] / m];
}

/** The bright pass: what is above the threshold goes on, the rest is black; a non-finite or absurdly large colour counts as black (a NaN compares false). */
const brightPass = Fn(({ input, threshold, smoothWidth }: { input: Node<'vec4'>; threshold: Node<'float'>; smoothWidth: Node<'float'> }) => {
  const c = input.rgb;
  const ok = c.r.lessThan(BRIGHT_LIMIT).and(c.g.lessThan(BRIGHT_LIMIT)).and(c.b.lessThan(BRIGHT_LIMIT));
  const safe = select(ok, input, vec4(vec3(0), 0));
  const v = luminance(select(ok, c, vec3(0)));
  return mix(vec4(0), safe, smoothstep(threshold, threshold.add(smoothWidth), v));
});

/** The present step's colour: the sharp picture with the bloom of `bloomInput` (the half-float picture) added, then pressed. */
export function bloomPresent(sharp: Node<'vec4'>, bloomInput: TextureNode): { node: Node<'vec4'>; bloom: ReturnType<typeof bloom> } {
  const b = bloom(bloomInput, BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  b.highPassFn = brightPass;
  // three 0.187's types say `getTexture`, the code has `getTextureNode`.
  const glow = (b as unknown as { getTextureNode(): TextureNode }).getTextureNode();
  return { node: vec4(pressed(sharp.rgb.add(glow.rgb)), sharp.a), bloom: b };
}

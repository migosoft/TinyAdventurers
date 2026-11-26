// The demon's glow (#379): its numbers and the pulse, pure (the material in nodes.ts and the figure's chest light both read them).

/**
 * `dark`: a pulsing crack at the wave's trough (the spike's darkest; its brightest is 1). `wave`: builder units of height from crest
 * to crest. `period`: seconds from crest to crest at one place. `cut`, `hot`: the ranges of the picture's alpha, which is a class
 * (a filtered texel falls in between): below `cut` a hole, from `hot[0]` up to `hot[1]` more and more of a glow.
 */
export const DEMON_GLOW = { dark: 0.06, wave: 22, period: 4, cut: 0.2, hot: [100 / 255, 1] } as const;

/** How bright a pulsing crack is at `phase` 0..1 of the pulse and `y` builder units up the body, before the gain: the shader's own formula. */
export function glowAt(phase: number, y: number): number {
  const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (phase - y / DEMON_GLOW.wave));
  return DEMON_GLOW.dark + (1 - DEMON_GLOW.dark) * wave;
}

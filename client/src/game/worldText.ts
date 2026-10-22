// Sizes and styles of every text drawn in the world (Phaser), in world px.
// At the 1280 x 720 smoke size the camera zoom is 2, so 6.5 world px is about 13 screen px.
export const WORLD_TEXT = {
  tag: { size: 6.5, style: "600" },
  number: { size: 7, style: "800" },
  crit: { size: 9, style: "800", color: "#ffd24a" },
  /** The sleep Z and the fear / mimic "!". */
  mark: { size: 7, style: "800" },
  sound: { size: 6, style: "italic 600" },
  /** "+N coins", "immune", "IMMUNE". */
  small: { size: 6, style: "600" },
} as const;

export type WorldTextKind = keyof typeof WORLD_TEXT;

/** Text texture resolution: at least the camera zoom (2 at 1280 x 720, 4 at 2560 x 1440, 6 at 3840 x 2160; larger zooms upscale a little), so text is never upscaled. */
export const TEXT_RESOLUTION = 4;

const POP_FROM = 1.4;
const POP_TIME = 0.12;

/** A crit shows its number only. */
export function critLabel(v: number): string {
  return `${Math.round(v)}`;
}

/** The crit number's pop: 1.4 at age 0, easing to 1 by 0.12 s, then 1. */
export function popScale(age: number): number {
  if (age >= POP_TIME) return 1;
  const k = Math.max(0, age) / POP_TIME;
  return POP_FROM - (POP_FROM - 1) * (1 - (1 - k) * (1 - k));
}

/**
 * The game runs pixelArt (NEAREST), which turns Inter into a jagged mess. A Text re-uploads its canvas
 * on every change and that resets the filter, so LINEAR is set again after each update. (1 = FilterMode.LINEAR.)
 */
export function smoothText<T extends { updateText?: () => unknown; texture?: { setFilter?: (f: number) => unknown } }>(t: T): T {
  const update = t.updateText?.bind(t);
  if (!update || !t.texture?.setFilter) return t; // a test double
  t.updateText = () => {
    const r = update();
    t.texture?.setFilter?.(1);
    return r;
  };
  t.texture.setFilter(1);
  return t;
}

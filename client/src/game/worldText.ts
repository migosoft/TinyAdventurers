// Sizes and styles of every text drawn in the world, in world px.
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

/** The sleeper's Z: one every `Z_EVERY` s, each living `Z_LIFE` s and rising `Z_RISE` px. */
export const Z_EVERY = 0.6;
export const Z_LIFE = 1.2;
export const Z_RISE = 10;

/** The charm heart's pink. */
export const CHARM_COLOR = '#ff80c0';

/** A floating number: rise speed (px/s, up is negative), life (s), the speed's decay per update and the sideways spread (px) at birth; crits rise faster and live longer. */
export const FLOAT = { vy: -26, life: 0.7, critVy: -34, critLife: 0.9, drag: 0.92, spread: 6 } as const;

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

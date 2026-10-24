// Pure helpers behind the mood layer (dust, clouds, smoke, embers, drips): counts, spawn rates, tints.

/** Opacity of the light-coloured dust motes. */
export const DUST_ALPHA = 0.55;
/** Most dust clouds at once. */
export const MAX_CLOUDS = 24;
/** Most smoke puffs at once. */
export const MAX_SMOKE = 200;
/** Most embers at once. */
export const MAX_EMBERS = 160;
/** Most water drips at once. */
export const MAX_DRIPS = 12;
/** Seconds between smoke puffs per lava tile. */
export const LAVA_SMOKE_EVERY = 4.2;
/** Seconds between embers per lava tile. */
export const LAVA_EMBER_EVERY = 1.08;
/** Seconds between drips per water tile. */
export const DRIP_EVERY = 7;

/** Number of dust clouds for a world of `worldW` x `worldH` px: 7 per 240 tiles, clamped to 4..24. */
export function cloudCount(worldW: number, worldH: number): number {
  const n = Math.round((7 * ((worldW / 16) * (worldH / 16))) / 240);
  return Math.min(MAX_CLOUDS, Math.max(4, n));
}

/** Accumulates `dt * n / every` spawns on top of `acc`; returns the whole spawns due and the remainder. */
export function spawnCount(acc: number, dt: number, n: number, every: number): [count: number, acc: number] {
  if (n <= 0 || !Number.isFinite(every) || every <= 0) return [0, 0];
  const total = acc + (dt * n) / every;
  const count = Math.floor(total);
  return [count, total - count];
}

/**
 * Brightness (0..1, from the brightest channel) and colour (0xRRGGBB) of a light sample: the hue, scaled so its brightest
 * channel is 255 (the sum of lights is not clamped), blended halfway to white.
 */
export function dustTint(r: number, g: number, b: number): [brightness: number, colour: number] {
  const m = Math.max(r, g, b, 1);
  const ch = (c: number) => Math.round((255 * m + 255 * Math.max(0, c)) / (2 * m));
  return [Math.min(1, Math.max(r, g, b) / 255), (ch(r) << 16) | (ch(g) << 8) | ch(b)];
}

/** Reports each key once while it stays present: a blast bursts once while it shows. */
export class BurstOnce {
  private seen = new Set<string>();

  /** The keys not present in the previous call. */
  fresh(keys: string[]): string[] {
    const out = keys.filter((k) => !this.seen.has(k));
    this.seen = new Set(keys);
    return out;
  }
}

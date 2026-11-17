/** How far one animal may differ from the next: its size, the tone of its coat and the scale of its antlers (a model with `varies`). */
export const VARY = { size: [0.94, 1.06], tone: [0.9, 1.1], crest: [0.8, 1.2] } as const;

/** A 32-bit integer mix (a murmur3 finaliser) of the id and a salt, as a number in [0, 1]. */
function unit(id: number, salt: number): number {
  let h = (id | 0) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

const between = (r: readonly [number, number], u: number): number => r[0] + (r[1] - r[0]) * u;

/** The same three numbers for an entity id on every client: an integer hash, no state. Any integer id (negative ones too) stays inside `VARY`. */
export function variationOf(id: number): { size: number; tone: number; crest: number } {
  return {
    size: between(VARY.size, unit(id, 0x9e3779b9)),
    tone: between(VARY.tone, unit(id, 0x7f4a7c15)),
    crest: between(VARY.crest, unit(id, 0x2545f491)),
  };
}

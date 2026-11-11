/** True when the effect `kind` is set in the bitmask `bits` (bit = 1 << EffectKind id). */
export function has(bits: number, kind: number): boolean {
  return (bits & (1 << kind)) !== 0;
}

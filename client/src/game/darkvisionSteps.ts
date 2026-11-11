// The debug darkvision steps, apart from lightview.ts so the run session can use them without reaching Phaser.

/** The debug darkvision steps (F4, and V in ?lights): the next one above `current`, after 1 back to 0. */
export function nextDarkvision(current: number): number {
  return current < 0.5 - 1e-6 ? 0.5 : current < 1 - 1e-6 ? 1 : 0;
}

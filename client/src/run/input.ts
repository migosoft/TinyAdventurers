// One step of the own hero's input, as the run session consumes it, and the
// eight-way direction helper both views and the session share.

export interface StepInput {
  mx: -1 | 0 | 1;
  my: -1 | 0 | 1;
  primary: boolean;
  secondary: boolean;
  act: boolean;
  /** Any movement key is down, also when two cancel out (A+D): the own hero then still plays the walk animation. */
  held: boolean;
}

export const NO_INPUT: StepInput = { mx: 0, my: 0, primary: false, secondary: false, act: false, held: false };

const MX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
const MY = [0, 1, 1, 1, 0, -1, -1, -1] as const;

/** The nearest of the eight wire directions to (x, y); (0, 0) below a length of 1e-6. */
export function dir8(x: number, y: number): { mx: -1 | 0 | 1; my: -1 | 0 | 1 } {
  if (Math.hypot(x, y) < 1e-6) return { mx: 0, my: 0 };
  const k = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  const q = ((k % 8) + 8) % 8;
  return { mx: MX[q], my: MY[q] };
}

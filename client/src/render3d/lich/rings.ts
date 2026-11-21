// The lich's robe rings (#358): the spike's control rings and their spline, shared by the builder (shape.ts) and the cloth (cloth.ts).

/** Catmull-Rom through rows of numbers, `subdiv` samples per span. */
function spline(ctrl: number[][], subdiv: number): number[][] {
  const out: number[][] = [], n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const a = ctrl[Math.max(0, i - 1)], b = ctrl[i], c = ctrl[i + 1], d = ctrl[Math.min(n - 1, i + 2)];
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      out.push(b.map((_, k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t * t * t)));
    }
  }
  out.push(ctrl[n - 1].slice());
  return out;
}

/** From the neck to the hem's edge on the floor: [y, half width, half depth, fold depth, how much it lags (0: with the body, 1: the hem)]. */
const ROBE = [
  [16.9, 0.8, 0.75, 0, 0], [16.55, 1.75, 1.0, 0, 0], [16.0, 2.55, 1.25, 0, 0], [14.6, 2.25, 1.3, 0.012, 0.02], [12.4, 1.7, 1.15, 0.03, 0.06], [9.5, 1.85, 1.4, 0.06, 0.15],
  [6.0, 2.3, 1.9, 0.09, 0.3], [3.0, 2.8, 2.5, 0.12, 0.5], [1.0, 3.4, 3.2, 0.14, 0.7], [0.28, 4.1, 4.0, 0.16, 0.86], [0.12, 5.0, 5.0, 0.2, 1.0], [0.07, 5.8, 5.9, 0.26, 1.0],
];
/** [y, half width, half depth, fold depth, lag 0..1] per ring, neck to hem: the spike's `RINGS`. */
export const ROBE_RINGS: readonly (readonly number[])[] = spline(ROBE, 3);

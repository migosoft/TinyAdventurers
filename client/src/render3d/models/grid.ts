// The grid the 3D figure models are shaped on (#338): a sprite's side view blown up by U cells per sprite pixel, with a
// margin of PAD cells. Pure numbers (no canvas, no three.js), so it runs in a Web Worker and under node.

export const FW = 16, FH = 28, U = 6, PAD = U, GW = FW * U + 2 * PAD, GH = FH * U + 2 * PAD, PS = 6;

/** A box blur of radius `r`, two rounds of rows and columns, in place; the edge cells repeat. Returns `a`. */
export function blur(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const t = new Float32Array(a.length), n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += a[y * w + Math.min(w - 1, Math.max(0, x + d))];
      t[y * w + x] = s / n;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += t[Math.min(h - 1, Math.max(0, y + d)) * w + x];
      a[y * w + x] = s / n;
    }
  }
  return a;
}

/** The blurred coverage of the sprite pixels in rows `rowFrom` to `rowTo` (inclusive) on the grid. */
export function field(alpha: Uint8Array, rowFrom: number, rowTo: number): Float32Array {
  const m = new Float32Array(GW * GH);
  for (let Y = 0; Y < GH; Y++) for (let X = 0; X < GW; X++) {
    const x = Math.floor((X - PAD) / U), y = Math.floor((Y - PAD) / U);
    if (x >= 0 && y >= rowFrom && x < FW && y <= rowTo && alpha[y * FW + x]) m[Y * GW + X] = 1;
  }
  return blur(m, GW, GH, Math.round(U * 0.5));
}

/**
 * Half thickness per cell, and where along the sprite's row each cell takes its colour. Every row is turned like on a lathe
 * (as deep as it is wide); a Poisson inflation (a disc becomes a ball) caps it, which rounds the top and keeps thin parts thin.
 * The row's pixels are laid once around the half body, the front pixel on the front and the back pixel on the back.
 */
export function inflate(inside: Uint8Array): { hgt: Float32Array; tu: Float32Array } {
  const u = new Float32Array(GW * GH), tu = new Float32Array(GW * GH), g = 4 / (U * U), om = 1.9;
  for (let it = 0; it < 200; it++) for (let Y = 1; Y < GH - 1; Y++) for (let X = 1; X < GW - 1; X++) {
    const i = Y * GW + X;
    if (inside[i]) u[i] += om * ((u[i - 1] + u[i + 1] + u[i - GW] + u[i + GW] + g) / 4 - u[i]);
  }
  for (let i = 0; i < u.length; i++) u[i] = 2 * Math.sqrt(Math.max(0, u[i]));
  for (let Y = 1; Y < GH - 1; Y++) {
    let a = -1;
    for (let X = 1; X < GW; X++) {
      const on = X < GW - 1 && inside[Y * GW + X];
      if (on && a < 0) a = X;
      if (!on && a >= 0) {
        const rc = (X - a) / 2, c = a + rc - 0.5;
        for (let k = a; k < X; k++) {
          const q = Math.max(-1, Math.min(1, (k - c) / rc)), l = rc / U * Math.sqrt(1 - q * q);
          if (l < u[Y * GW + k]) u[Y * GW + k] = l;
          tu[Y * GW + k] = 1 - Math.acos(q) / Math.PI;
        }
        a = -1;
      }
    }
  }
  blur(u, GW, GH, 2);
  for (let i = 0; i < u.length; i++) if (!inside[i]) u[i] = 0;
  return { hgt: u, tu };
}

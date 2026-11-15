// The triangle list of one frame's effects (#308): gathered into reused typed arrays, sorted far to near, then appended to the view's
// effect buffer (`FxBuf`, the figures' own pass). Scalars only: nothing is allocated per triangle.
import { viewRay, type Cam } from '../camera';
import type { FxBuf } from '../models/fx';

/** A triangle whose three alphas are all at or below this draws nothing. */
const INVISIBLE = 0.004;
const START = 256;

export class FxTris {
  /** Triangles kept. */
  n = 0;
  /** Triangles refused because the list was full. */
  dropped = 0;
  private pos = new Float32Array(START * 9);
  private col = new Float32Array(START * 12);
  private key = new Float32Array(START);
  private order: number[] = [];
  private cap_: number;

  constructor(cap: number) {
    this.cap_ = cap;
  }

  clear(): void {
    this.n = 0;
    this.dropped = 0;
  }

  /** Room for one more triangle; false (and counted) when `cap` is reached. */
  private room(): boolean {
    if (this.n >= this.cap_) {
      this.dropped++;
      return false;
    }
    if (this.n * 9 >= this.pos.length) {
      const pos = new Float32Array(this.pos.length * 2), col = new Float32Array(this.col.length * 2);
      pos.set(this.pos); col.set(this.col);
      this.pos = pos; this.col = col;
    }
    return true;
  }

  private corners(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
    const p = this.pos, o = this.n * 9;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az; p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz; p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz;
    return this.n * 12;
  }

  /** A triangle of one colour; the alphas default to the first. */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    r: number, g: number, b: number, aa: number, ab = aa, ac = aa): void {
    if (aa <= INVISIBLE && ab <= INVISIBLE && ac <= INVISIBLE) return;
    if (!this.room()) return;
    const o = this.corners(ax, ay, az, bx, by, bz, cx, cy, cz), c = this.col;
    c[o] = r; c[o + 1] = g; c[o + 2] = b; c[o + 3] = aa;
    c[o + 4] = r; c[o + 5] = g; c[o + 6] = b; c[o + 7] = ab;
    c[o + 8] = r; c[o + 9] = g; c[o + 10] = b; c[o + 11] = ac;
    this.n++;
  }

  /** A triangle with a colour per corner. */
  tri3(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    ra: number, ga: number, ba: number, rb: number, gb: number, bb: number, rc: number, gc: number, bc: number,
    aa: number, ab: number, ac: number): void {
    if (aa <= INVISIBLE && ab <= INVISIBLE && ac <= INVISIBLE) return;
    if (!this.room()) return;
    const o = this.corners(ax, ay, az, bx, by, bz, cx, cy, cz), c = this.col;
    c[o] = ra; c[o + 1] = ga; c[o + 2] = ba; c[o + 3] = aa;
    c[o + 4] = rb; c[o + 5] = gb; c[o + 6] = bb; c[o + 7] = ab;
    c[o + 8] = rc; c[o + 9] = gc; c[o + 10] = bc; c[o + 11] = ac;
    this.n++;
  }

  /** Appends the triangles to `out`; far to near along the view ray (summed corners) when `sort`. */
  flush(out: FxBuf, cam: Cam, sort: boolean): void {
    const n = this.n, p = this.pos, c = this.col;
    const order = this.order;
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    if (sort) {
      if (this.key.length < n) this.key = new Float32Array(Math.max(n, this.key.length * 2));
      const ray = viewRay(cam.pitch, cam.yaw), key = this.key;
      for (let i = 0; i < n; i++) {
        const o = i * 9;
        key[i] = (p[o] + p[o + 3] + p[o + 6]) * ray[0] + (p[o + 1] + p[o + 4] + p[o + 7]) * ray[1] + (p[o + 2] + p[o + 5] + p[o + 8]) * ray[2];
      }
      order.sort((a, b) => key[a] - key[b]);
    }
    const pos = out.position, rgba = out.rgba;
    for (let k = 0; k < n; k++) {
      const i = order[k], o = i * 9, q = i * 12;
      for (let j = 0; j < 9; j++) pos.push(p[o + j]);
      for (let j = 0; j < 12; j++) rgba.push(c[q + j]);
    }
    out.n += n;
  }
}

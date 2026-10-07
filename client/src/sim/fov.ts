// Port of server/src/fov.rs (recursive shadowcasting), verified by fov.test.ts.
import { TileMap } from './map';

const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

export class Fov {
  private stamp: Uint32Array;
  private gen = 0;

  constructor(
    public w: number,
    public h: number,
  ) {
    this.stamp = new Uint32Array(w * h);
  }

  isVisible(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.stamp[y * this.w + x] === this.gen;
  }

  private mark(x: number, y: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.stamp[y * this.w + x] = this.gen;
  }

  compute(map: TileMap, cx: number, cy: number, radius: number): void {
    this.gen = (this.gen + 1) >>> 0 || 1;
    this.mark(cx, cy);
    for (let oct = 0; oct < 8; oct++) {
      this.cast(map, cx, cy, 1, 1.0, 0.0, radius, MULT[0][oct], MULT[1][oct], MULT[2][oct], MULT[3][oct]);
    }
  }

  private cast(
    map: TileMap,
    cx: number,
    cy: number,
    row: number,
    start: number,
    end: number,
    radius: number,
    xx: number,
    xy: number,
    yx: number,
    yy: number,
  ): void {
    if (start < end) return;
    const r2 = radius * radius;
    let newStart = 0;
    for (let j = row; j <= radius; j++) {
      let dx = -j - 1;
      const dy = -j;
      let blocked = false;
      while (dx <= 0) {
        dx += 1;
        const x = cx + dx * xx + dy * xy;
        const y = cy + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (start < rSlope) continue;
        else if (end > lSlope) break;
        if (dx * dx + dy * dy <= r2) this.mark(x, y);
        const opaque = map.solid(x, y);
        if (blocked) {
          if (opaque) {
            newStart = rSlope;
            continue;
          } else {
            blocked = false;
            start = newStart;
          }
        } else if (opaque && j < radius) {
          blocked = true;
          this.cast(map, cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy);
          newStart = rSlope;
        }
      }
      if (blocked) break;
    }
  }
}

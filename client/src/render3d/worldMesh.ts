import { heightAt, type DemoMap } from './demoMap';

/** Atlas frames by name, in atlas px. */
export type FrameRects = Record<string, { x: number; y: number; w: number; h: number }>;

export const KIND = { floor: 0, face: 1, top: 2 } as const;

/** Per vertex: position (tiles), uv (atlas px), normal, kind, rect (the atlas frame the uv lies in). 6 vertices per quad. */
export interface WorldArrays {
  position: Float32Array;
  uv: Float32Array;
  normal: Float32Array;
  kind: Float32Array;
  rect: Float32Array;
  count: number;
}

export function tileHash(x: number, z: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const FLOORS = ['floor_1', 'floor_1', 'floor_1', 'floor_2', 'floor_3', 'floor_4', 'floor_5', 'floor_6', 'floor_7', 'floor_8'];

type Corner = [x: number, y: number, z: number, u: number, v: number];
type Rect = { x: number; y: number; w: number; h: number };
const NO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export function buildWorld(m: DemoMap, frames: FrameRects): WorldArrays {
  const position: number[] = [], uv: number[] = [], normal: number[] = [], kind: number[] = [], rect: number[] = [];
  const frame = (name: string): Rect => {
    const r = frames[name];
    if (!r) throw new Error(`atlas frame missing: ${name}`);
    return r;
  };

  // c0..c3 run top-left, top-right, bottom-right, bottom-left as seen from the normal's side.
  // Whatever that order, the triangles are wound counter-clockwise seen from the normal.
  const quad = (c: [Corner, Corner, Corner, Corner], n: [number, number, number], k: number, r: Rect) => {
    const [a, b, d] = [c[0], c[1], c[2]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const dot = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
    const order = dot > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) {
      const p = c[i];
      position.push(p[0], p[1], p[2]);
      uv.push(p[3], p[4]);
      normal.push(n[0], n[1], n[2]);
      kind.push(k);
      rect.push(r.x, r.y, r.w, r.h);
    }
  };

  /** Faces of a wall cell on one side, one quad per tile of height; (ax,az) is the left edge end seen from outside. */
  const side = (h: number, hn: number, ax: number, az: number, bx: number, bz: number, n: [number, number, number], pick: (k: number) => string) => {
    for (let k = Math.floor(hn); k < h; k++) {
      const lo = Math.max(hn, k), hi = Math.min(h, k + 1);
      if (hi <= lo) continue;
      const r = frame(pick(k));
      const vt = r.y + (k + 1 - hi) * 16, vb = r.y + (k + 1 - lo) * 16;
      quad([[ax, hi, az, r.x, vt], [bx, hi, bz, r.x + 16, vt], [bx, lo, bz, r.x + 16, vb], [ax, lo, az, r.x, vb]], n, KIND.face, r);
    }
  };

  for (let z = 0; z < m.h; z++) for (let x = 0; x < m.w; x++) {
    const h = heightAt(m, x, z);
    if (h === 0) {
      const r = frame(FLOORS[Math.floor(tileHash(x, z) * FLOORS.length)]);
      quad([[x, 0, z, r.x, r.y], [x + 1, 0, z, r.x + 16, r.y], [x + 1, 0, z + 1, r.x + 16, r.y + 16], [x, 0, z + 1, r.x, r.y + 16]], [0, 1, 0], KIND.floor, r);
      continue;
    }
    quad([[x, h, z, 0, 0], [x + 1, h, z, 0, 0], [x + 1, h, z + 1, 0, 0], [x, h, z + 1, 0, 0]], [0, 1, 0], KIND.top, NO_RECT);

    const hs = heightAt(m, x, z + 1);
    side(h, hs, x, z + 1, x + 1, z + 1, [0, 0, 1], (k) => {
      if (k === 0 && hs === 0) {
        const q = tileHash(x + 91, z + 17);
        return q < 0.07 ? 'wall_hole_1' : q < 0.13 ? 'wall_hole_2' : q < 0.17 ? 'wall_goo' : 'wall_mid';
      }
      if (k === 1 && z === 1 && (x === 9 || x === 15)) return x === 9 ? 'wall_banner_red' : 'wall_banner_blue';
      return 'wall_mid';
    });
    const mid = () => 'wall_mid';
    side(h, heightAt(m, x, z - 1), x + 1, z, x, z, [0, 0, -1], mid);
    side(h, heightAt(m, x + 1, z), x + 1, z + 1, x + 1, z, [1, 0, 0], mid);
    side(h, heightAt(m, x - 1, z), x, z, x, z + 1, [-1, 0, 0], mid);
  }

  return {
    position: new Float32Array(position),
    uv: new Float32Array(uv),
    normal: new Float32Array(normal),
    kind: new Float32Array(kind),
    rect: new Float32Array(rect),
    count: kind.length,
  };
}

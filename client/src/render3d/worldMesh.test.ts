import { describe, expect, it } from 'vitest';
import { MAP_ROWS, parseMap } from './demoMap';
import { WALL_H } from './heights';
import { KIND, buildWorld, tileHash, type FrameRects } from './worldMesh';

const NAMES = [
  'floor_1', 'floor_2', 'floor_3', 'floor_4', 'floor_5', 'floor_6', 'floor_7', 'floor_8',
  'wall_mid', 'wall_hole_1', 'wall_hole_2', 'wall_goo', 'wall_banner_red', 'wall_banner_blue',
];
const frames: FrameRects = {};
NAMES.forEach((n, i) => { frames[n] = { x: 100 + i * 16, y: 200 + i * 32, w: 16, h: 16 }; });

/** Quad q covers vertices 6q..6q+5. */
function quads(w: ReturnType<typeof buildWorld>) {
  const out: { kind: number; q: number }[] = [];
  for (let q = 0; q < w.count / 6; q++) out.push({ kind: w.kind[q * 6], q });
  return out;
}

describe('buildWorld', () => {
  it('builds the single-wall map', () => {
    const w = buildWorld(parseMap(['...', '.#.', '...']), frames);
    expect(w.count).toBe(17 * 6);
    const qs = quads(w);
    expect(qs.filter((q) => q.kind === KIND.floor).length).toBe(8);
    expect(qs.filter((q) => q.kind === KIND.top).length).toBe(1);
    expect(qs.filter((q) => q.kind === KIND.face).length).toBe(8);
    expect(w.position.length).toBe(w.count * 3);
    expect(w.uv.length).toBe(w.count * 2);
    expect(w.normal.length).toBe(w.count * 3);
    expect(w.kind.length).toBe(w.count);
    expect(w.rect.length).toBe(w.count * 4);
  });

  it('gives each side two faces with the normal toward that side', () => {
    const w = buildWorld(parseMap(['...', '.#.', '...']), frames);
    const counts = new Map<string, number>();
    for (const { kind, q } of quads(w)) {
      if (kind !== KIND.face) continue;
      const i = q * 6;
      const key = [w.normal[i * 3], w.normal[i * 3 + 1], w.normal[i * 3 + 2]].join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const key of ['0,0,-1', '0,0,1', '1,0,0', '-1,0,0']) expect(counts.get(key), key).toBe(2);
  });

  it('spans 16 px in v per tile of height, upright (top vertices get the frame top row)', () => {
    const w = buildWorld(parseMap(['...', '.#.', '...']), frames);
    for (const { kind, q } of quads(w)) {
      if (kind !== KIND.face) continue;
      let top = Infinity, bottom = -Infinity;
      let yTop = -Infinity, yBottom = Infinity;
      for (let i = q * 6; i < q * 6 + 6; i++) {
        const y = w.position[i * 3 + 1];
        if (y > yTop) yTop = y;
        if (y < yBottom) yBottom = y;
      }
      for (let i = q * 6; i < q * 6 + 6; i++) {
        const y = w.position[i * 3 + 1], v = w.uv[i * 2 + 1];
        const ry = w.rect[i * 4 + 1], rh = w.rect[i * 4 + 3];
        if (y === yTop) { expect(v).toBe(ry); top = v; }
        else { expect(v).toBe(ry + rh); bottom = v; }
      }
      expect(bottom - top).toBe(16);
      expect(yTop - yBottom).toBe(1);
    }
  });

  it('maps the floor frame top row to the north edge', () => {
    const w = buildWorld(parseMap(['...', '.#.', '...']), frames);
    for (const { kind, q } of quads(w)) {
      if (kind !== KIND.floor) continue;
      let zMin = Infinity;
      for (let i = q * 6; i < q * 6 + 6; i++) zMin = Math.min(zMin, w.position[i * 3 + 2]);
      for (let i = q * 6; i < q * 6 + 6; i++) {
        const north = w.position[i * 3 + 2] === zMin;
        expect(w.uv[i * 2 + 1]).toBe(north ? w.rect[i * 4 + 1] : w.rect[i * 4 + 1] + w.rect[i * 4 + 3]);
      }
    }
  });

  it('counts only tops on a solid map (the edge is wall)', () => {
    const w = buildWorld(parseMap(['###', '###', '###']), frames);
    expect(w.count).toBe(9 * 6);
    for (const { kind } of quads(w)) expect(kind).toBe(KIND.top);
  });

  it('puts tops at wall height with uv and rect 0', () => {
    const w = buildWorld(parseMap(['...', '.#.', '...']), frames);
    for (const { kind, q } of quads(w)) {
      if (kind !== KIND.top) continue;
      for (let i = q * 6; i < q * 6 + 6; i++) {
        expect(w.position[i * 3 + 1]).toBe(WALL_H);
        expect([w.uv[i * 2], w.uv[i * 2 + 1]]).toEqual([0, 0]);
        expect([w.rect[i * 4], w.rect[i * 4 + 1], w.rect[i * 4 + 2], w.rect[i * 4 + 3]]).toEqual([0, 0, 0, 0]);
        expect([w.normal[i * 3], w.normal[i * 3 + 1], w.normal[i * 3 + 2]]).toEqual([0, 1, 0]);
      }
    }
  });

  it('keeps every uv inside its rect (floors and faces) on the real map', () => {
    const w = buildWorld(parseMap(MAP_ROWS), frames);
    for (let i = 0; i < w.count; i++) {
      if (w.kind[i] === KIND.top) continue;
      const [rx, ry, rw, rh] = [w.rect[i * 4], w.rect[i * 4 + 1], w.rect[i * 4 + 2], w.rect[i * 4 + 3]];
      const u = w.uv[i * 2], v = w.uv[i * 2 + 1];
      expect(u >= rx && u <= rx + rw && v >= ry && v <= ry + rh).toBe(true);
    }
  });

  it('winds every triangle counter-clockwise seen from its normal side', () => {
    const w = buildWorld(parseMap(MAP_ROWS), frames);
    const p = (i: number) => [w.position[i * 3], w.position[i * 3 + 1], w.position[i * 3 + 2]];
    for (let t = 0; t < w.count / 3; t++) {
      const [a, b, c] = [p(t * 3), p(t * 3 + 1), p(t * 3 + 2)];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = t * 3;
      const dot = cr[0] * w.normal[n * 3] + cr[1] * w.normal[n * 3 + 1] + cr[2] * w.normal[n * 3 + 2];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('uses the banner frames on the south faces of cells (9, 1) and (15, 1)', () => {
    const w = buildWorld(parseMap(MAP_ROWS), frames);
    const found = new Map<number, number>();
    for (let i = 0; i < w.count; i += 6) {
      if (w.kind[i] !== KIND.face || w.normal[i * 3 + 2] !== 1) continue;
      for (const [cx, name] of [[9, 'wall_banner_red'], [15, 'wall_banner_blue']] as const) {
        const f = frames[name];
        if (w.rect[i * 4] === f.x && w.rect[i * 4 + 1] === f.y && w.position[i * 3 + 2] === 2) {
          const x0 = Math.min(w.position[i * 3], w.position[(i + 1) * 3], w.position[(i + 2) * 3]);
          if (x0 === cx) found.set(cx, (found.get(cx) ?? 0) + 1);
        }
      }
    }
    expect(found.get(9)).toBe(1);
    expect(found.get(15)).toBe(1);
  });
});

describe('tileHash', () => {
  it('is deterministic and within [0, 1)', () => {
    expect(tileHash(3, 4)).toBe(tileHash(3, 4));
    for (let z = -5; z < 40; z++) for (let x = -5; x < 40; x++) {
      const h = tileHash(x, z);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

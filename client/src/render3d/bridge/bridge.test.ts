import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, DataTexture, GLSLNodeBuilder, Texture, WGSLNodeBuilder } from 'three/webgpu';
import { TileMap } from '../../sim/map';
import { makeLighting } from '../lightNodes';
import { DECK_Y, pondFieldOf, type Deck, type PondField } from '../pond/pondField';
import { fragment, type Builder } from '../shaderCode.testutil';
import { makeSight } from '../sightNodes';
import { BRIDGE_ATTRS, RAIL_Y, buildBridge, bridgesOf } from './bridge';
import { bridgeCasterMaterial, bridgeMaterial } from './bridgeNodes';

/** The road bridge of a brook (1 column, the road's 3 rows, travel along x) and two pond bridges (1 wide, 3 long), one along each axis. */
const ROAD: Deck = { x0: 20, z0: 10, x1: 21, z1: 13, alongX: true, road: true, y: DECK_Y };
const POND_Z: Deck = { x0: 30, z0: 14, x1: 31, z1: 17, alongX: false, road: false, y: DECK_Y };
const POND_X: Deck = { x0: 8, z0: 5, x1: 12, z1: 6, alongX: true, road: false, y: DECK_Y };
const ALL = [ROAD, POND_Z, POND_X];

/** Every triangle of a bridge as three points, with its stored normal. */
const built = new Map<Deck, { p: number[][]; n: number[] }[]>();
function triangles(d: Deck): { p: number[][]; n: number[] }[] {
  const have = built.get(d);
  if (have) return have;
  const a = buildBridge(d), out: { p: number[][]; n: number[] }[] = [];
  built.set(d, out);
  for (let i = 0; i < a.index.length; i += 3) {
    const p = [0, 1, 2].map((k) => Array.from(a.position.subarray(a.index[i + k] * 3, a.index[i + k] * 3 + 3)));
    out.push({ p, n: Array.from(a.normal.subarray(a.index[i] * 3, a.index[i] * 3 + 3)) });
  }
  return out;
}
/** The height of the highest face turned up over the ground point (x, z), or null where none lies. */
function topAt(d: Deck, x: number, z: number): number | null {
  let top: number | null = null;
  for (const { p, n } of triangles(d)) {
    if (n[1] < 0.5) continue;
    const [a, b, c] = p, den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(den) < 1e-12) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den, w = 1 - u - v;
    if (u < 0 || v < 0 || w < 0) continue;
    const y = u * a[1] + v * b[1] + w * c[1];
    if (top === null || y > top) top = y;
  }
  return top;
}
/** The travel axis' start and end of a deck's rect, and a point of the deck at `t` along it and `c` (0..1) across it. */
const span = (d: Deck): [number, number] => (d.alongX ? [d.x0, d.x1] : [d.z0, d.z1]);
const at = (d: Deck, t: number, c: number): [number, number] => (d.alongX ? [t, d.z0 + (d.z1 - d.z0) * c] : [d.x0 + (d.x1 - d.x0) * c, t]);

describe('buildBridge', () => {
  it('the deck covers its rect and its top is at DECK_Y', () => {
    for (const d of ALL) {
      const [t0, t1] = span(d);
      // the rect grown by half a tile at both ends, as `deckAt` has it; a hair inside the edges
      for (let t = t0 - 0.49; t <= t1 + 0.49; t += 0.07) for (const c of [0.02, 0.3, 0.5, 0.77, 0.98]) {
        // a gap between two planks (through which a beam or the end's sloping plank shows) is narrower than 0.07: of two points that
        // far apart one is on a plank, which lies at most a hair under the deck's height
        const near = Math.max(topAt(d, ...at(d, t, c)) ?? -9, topAt(d, ...at(d, t + (t < t0 ? 0.07 : -0.07), c)) ?? -9);
        const where = `${d.x0},${d.z0} at ${t.toFixed(2)}, ${c}`;
        expect(near, where).toBeLessThanOrEqual(DECK_Y + (c < 0.1 || c > 0.9 ? 0.2 : 1e-6)); // a road bridge's kerb lies on the planks' ends
        expect(near, where).toBeGreaterThanOrEqual(DECK_Y - 0.012);
      }
    }
  });

  it('nothing stands in the way on the deck: only posts, kerbs and the rail rise above it, at its sides', () => {
    for (const d of ALL) {
      const a = buildBridge(d);
      for (let i = 0; i < a.position.length; i += 3) {
        if (a.position[i + 1] <= DECK_Y + 1e-6) continue;
        const across = d.alongX ? a.position[i + 2] : a.position[i], [c0, c1] = d.alongX ? [d.z0, d.z1] : [d.x0, d.x1];
        expect(Math.min(Math.abs(across - c0), Math.abs(across - c1))).toBeLessThan(0.2);
      }
    }
  });

  it('a road bridge has no rail, a pond bridge has one', () => {
    const highest = (d: Deck): number => buildBridge(d).position.reduce((m, v, i) => (i % 3 === 1 ? Math.max(m, v) : m), -Infinity);
    expect(highest(ROAD)).toBeLessThan(DECK_Y + RAIL_Y - 0.05);
    for (const d of [POND_Z, POND_X]) {
      expect(highest(d)).toBeGreaterThanOrEqual(DECK_Y + RAIL_Y);
      expect(highest(d)).toBeLessThan(DECK_Y + 0.5); // low: it hides no hero
      // on one side only
      const a = buildBridge(d), sides = new Set<number>();
      for (let i = 0; i < a.position.length; i += 3) {
        if (a.position[i + 1] < DECK_Y + RAIL_Y - 0.06) continue;
        const across = d.alongX ? a.position[i + 2] : a.position[i], mid = d.alongX ? (d.z0 + d.z1) / 2 : (d.x0 + d.x1) / 2;
        sides.add(Math.sign(across - mid));
      }
      expect(sides.size).toBe(1);
    }
  });

  it('no NaN in any stream', () => {
    for (const d of ALL) {
      const a = buildBridge(d), count = a.position.length / 3;
      expect(count).toBeGreaterThan(0);
      for (const [name, size] of BRIDGE_ATTRS) {
        expect(a[name].length, name).toBe(count * size);
        expect(Array.from(a[name]).every(Number.isFinite), name).toBe(true);
      }
      expect(a.index.length % 3).toBe(0);
      expect(a.index.every((i) => i < count)).toBe(true);
      expect(a.colour.every((c) => c >= 0 && c <= 1)).toBe(true);
      for (let i = 0; i < a.normal.length; i += 3) expect(Math.hypot(a.normal[i], a.normal[i + 1], a.normal[i + 2])).toBeCloseTo(1, 4);
    }
  });

  it('every face is wound the way its normal points', () => {
    for (const d of ALL) for (const { p: [a, b, c], n } of triangles(d)) {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      expect(g[0] * n[0] + g[1] * n[1] + g[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it('the same deck gives the same bridge, another place another one', () => {
    expect(buildBridge(POND_Z)).toEqual(buildBridge({ ...POND_Z }));
    const moved = buildBridge({ ...POND_Z, x0: 40, x1: 41 });
    expect(Array.from(moved.colour)).not.toEqual(Array.from(buildBridge(POND_Z).colour));
  });

  it("a bridge's ends reach the ground", () => {
    for (const d of ALL) {
      const [t0, t1] = span(d);
      for (const [edge, out] of [[t0 - 0.5, -1], [t1 + 0.5, 1]] as const) for (const c of [0.1, 0.5, 0.9]) {
        // a sloping plank leads from the deck's end down to the ground: no step higher than a hair anywhere on the way
        let last = topAt(d, ...at(d, edge - out * 0.02, c))!;
        expect(last).toBeGreaterThan(DECK_Y - 0.03);
        for (let s = 0.02; s <= 0.5; s += 0.02) {
          const y = topAt(d, ...at(d, edge + out * s, c));
          if (y === null) break;
          expect(last - y).toBeLessThan(0.03);
          last = y;
        }
        expect(last).toBeLessThan(0.03);
      }
      // and its posts stand in the bed, below the deepest water a deck crosses
      expect(buildBridge(d).position.reduce((m, v, i) => (i % 3 === 1 ? Math.min(m, v) : m), Infinity)).toBeLessThan(-1);
    }
  });
});

describe('bridgesOf', () => {
  it('a map without a pond builds no bridge', () => {
    expect(bridgesOf(undefined)).toEqual([]);
    expect(bridgesOf(pondFieldOf(new TileMap(4, 4, new Uint8Array(16))))).toEqual([]);
  });
  it('one bridge a deck', () => {
    expect(bridgesOf({ decks: ALL } as PondField).length).toBe(3);
  });
});

describe('the bridge materials', () => {
  const geometry = (): BufferGeometry => {
    const g = new BufferGeometry();
    for (const [n, s] of BRIDGE_ATTRS) g.setAttribute(n, new BufferAttribute(new Float32Array(6 * s), s));
    return g;
  };
  for (const B of [GLSLNodeBuilder, WGSLNodeBuilder] as Builder[]) {
    it(`${B.name}: the material builds, with the sun's light and the sight step`, () => {
      for (const sun of [true, false]) {
        const lighting = makeLighting(new DataTexture(new Uint8Array(12), 4, 3), { w: 4, h: 3 }, new Texture(), { sun });
        const code = fragment(B, bridgeMaterial(lighting, makeSight()), { geometry: geometry() });
        expect(code).toContain('sightMode');
        expect(code).toContain('sightOrigin');
        expect(code.includes('sunClouds')).toBe(sun);
      }
      expect(fragment(B, bridgeCasterMaterial(), { geometry: geometry() }).length).toBeGreaterThan(0);
    });
  }
});

// The client must unpack exactly what the server packed (fixtures written by
// `cargo test`, server/src/export.rs). Positions and aim lose precision on
// the wire by design; everything else must match.
import { decode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { CONST } from './generated/defs';
import type { SelfW } from './generated/SelfW';
import type { SnapW } from './generated/SnapW';
import fixtures from './generated/wire-fixtures.json';
import { packInput, unpackSnap } from './wire';

const POS_TOL = 0.5 / CONST.POS_SCALE + 1e-6;
const AIM_TOL = Math.PI / 256 + 1e-6;

function close(got: unknown, want: unknown, path: string): void {
  if (typeof want === 'number') {
    expect(typeof got, path).toBe('number');
    let d = Math.abs((got as number) - want);
    if (/^ents\.\d+\.6$/.test(path)) {
      d = Math.min(d, 2 * Math.PI - d);
      expect(d, path).toBeLessThanOrEqual(AIM_TOL);
    } else if (/^(ents\.\d+\.[23]|ev\.\d+\.[xy])$/.test(path)) {
      expect(d, path).toBeLessThanOrEqual(POS_TOL);
    } else {
      expect(d, path).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(want)));
    }
  } else if (want !== null && typeof want === 'object') {
    expect(got !== null && typeof got === 'object', path).toBe(true);
    expect(Object.keys(got as object).sort(), path).toEqual(Object.keys(want).sort());
    for (const k of Object.keys(want)) {
      close((got as Record<string, unknown>)[k], (want as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    }
  } else {
    expect(got, path).toEqual(want);
  }
}

describe('wire', () => {
  it('unpacks the server snapshots', () => {
    expect(fixtures.cases.length).toBe(2);
    for (const c of fixtures.cases) {
      const snap = unpackSnap(decode(Uint8Array.from(c.bytes)) as SnapW);
      close(snap, c.snap, '');
    }
  });

  // Case 0 holds all sample entities, including aims near both sides of ±π.
  it('returns aims in (-pi, pi] like atan2 on the server', () => {
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[0].bytes)) as SnapW);
    for (const e of snap.ents) {
      expect(e[6]).toBeGreaterThan(-Math.PI);
      expect(e[6]).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('keeps an exactly-left aim at +pi (the staff swing uses the raw angle)', () => {
    const me: SelfW = [true, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, null];
    const snap = unpackSnap([1, 0, [[5, 1, 16, 16, 255, 0, 128, 0, 0, 0]], me, null, [], 0]);
    expect(snap.ents[0][6]).toBe(Math.PI);
  });

  it('packs inputs in field order with null for no shot', () => {
    const i = { seq: 7, mx: 1, my: -1, aim: 0.5, aim_dist: 30, primary: 3, secondary: undefined as unknown as null, view_lag: 80, rtt: 40 };
    expect(packInput(i)).toEqual([7, 1, -1, 0.5, 30, 3, null, 80, 40]);
  });
});

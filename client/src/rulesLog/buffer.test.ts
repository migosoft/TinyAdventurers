import { describe, expect, it } from 'vitest';
import type { LineW } from '../generated/LineW';
import { LogBuffer } from './buffer';

const line = (t: number, head: string, details: string[] = [], kind = 0): LineW => [t, kind, head, details];

describe('LogBuffer', () => {
  it('keeps the last 300 records', () => {
    const b = new LogBuffer();
    b.push(Array.from({ length: 350 }, (_, i) => line(i, `h${i}`)));
    const rows = b.rows(false);
    expect(rows.length).toBe(300);
    expect(rows[0].text).toBe('50.0s  h50');
    expect(rows[299].text).toBe('349.0s  h349');
  });

  it('rows with details off are headlines only', () => {
    const b = new LogBuffer();
    b.push([line(1.25, 'A hits B', ['9 base']), line(2, 'B dies', [], 3)]);
    expect(b.rows(false)).toEqual([
      { t: 1.25, kind: 0, text: '1.3s  A hits B', detail: false },
      { t: 2, kind: 3, text: '2.0s  B dies', detail: false },
    ]);
  });

  it("rows with details on put each record's details after its head", () => {
    const b = new LogBuffer();
    b.push([line(1, 'A hits B', ['9 base', 'x2 crit']), line(2, 'B dies')]);
    expect(b.rows(true).map((r) => [r.text, r.detail])).toEqual([
      ['1.0s  A hits B', false],
      ['9 base', true],
      ['x2 crit', true],
      ['2.0s  B dies', false],
    ]);
    b.clear();
    expect(b.rows(true)).toEqual([]);
  });
});

describe('LogBuffer.push', () => {
  it('returns the new records and how many old ones fell off', () => {
    const b = new LogBuffer(3);
    expect(b.push([line(1, 'a'), line(2, 'b')], false)).toEqual({
      add: [[{ t: 1, kind: 0, text: '1.0s  a', detail: false }], [{ t: 2, kind: 0, text: '2.0s  b', detail: false }]],
      drop: 0,
    });
    const r = b.push([line(3, 'c', ['d']), line(4, 'd')], true);
    expect(r.drop).toBe(1);
    expect(r.add.map((x) => x.length)).toEqual([2, 1]);
    expect(b.rows(false).map((x) => x.text)).toEqual(['2.0s  b', '3.0s  c', '4.0s  d']);
  });

  it('a batch bigger than the cap keeps only its last records and drops all old ones', () => {
    const b = new LogBuffer(2);
    b.push([line(1, 'a')]);
    const r = b.push([line(2, 'b'), line(3, 'c'), line(4, 'd')]);
    expect(r.drop).toBe(1);
    expect(r.add.map((x) => x[0].text)).toEqual(['3.0s  c', '4.0s  d']);
  });
});

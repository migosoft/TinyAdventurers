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

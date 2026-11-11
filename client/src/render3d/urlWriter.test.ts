import { describe, expect, it, vi } from 'vitest';
import { trailingWriter } from './urlWriter';

describe('trailingWriter', () => {
  it('cancel drops the pending write', () => {
    vi.useFakeTimers();
    try {
      const writes: string[] = [];
      const w = trailingWriter((v) => writes.push(v), 200);
      w('?a');
      w.cancel();
      vi.advanceTimersByTime(500);
      expect(writes).toEqual([]);
      w('?b');
      vi.advanceTimersByTime(200);
      expect(writes).toEqual(['?b']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes once, with the last value, after a burst of calls', () => {
    vi.useFakeTimers();
    try {
      const writes: string[] = [];
      const w = trailingWriter((v) => writes.push(v), 200);
      for (let i = 0; i < 50; i++) {
        w(`?r3d&pitch=${i}`);
        vi.advanceTimersByTime(10);
      }
      expect(writes).toEqual([]);
      vi.advanceTimersByTime(200);
      expect(writes).toEqual(['?r3d&pitch=49']);
      w('?r3d&yaw=5');
      vi.advanceTimersByTime(200);
      expect(writes).toEqual(['?r3d&pitch=49', '?r3d&yaw=5']);
    } finally {
      vi.useRealTimers();
    }
  });
});

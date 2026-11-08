import { describe, expect, it } from 'vitest';
import { fits } from './shadowlayer';

describe('shadowlayer', () => {
  it('fits: the map must not exceed the texture limit on either side', () => {
    expect(fits({ w: 3008, h: 736 }, 4096)).toBe(true);
    expect(fits({ w: 3008, h: 736 }, 2048)).toBe(false);
    expect(fits({ w: 700, h: 5000 }, 4096)).toBe(false);
  });
});

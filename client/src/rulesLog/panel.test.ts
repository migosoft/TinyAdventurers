import { describe, expect, it } from 'vitest';
import { FONT_HREF, fontLinkNeeded } from './panel';

describe('panel', () => {
  it('adds the font link only when it is not there yet', () => {
    expect(FONT_HREF).toBe('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
    expect(fontLinkNeeded([])).toBe(true);
    expect(fontLinkNeeded(['https://example.com/a.css'])).toBe(true);
    expect(fontLinkNeeded(['x', FONT_HREF])).toBe(false);
  });
});

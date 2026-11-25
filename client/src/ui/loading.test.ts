// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LoadingScreen } from './loading';

describe('LoadingScreen', () => {
  it('shows, sets the bar and line, hides', () => {
    const parent = document.createElement('div');
    const screen = new LoadingScreen(parent);
    const el = parent.querySelector<HTMLElement>('.loading-screen')!;
    expect(el).not.toBeNull();
    expect(screen.visible).toBe(false);
    screen.show();
    expect(screen.visible).toBe(true);
    expect(parent.querySelector('.loading-line')!.textContent).toBe('Loading assets…');
    screen.set(0.25, 'X');
    expect(parent.querySelector<HTMLElement>('.loading-fill')!.style.width).toBe('25%');
    expect(parent.querySelector('.loading-line')!.textContent).toBe('X');
    // Progress throws runes off along the stretch it covered; they stay there when the bar moves on (#405).
    const placed = () => [...parent.querySelectorAll<HTMLElement>('.loading-bar > .loading-rune')].map((r) => r.style.left).filter(Boolean);
    const first = placed();
    expect(first.length).toBeGreaterThan(0);
    for (const left of first) expect(parseFloat(left)).toBeLessThanOrEqual(25);
    screen.set(0.5, 'X');
    expect(placed().slice(0, first.length)).toEqual(first);
    expect(placed().length).toBeGreaterThan(first.length);
    screen.set(0.5, 'X');
    expect(placed().length).toBe(first.length * 2); // no progress, no new runes
    screen.hide();
    expect(screen.visible).toBe(false);
  });
});

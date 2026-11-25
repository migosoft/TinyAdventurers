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
    // The runes ride on the fill's right end, so they follow the bar without script (#405).
    expect(parent.querySelectorAll('.loading-fill > .loading-tip > .loading-rune').length).toBe(9);
    screen.hide();
    expect(screen.visible).toBe(false);
  });
});

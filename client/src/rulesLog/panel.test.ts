// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FONT_HREF, LogPanel, fontLinkNeeded } from './panel';
import type { Row } from './buffer';

describe('panel', () => {
  it('adds the font link only when it is not there yet', () => {
    expect(FONT_HREF).toBe('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
    expect(fontLinkNeeded([])).toBe(true);
    expect(fontLinkNeeded(['https://example.com/a.css'])).toBe(true);
    expect(fontLinkNeeded(['x', FONT_HREF])).toBe(false);
  });
});

describe('LogPanel append-only', () => {
  const rec = (t: number, n = 1): Row[] =>
    Array.from({ length: n }, (_, i) => ({ t, kind: 0, text: i === 0 ? `${t}s head` : `d${i}`, detail: i > 0 }));
  const texts = (root: HTMLElement) => Array.from(root.querySelectorAll('.rl-row')).map((e) => e.textContent);

  it('appends new rows without touching the old elements, and trims from the top', () => {
    const parent = document.createElement('div');
    const p = new LogPanel(parent, () => {});
    p.render([rec(1, 2), rec(2)]);
    const first = parent.querySelector('.rl-row');
    p.append([rec(3, 2)], 0);
    expect(texts(parent)).toEqual(['1s head', 'd1', '2s head', '3s head', 'd1']);
    expect(parent.querySelector('.rl-row')).toBe(first);
    p.append([rec(4)], 2);
    expect(texts(parent)).toEqual(['3s head', 'd1', '4s head']);
    expect(parent.querySelector('.rl-row')).not.toBe(first);
  });

  it('a full render replaces everything', () => {
    const parent = document.createElement('div');
    const p = new LogPanel(parent, () => {});
    p.append([rec(1)], 0);
    p.render([rec(9, 2)]);
    expect(texts(parent)).toEqual(['9s head', 'd1']);
  });
});

describe('LogPanel stacking', () => {
  it('sits before #ui in the page, so the menus paint above it', () => {
    document.body.innerHTML = '<div id="game"></div><div id="ui"></div>';
    new LogPanel(document.body, () => {});
    expect(Array.from(document.body.children).map((c) => c.id || c.className)).toEqual(['game', 'rules-log', 'ui']);
  });
});

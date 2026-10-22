// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Hud, helpHtml, secondaryLabel } from './hud';

describe('secondaryLabel', () => {
  it('reads Heal Wolf while the wolf lives', () => expect(secondaryLabel(true, 'Dire Wolf')).toBe('Heal Wolf'));
  it('reads Summon Wolf without a wolf', () => expect(secondaryLabel(false, 'Dire Wolf')).toBe('Summon Wolf'));
  it('keeps the name of other classes', () => expect(secondaryLabel(null, 'Charge')).toBe('Charge'));
});

describe('Hud', () => {
  let hud: Hud;
  beforeEach(() => {
    document.body.innerHTML = '';
    hud = new Hud(document.body, () => {}, () => {});
  });
  it('marks server messages as game and client text as notice', () => {
    hud.message('A demon awakens!', 'game');
    hud.message('Connection lost. Reload the page to reconnect.');
    const m = [...document.querySelectorAll('.msg')];
    expect(m.map((e) => e.className)).toEqual(['msg game', 'msg notice']);
  });
  it('shows the asleep panel above the HP bar with the E key', () => {
    hud.setAsleep(true);
    const el = document.querySelector('.hp-col .status-hint')!;
    expect(el.classList.contains('hidden')).toBe(false);
    expect(el.textContent).toBe('Asleep. A teammate can wake you E');
    expect(el.querySelector('kbd')!.textContent).toBe('E');
    hud.setAsleep(false);
    expect(el.classList.contains('hidden')).toBe(true);
  });
  it('writes the help line as key caps', () => {
    expect(helpHtml()).toBe('<span><kbd>WASD</kbd>move</span><span><kbd>LMB</kbd><kbd>RMB</kbd>attack</span><span><kbd>L</kbd>log</span><span><kbd>Esc</kbd>menu</span><span><kbd>F3</kbd>stats</span>');
  });
  it('titles the menu Paused and keeps its hint', () => {
    expect(document.querySelector('.menu .title')!.textContent).toBe('Paused');
    expect(document.querySelector('.menu p')!.textContent).toBe('The dungeon keeps going while this is open.');
  });
});

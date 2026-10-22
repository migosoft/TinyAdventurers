// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Hud, helpHtml, secondaryLabel } from './hud';
import { EFFECT } from '../generated/defs';
import { EFFECT_ICON } from './effectIcons';

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
  it('has Resume, Settings, Leave dungeon and a Settings view that Back closes', () => {
    hud.setToggles([{ label: 'Rules log', key: 'L', get: () => false, set: () => {} }]);
    expect([...document.querySelectorAll('.menu > button')].map((b) => b.textContent)).toEqual(['Resume', 'Settings', 'Leave dungeon']);
    const menu = document.querySelector<HTMLElement>('.menu')!;
    const settings = menu.querySelector<HTMLElement>('.settings')!;
    expect(menu.classList.contains('in-settings')).toBe(false);
    [...menu.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Settings')!.click();
    expect(menu.classList.contains('in-settings')).toBe(true);
    expect(settings.hidden).toBe(false);
    [...settings.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Back')!.click();
    expect(menu.classList.contains('in-settings')).toBe(false);
    expect(settings.hidden).toBe(true);
  });
  it('returns to the main menu after the menu was closed from Settings', () => {
    hud.toggleMenu();
    [...document.querySelectorAll<HTMLButtonElement>('.menu button')].find((b) => b.textContent === 'Settings')!.click();
    hud.toggleMenu();
    hud.toggleMenu();
    expect(document.querySelector('.menu')!.classList.contains('in-settings')).toBe(false);
  });
  it('blurs the focused control when the menu closes', () => {
    hud.toggleMenu();
    const resume = [...document.querySelectorAll<HTMLButtonElement>('.menu button')].find((b) => b.textContent === 'Settings')!;
    resume.focus();
    expect(document.activeElement).toBe(resume);
    hud.toggleMenu();
    expect(document.activeElement).not.toBe(resume);
  });
  it('shows server message text literally', () => {
    hud.message('<b>x</b>', 'game');
    const m = document.querySelector('.msg')!;
    expect(m.textContent).toBe('<b>x</b>');
    expect(m.querySelector('b')).toBeNull();
  });
  it('mutes the (you) suffix in the party list', () => {
    const info = {
      you: 1,
      abilities: [
        { id: 'MagicMissile', cooldown: 1 },
        { id: 'Fireball', cooldown: 1 },
      ],
      players: [
        { ent: 1, name: 'Al', class: 'Wizard' },
        { ent: 2, name: 'Bo', class: 'Barbarian' },
      ],
    } as unknown as Parameters<Hud['startRun']>[0];
    hud.startRun(info);
    const rows = [...document.querySelectorAll('.member .pname')];
    expect(rows[0].querySelector('em')!.textContent).toBe(' (you)');
    expect(rows[0].textContent).toBe('Al (you)');
    expect(rows[1].querySelector('em')).toBeNull();
  });
  describe('effect symbols', () => {
    const info = {
      you: 1,
      abilities: [
        { id: 'MagicMissile', cooldown: 1 },
        { id: 'Fireball', cooldown: 1 },
      ],
      players: [
        { ent: 1, name: 'Al', class: 'Wizard' },
        { ent: 2, name: 'Bo', class: 'Barbarian' },
      ],
    } as unknown as Parameters<Hud['startRun']>[0];
    const snap = (effects: [number, number][], bits: number) =>
      ({
        me: { hp: 10, max_hp: 10, alive: true, effects },
        ents: [[2, 0, 0, 0, 255, 0, 0, 0, 0, 0, bits]],
      }) as unknown as Parameters<Hud['snapshot']>[0];
    it('draws the own effect as a symbol with seconds and keeps the node while unchanged', () => {
      hud.startRun(info);
      hud.snapshot(snap([[EFFECT.Poisoned, 2.3]], 0), info);
      const fx = document.querySelector('.effects .fx')!;
      expect(fx.querySelector('svg.ic')).not.toBeNull();
      expect(fx.querySelector('i')!.textContent).toBe('3');
      expect(fx.classList.contains('neg')).toBe(true);
      hud.snapshot(snap([[EFFECT.Poisoned, 2.3]], 0), info);
      expect(document.querySelector('.effects .fx')).toBe(fx);
    });
    it('draws party effects as symbols', () => {
      hud.startRun(info);
      hud.snapshot(snap([], 1 << EFFECT.Accelerated), info);
      const icons = document.querySelectorAll('.member .pfx svg.ic');
      expect(icons.length).toBe(1);
      expect(icons[0].parentElement!.classList.contains('pos')).toBe(true);
    });
    it('shows the moon symbol in the asleep panel', () => {
      hud.setAsleep(true);
      const svg = document.querySelector('.status-hint svg.ic')!;
      expect(svg.querySelector('path')!.getAttribute('d')).toBe(/d="([^"]+)"/.exec(EFFECT_ICON[EFFECT.Sleep].body)![1]);
    });
  });
});

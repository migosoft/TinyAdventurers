// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Hud, debugBadgeHtml, effectChipHtml, effectsHtml, helpHtml, secondaryLabel } from './hud';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
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
  it('always says the XP and coins were banked on the end screen', () => {
    hud.showEnd({ victory: true, level: 'Dungeon', boss: null, time: 75, stats: [] });
    expect(document.querySelector('.note')!.textContent).toBe('Your XP and coins were added to your profile. Spend XP on Attributes and the skill tree in the lobby.');
  });
  it('writes the help line as key caps', () => {
    expect(helpHtml()).toBe('<span><kbd>WASD</kbd>move</span><span><kbd>LMB</kbd><kbd>RMB</kbd>attack</span><span><kbd>L</kbd>log</span><span><kbd>Esc</kbd>menu</span><span><kbd>F3</kbd>stats</span>');
  });
  it('lists every debug key on its own row of the debug badge and shows when the hero is mortal', () => {
    const badge = document.createElement('div');
    badge.innerHTML = debugBadgeHtml(true);
    const rows = [...badge.querySelectorAll('.db-row')].map((r) => [r.querySelector('kbd, .db-swatch')!.textContent, r.textContent]);
    expect(rows).toEqual([
      ['F4', 'F4darkvision 0/50/100 %'],
      ['F7', 'F7nearest enemy incorporeal'],
      ['F8', 'F8next effect on you'],
      ['Shift+F7', 'Shift+F7anti-magic on/off'],
      ['Shift+F8', 'Shift+F8dispel on you'],
      ['F9', 'F9immortal on/off'],
      ['', 'path to the boss'],
      ['', 'path to the ogre'],
      ['', 'path to the cove'],
    ]);
    expect(badge.querySelector('.db-title')!.textContent).toBe('DEBUG · immortal');
    expect(badge.querySelector('.db-title.mortal')).toBeNull();
    badge.innerHTML = debugBadgeHtml(false);
    expect(badge.querySelector('.db-title.mortal')!.textContent).toBe('DEBUG · MORTAL');
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
        me: { hp: 10, max_hp: 10, alive: true, effects, paused_items: [], paused_nodes: [] },
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

describe('effectChipHtml', () => {
  it('shows the amount as minus N beside the glyph, with a tooltip', () => {
    const html = effectChipHtml(EFFECT.Weakened, 12.5, -2);
    expect(html).toContain('<b>\u22122</b>');
    expect(html).toContain('title="Weakened (STR \u22122)"');
    expect(html).toContain('<i>13</i>');
  });
  it('shows no number for an amount of 0', () => {
    const html = effectChipHtml(EFFECT.Burning, 3, 0);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('title=');
  });
  it('names a cooldown change as a tooltip', () => {
    expect(effectChipHtml(EFFECT.Accelerated, 3, 0)).toContain('title="cooldowns 25 % faster"');
    expect(effectChipHtml(EFFECT.Slowed, 3, 0)).toContain('title="cooldowns 25 % slower"');
  });
});

describe('effectsHtml', () => {
  const host = (html: string) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d;
  };
  it('greys a paused entry and keeps its timer', () => {
    const d = host(effectsHtml([[EFFECT.Accelerated, 4.2, 0, true]], [], []));
    const fx = d.querySelectorAll('.fx');
    expect(fx).toHaveLength(1);
    expect(fx[0].classList.contains('paused')).toBe(true);
    expect(fx[0].querySelector('i')!.textContent).toBe('5');
  });
  it('shows one unpaused icon for a kind with a paused and an unpaused entry, the longest unpaused timer', () => {
    const d = host(effectsHtml([[EFFECT.Accelerated, 9, 0, true], [EFFECT.Accelerated, 3, 0, false], [EFFECT.Accelerated, 6, 0, false]], [], []));
    const fx = d.querySelectorAll('.fx');
    expect(fx).toHaveLength(1);
    expect(fx[0].classList.contains('paused')).toBe(false);
    expect(fx[0].querySelector('i')!.textContent).toBe('6');
  });
  it('shows a paused item and a paused node as grey chips with their names', () => {
    const d = host(effectsHtml([], ['BandOfVigor'], ['PU5']));
    expect([...d.querySelectorAll('.pchip')].map((c) => c.textContent)).toEqual(['Band of Vigor', 'Radiant']);
  });
  it('adds up the amounts of the unpaused entries of a drain kind', () => {
    const d = host(effectsHtml([[EFFECT.Weakened, 5, -1, false], [EFFECT.Weakened, 4, -2, false]], [], []));
    expect(d.querySelector('.fx b')!.textContent).toBe('\u22123');
  });
  it('leaves a paused amount out when an unpaused entry exists, and sums all when every entry is paused', () => {
    const mixed = host(effectsHtml([[EFFECT.Weakened, 5, -1, false], [EFFECT.Weakened, 9, -2, true]], [], []));
    expect(mixed.querySelector('.fx b')!.textContent).toBe('\u22121');
    const all = host(effectsHtml([[EFFECT.Weakened, 5, -1, true], [EFFECT.Weakened, 9, -2, true]], [], []));
    expect(all.querySelector('.fx b')!.textContent).toBe('\u22123');
  });
  it('shows no chips when nothing is paused', () => {
    expect(host(effectsHtml([], [], [])).querySelector('.pchip')).toBeNull();
  });
});

describe('Hud.setAbilities', () => {
  const ab = (id: ResolvedAbility['id']): ResolvedAbility => ({ id, cooldown: 1, cd_steps: { base: 1, attr: 'Dex', have: 10, scaled: 1, mods: 1 }, damage: 1, range: 100, arc: 0, speed: 100, radius: 4, duration: 0.2, pierce: 0, pierce_through: 0, ranged: false, projectile: null, split: { Physical: 1 }, windup: 0, behind: 0, per_cast: 0, alive: 0 });
  it('renames the slots and greys the disabled ones', () => {
    document.body.innerHTML = '';
    const hud = new Hud(document.body, () => {}, () => {});
    hud.setAbilities([ab('Strike'), ab('Charge')], [null, ['Dex', 14]]);
    const slots = [...document.querySelectorAll('.slot')];
    expect(slots.map((s) => s.classList.contains('disabled'))).toEqual([false, true]);
    expect(slots[1].querySelector('.name')!.textContent).toBe('Charge');
    expect(slots[1].getAttribute('title')).toBe('Needs DEX 14');
    expect(slots[0].hasAttribute('title')).toBe(false);
    hud.setAbilities([ab('Strike'), ab('Charge')], [null, null]);
    expect(document.querySelectorAll('.slot.disabled').length).toBe(0);
    expect(slots[1].hasAttribute('title')).toBe(false);
  });
  it('shows what a pressed disabled slot needs, or that the target is too close, for a moment', () => {
    document.body.innerHTML = '';
    const hud = new Hud(document.body, () => {}, () => {});
    hud.setAbilities([ab('Strike'), ab('Charge')], [null, ['Dex', 14]]);
    const f = { fps: 60, frameMs: 1, rtt: 0, jitter: 0, interp: 0, snapBytes: 0, correction: 0, srvMs: 0, cd1: 0, cd2: 0, ents: 0, darkvision: 0, wolf: null } as unknown as Parameters<Hud['frame']>[0];
    const slots = [...document.querySelectorAll('.slot')];
    const name = (i: number) => slots[i].querySelector('.name')!.textContent;
    hud.needs(1, ['Dex', 14]);
    hud.frame(f);
    expect(name(1)).toBe('Needs DEX 14');
    expect(slots[1].classList.contains('hint')).toBe(true);
    expect(name(0)).toBe('Strike');
    hud.tooClose(0);
    hud.frame(f);
    expect(name(0)).toBe('Too close');
    expect(slots[0].classList.contains('hint')).toBe(true);
  });
  it('keeps a running cooldown ring across a setAbilities with the same ids', () => {
    document.body.innerHTML = '';
    const hud = new Hud(document.body, () => {}, () => {});
    hud.setAbilities([ab('Strike'), ab('Charge')], [null, null]);
    const f = (cd1: number) => ({ fps: 60, frameMs: 1, rtt: 0, jitter: 0, interp: 0, snapBytes: 0, correction: 0, srvMs: 0, cd1, cd2: 0, ents: 0, darkvision: 0, wolf: null }) as unknown as Parameters<Hud['frame']>[0];
    const p = () => (document.querySelector('.slot') as HTMLElement).style.getPropertyValue('--p');
    hud.frame(f(10));
    hud.frame(f(5));
    expect(p()).toBe('50%');
    hud.setAbilities([ab('Strike'), ab('Charge')], [null, null]);
    hud.frame(f(5));
    expect(p()).toBe('50%');
  });
});

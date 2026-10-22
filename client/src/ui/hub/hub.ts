// The character hub: a header bar, the tabs and one tab body. Only the body is redrawn when the character changes.
import type { CharacterInfo } from '../../generated/CharacterInfo';
import type { ClientMsg } from '../../generated/ClientMsg';
import { classFigure, figureWeapon } from '../classes';
import type { Atlas } from '../atlas';
import { esc } from '../hud';
import { className } from '../text';
import { renderSheet } from './sheet';
import { clearTips } from './tip';

export type HubTab = 'sheet' | 'tree' | 'equipment' | 'loadout';
export type TabCtx = { info: CharacterInfo; atlas: Atlas; send: (m: ClientMsg) => void; debug: boolean };

const TABS: [HubTab, string][] = [
  ['sheet', 'Sheet'],
  ['tree', 'Skill tree'],
  ['equipment', 'Equipment'],
  ['loadout', 'Loadout'],
];
const COIN = '<i class="coin-icon"></i>';

const soon = (): HTMLElement => {
  const p = document.createElement('div');
  p.className = 'panel';
  p.textContent = 'Coming in this plan';
  return p;
};
/** Tasks 5 to 7 replace the placeholders. */
const RENDER: Record<HubTab, (ctx: TabCtx) => HTMLElement> = { sheet: renderSheet, tree: soon, equipment: soon, loadout: soon };

const debugOn = (): boolean => new URLSearchParams(location.search).has('debug');

export class Hub {
  tab: HubTab = 'sheet';
  private root = document.createElement('div');
  private bar: HTMLElement;
  private who: HTMLElement;
  private purse: HTMLElement;
  private toDungeon: HTMLButtonElement;
  private tabs: HTMLElement;
  private errorLine: HTMLElement;
  private body: HTMLElement;
  /** The character this hub is for; messages for any other id are ignored. */
  private id = 0;
  private info: CharacterInfo | null = null;

  constructor(
    host: HTMLElement,
    private atlas: Atlas,
    private send: (m: ClientMsg) => void,
    onRoster: () => void,
    onDungeon: () => void,
  ) {
    this.root.className = 'lobby ui hidden';
    this.root.innerHTML = `
      <div class="ui-bar ui-w"><button id="to-roster">&lt; Roster</button><div class="ui-who"></div><span class="ui-purse"></span><button id="to-dungeon" class="primary">To the dungeon</button></div>
      <div class="ui-tabs ui-w">${TABS.map(([t, n]) => `<button data-tab="${t}">${n}</button>`).join('')}</div>
      <div class="error ui-w"></div>
      <div class="ui-body ui-w"></div>`;
    const $ = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.bar = $('.ui-bar');
    this.who = $('.ui-who');
    this.purse = $('.ui-purse');
    this.toDungeon = $('#to-dungeon');
    this.tabs = $('.ui-tabs');
    this.errorLine = $('.error');
    this.body = $('.ui-body');
    $('#to-roster').onclick = onRoster;
    this.toDungeon.onclick = onDungeon;
    this.tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab as HubTab;
        this.render();
      };
    });
    host.append(this.root);
    this.render();
  }

  /** Opens the hub of character `id` on the Sheet tab; it reads "Loading…" until that id's Character message. */
  open(id: number): void {
    this.id = id;
    this.info = null;
    this.tab = 'sheet';
    this.errorLine.textContent = '';
    this.render();
  }

  setCharacter(c: CharacterInfo): void {
    if (c.id !== this.id) return;
    this.info = c;
    this.errorLine.textContent = '';
    this.render();
  }

  /** Only writes the line: a half-done action (a typed input, a hover) must survive an unrelated error. */
  error(msg: string): void {
    this.errorLine.textContent = msg;
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
  show(): void {
    this.root.classList.remove('hidden');
  }
  hide(): void {
    clearTips();
    this.root.classList.add('hidden');
  }

  private render(): void {
    clearTips();
    const c = this.info;
    this.tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const vis = c ? '' : 'hidden';
    this.tabs.style.visibility = this.who.style.visibility = this.purse.style.visibility = this.toDungeon.style.visibility = vis;
    this.bar.className = `ui-bar ui-w${c ? ` c-${c.class.toLowerCase()}` : ''}`;
    this.body.replaceChildren();
    if (!c) {
      const p = document.createElement('div');
      p.className = 'panel';
      p.textContent = 'Loading…';
      this.body.append(p);
      this.who.replaceChildren();
      this.purse.replaceChildren();
      return;
    }
    const info = document.createElement('div');
    info.className = 'cinfo';
    info.innerHTML = `<b>${esc(c.name)}</b><small>${className(c.class)}</small>`;
    this.who.replaceChildren(classFigure(this.atlas, c.class, 2, figureWeapon(c)), info);
    this.purse.innerHTML = `<b>${c.xp} XP</b><span>${COIN}${c.coins}</span>`;
    this.body.append(RENDER[this.tab]({ info: c, atlas: this.atlas, send: this.send, debug: debugOn() }));
  }
}

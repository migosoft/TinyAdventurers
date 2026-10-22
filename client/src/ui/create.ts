// The create screen: pick a class from four cards that show what it starts with, name it, create it.
import { api, ApiFail } from '../api';
import { ABILITIES, CLASSES as CLASS_DEFS } from '../generated/defs';
import { ABILITY_INFO, ITEMS } from '../generated/progression';
import type { Attr } from '../generated/Attr';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { ClassId } from '../generated/ClassId';
import type { Atlas } from './atlas';
import { CLASSES, classFigure } from './classes';
import { spaced } from './hub/model';
import { esc } from './hud';
import { abilityIcon, itemIcon } from './icons';
import { CLASS_TEXT, className } from './text';

const ATTR_ORDER: Attr[] = ['Str', 'Dex', 'Con', 'Int', 'Wil', 'Cha'];
const SHORT: Record<Attr, string> = { Str: 'STR', Dex: 'DEX', Con: 'CON', Int: 'INT', Wil: 'WIL', Cha: 'CHA' };
const itemName = (id: string) => (ITEMS as unknown as Record<string, { name: string }>)[id].name;

export class Create {
  private root = document.createElement('div');
  private cls: ClassId = 'Wizard';

  constructor(
    host: HTMLElement,
    private atlas: Atlas,
    private onCreated: (c: CharacterInfo) => void,
    private onBack: () => void,
  ) {
    this.root.className = 'lobby ui hidden';
    host.append(this.root);
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.render();
  }
  hide(): void {
    this.root.classList.add('hidden');
  }

  private card(c: ClassId): HTMLElement {
    const d = CLASS_DEFS[c];
    const values = ATTR_ORDER.map((a) => d.attrs[a]);
    const [max, min] = [Math.max(...values), Math.min(...values)];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `ui-class c-${c.toLowerCase()}${c === this.cls ? ' selected' : ''}`;
    const head = document.createElement('div');
    head.className = 'ui-classhead';
    const title = document.createElement('div');
    title.innerHTML = `<b>${className(c)}</b><small>${CLASS_TEXT[c].blurb}</small>`;
    head.append(classFigure(this.atlas, c, 4), title);
    const attrs = document.createElement('div');
    attrs.className = 'ui-attrs';
    attrs.innerHTML = ATTR_ORDER.map((a, i) => `<span class="${values[i] === max ? 'hi' : values[i] === min ? 'lo' : ''}"><i>${SHORT[a]}</i>${values[i]}</span>`).join('');
    const kv = document.createElement('div');
    kv.className = 'ui-kv';
    kv.innerHTML = `<span>HP</span><b>${d.hp}</b><span>Weight</span><b>${d.weight}</b><span>Speed</span><b>${d.speed}</b>`;
    const gear = document.createElement('div');
    gear.className = 'ui-gear';
    gear.innerHTML = '<span class="lbl">Starts with</span>';
    for (const id of [d.starter.melee, d.starter.ranged]) {
      if (!id) continue;
      const name = document.createElement('span');
      name.textContent = itemName(id);
      gear.append(itemIcon(this.atlas, id, 30), name);
    }
    const abl = document.createElement('div');
    abl.className = 'ui-abl';
    abl.innerHTML = [d.primary, d.secondary]
      .map((id, i) => `<p title="${esc(ABILITY_INFO[id].text)}">${abilityIcon(id)}<kbd>${i ? 'RMB' : 'LMB'}</kbd> ${ABILITIES[id].name}</p>`)
      .join('');
    const prof = document.createElement('div');
    prof.className = 'ui-prof';
    prof.innerHTML = `<span class="lbl">Proficient with</span> ${esc(d.weapons.map(spaced).join(', '))}`;
    card.append(head, attrs, kv, gear, abl, prof);
    card.onclick = () => {
      this.cls = c;
      this.root.querySelectorAll('.ui-class').forEach((el) => el.classList.toggle('selected', el === card));
      this.root.querySelector('#char-create')!.textContent = `Create ${className(c)}`;
    };
    return card;
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="ui-bar ui-w"><button id="create-back">&lt; Roster</button><h1 class="ui-title">New character</h1><span></span></div>
      <div class="ui-classes ui-w"></div>
      <form class="panel ui-w ui-createbar">
        <input id="char-name" maxlength="16" placeholder="Character name" required>
        <button type="submit" id="char-create" class="primary">Create ${className(this.cls)}</button>
        <small class="hint">The class cannot be changed later. Each class has its own skill tree.</small>
      </form>
      <div class="error ui-w"></div>`;
    this.root.querySelector('.ui-classes')!.append(...CLASSES.map((c) => this.card(c)));
    this.root.querySelector<HTMLButtonElement>('#create-back')!.onclick = () => this.onBack();
    this.root.querySelector<HTMLFormElement>('.ui-createbar')!.onsubmit = async (e) => {
      e.preventDefault();
      const button = this.root.querySelector<HTMLButtonElement>('#char-create')!;
      if (button.disabled) return;
      button.disabled = true; // a double click must not create two characters
      try {
        const c = await api.createCharacter(this.root.querySelector<HTMLInputElement>('#char-name')!.value.trim(), this.cls);
        this.onCreated(c);
      } catch (err) {
        this.root.querySelector('.error')!.textContent = err instanceof ApiFail ? err.message : String(err);
        button.disabled = false;
      }
    };
  }
}

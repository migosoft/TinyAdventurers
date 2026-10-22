// The roster: the account's characters as cards (a card opens its hub), the "new character" card, and the
// account actions (logout, delete account).
import { api, ApiFail } from '../api';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { Me } from '../generated/Me';
import type { Atlas } from './atlas';
import { classFigure, figureWeapon } from './classes';
import { esc } from './hud';
import { logoHeader } from './logo';
import { className } from './text';

const COIN = '<i class="coin-icon"></i>';

export class Roster {
  private root = document.createElement('div');
  private me: Me | null = null;
  private confirmDelete = false;

  constructor(
    host: HTMLElement,
    private atlas: Atlas,
    private onOpen: (c: CharacterInfo) => void,
    private onNew: () => void,
  ) {
    this.root.className = 'lobby ui hidden';
    host.append(this.root);
  }

  /** Shows the screen with fresh data from the server. */
  async show(me?: Me): Promise<void> {
    this.root.classList.remove('hidden');
    try {
      this.me = me ?? (await api.me());
    } catch (e) {
      this.me = null;
      this.root.innerHTML = `${logoHeader}<div class="panel">${esc(String(e instanceof ApiFail ? e.message : e))}</div>`;
      return;
    }
    if (!this.me) return location.reload(); // session ended: back to the login form
    this.render();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private error(msg: string): void {
    this.root.querySelector('.error')!.textContent = msg;
  }

  private render(): void {
    const me = this.me!;
    const left = me.max_characters - me.characters.length;
    this.root.innerHTML = `
      ${logoHeader}
      <div class="panel account ui-w">
        <span>Logged in as <b>${esc(me.name)}</b></span>
        <span class="row"><button id="logout" class="ghost">Log out</button><button id="delete-account" class="danger">Delete account</button></span>
        ${
          this.confirmDelete
            ? `<form class="confirm-delete">
                <p>This deletes your account and all characters for good. Enter your password to confirm.</p>
                <div class="row"><input id="delete-password" type="password" autocomplete="current-password" placeholder="Password">
                <button type="submit" id="delete-confirm" class="danger">Delete forever</button><button type="button" id="delete-cancel" class="ghost">Cancel</button></div>
              </form>`
            : ''
        }
      </div>
      <div class="panel ui-w">
        <h2>Your characters (${me.characters.length}/${me.max_characters})</h2>
        <div class="ui-roster"></div>
        <div class="error"></div>
      </div>`;

    const grid = this.root.querySelector('.ui-roster')!;
    for (const c of me.characters) {
      const slot = document.createElement('div');
      slot.className = 'ui-charslot';
      const card = document.createElement('button');
      card.className = `ui-char c-${c.class.toLowerCase()}`;
      card.dataset.open = c.name;
      card.append(classFigure(this.atlas, c.class, 4, figureWeapon(c)));
      const info = document.createElement('div');
      info.className = 'cinfo';
      info.innerHTML = `<b>${esc(c.name)}</b><small>${className(c.class)}</small>
        <small>${c.xp} XP <span class="muted">(${c.total_xp} earned)</span></small><small>${COIN}${c.coins}</small>`;
      card.append(info);
      card.onclick = () => this.onOpen(c);
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = 'Delete';
      del.dataset.delete = c.name;
      del.onclick = async () => {
        if (!confirm(`Delete ${c.name} and all of its progress for good?`)) return;
        try {
          await api.deleteCharacter(c.id);
          await this.show();
        } catch (e) {
          this.error(e instanceof ApiFail ? e.message : String(e));
        }
      };
      slot.append(card, del);
      grid.append(slot);
    }
    if (left > 0) {
      const add = document.createElement('button');
      add.id = 'new-char';
      add.className = 'ui-char ui-new';
      add.innerHTML = `<span class="plus">+</span><b>New character</b><small>${left} ${left === 1 ? 'slot' : 'slots'} left</small>`;
      add.onclick = () => this.onNew();
      grid.append(add);
    }

    const $ = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel);
    $('#logout')!.onclick = async () => {
      await api.logout().catch(() => {});
      location.reload();
    };
    $('#delete-account')!.onclick = () => {
      this.confirmDelete = !this.confirmDelete;
      this.render();
    };
    const delForm = $<HTMLFormElement>('.confirm-delete');
    if (delForm) {
      $<HTMLInputElement>('#delete-password')!.focus();
      $('#delete-cancel')!.onclick = () => {
        this.confirmDelete = false;
        this.render();
      };
      delForm.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api.deleteAccount($<HTMLInputElement>('#delete-password')!.value);
          location.reload();
        } catch (err) {
          this.error(err instanceof ApiFail ? err.message : String(err));
        }
      };
    }
  }
}

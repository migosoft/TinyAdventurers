// Character select: every character has a name, a fixed class and its own
// progress. Also holds the account actions (logout, delete account).
import { api, ApiFail } from '../api';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { ClassId } from '../generated/ClassId';
import type { Me } from '../generated/Me';
import type { Atlas } from './atlas';
import { classCard, classFigure, CLASSES } from './classes';
import { esc } from './hud';

export class Characters {
  private root = document.createElement('div');
  private me: Me | null = null;
  private newClass: ClassId = 'Wizard';
  private confirmDelete = false;

  constructor(
    host: HTMLElement,
    private atlas: Atlas,
    private onPlay: (c: CharacterInfo) => void,
  ) {
    this.root.className = 'lobby hidden';
    host.append(this.root);
  }

  /** Shows the screen with fresh data from the server. */
  async show(me?: Me): Promise<void> {
    this.root.classList.remove('hidden');
    try {
      this.me = me ?? (await api.me());
    } catch (e) {
      this.me = null;
      this.root.innerHTML = `<h1>Tiny Adventurers</h1><div class="panel">${esc(String(e instanceof ApiFail ? e.message : e))}</div>`;
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
    const full = me.characters.length >= me.max_characters;
    this.root.innerHTML = `
      <h1>Tiny Adventurers</h1>
      <div class="panel account">
        <span>Logged in as <b>${esc(me.name)}</b></span>
        <span class="row"><button id="logout">Log out</button><button id="delete-account" class="danger">Delete account</button></span>
        ${
          this.confirmDelete
            ? `<form class="confirm-delete">
                <p>This deletes your account and all characters for good. Enter your password to confirm.</p>
                <div class="row"><input id="delete-password" type="password" autocomplete="current-password" placeholder="Password">
                <button type="submit" id="delete-confirm" class="danger">Delete forever</button><button type="button" id="delete-cancel">Cancel</button></div>
              </form>`
            : ''
        }
      </div>
      <div class="panel">
        <h2>Your characters (${me.characters.length}/${me.max_characters})</h2>
        <ul class="chars"></ul>
        <div class="error"></div>
      </div>
      ${
        full
          ? ''
          : `<form class="panel new-char">
              <h2>New character</h2>
              <div class="row"><input id="char-name" maxlength="16" placeholder="Character name" required>
              <button type="submit" id="char-create" class="primary">Create</button></div>
              <div class="classes"></div>
              <small class="hint">The class cannot be changed later. Each character has its own XP, coins and upgrades.</small>
            </form>`
      }`;

    const list = this.root.querySelector('.chars')!;
    if (!me.characters.length) list.innerHTML = '<li class="empty">No characters yet. Create your first one below!</li>';
    for (const c of me.characters) {
      const li = document.createElement('li');
      li.className = `c-${c.class.toLowerCase()}`;
      li.append(classFigure(this.atlas, c.class, 3));
      const info = document.createElement('div');
      info.className = 'cinfo';
      info.innerHTML = `<b>${esc(c.name)}</b><small>${c.class}</small>
        <small>${c.xp} XP <span class="muted">(${c.total_xp} earned)</span> · <i class="coin-icon"></i>${c.coins}</small>`;
      li.append(info);
      const play = document.createElement('button');
      play.className = 'primary';
      play.textContent = 'Play';
      play.dataset.play = c.name;
      play.onclick = () => this.onPlay(c);
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = 'Delete';
      del.onclick = async () => {
        if (!confirm(`Delete ${c.name} and all of its progress for good?`)) return;
        try {
          await api.deleteCharacter(c.id);
          await this.show();
        } catch (e) {
          this.error(e instanceof ApiFail ? e.message : String(e));
        }
      };
      li.append(play, del);
      list.append(li);
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

    const form = $<HTMLFormElement>('.new-char');
    if (form) {
      const classes = form.querySelector('.classes')!;
      for (const c of CLASSES) {
        const card = classCard(this.atlas, c, this.newClass === c);
        card.onclick = () => {
          this.newClass = c;
          classes.querySelectorAll('.class-card').forEach((el) => el.classList.toggle('selected', el === card));
        };
        classes.append(card);
      }
      form.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await api.createCharacter($<HTMLInputElement>('#char-name')!.value.trim(), this.newClass);
          await this.show();
        } catch (err) {
          this.error(err instanceof ApiFail ? err.message : String(err));
        }
      };
    }
  }
}

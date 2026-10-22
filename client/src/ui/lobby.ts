import { ABILITIES, CLASSES, ITEMS } from '../generated/defs';
import type { AbilityId } from '../generated/AbilityId';
import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { LevelId } from '../generated/LevelId';
import type { RoomPlayer } from '../generated/RoomPlayer';
import type { RunSummary } from '../generated/RunSummary';
import type { Net } from '../net';
import { spritePreview, type Atlas } from './atlas';
import { esc } from './hud';
import { logoHeader } from './logo';
import { classFigure, figureWeapon } from './classes';
import { abilityIcon, itemIcon } from './icons';
import { pickLabel, poolFor, samePick } from './hub/model';
import type { Pick } from '../generated/Pick';
import { BOSS_TEXT, className } from './text';

const BOSSES: BossId[] = ['Demon', 'Lich', 'Dragon'];
/** Figure (atlas frame prefix), CSS filter approximating the in-game tint (anim/defs.ts) and preview scale. */
const BOSS_FIG: Record<BossId, [string, string, number]> = {
  Demon: ['demon', '', 2],
  Lich: ['lich', '', 3],
  Dragon: ['dragon', '', 2],
};

type Room = { run_id: number; name: string; host: number; players: RoomPlayer[]; level: LevelId; boss: BossId | null };

/** The abilities of `slot` that class `cls` may use (the debug loadout's choices). */
export function debugChoices(cls: ClassId, slot: 'Primary' | 'Secondary'): AbilityId[] {
  return (Object.keys(ABILITIES) as AbilityId[]).filter((id) => {
    const a = ABILITIES[id];
    return a.slot === slot && (a.classes as readonly ClassId[]).includes(cls);
  });
}

type WeaponId = keyof typeof ITEMS;

/** The weapon items of `slot` that class `cls` can hold and is trained in (the debug weapon selects' choices). */
export function debugWeapons(cls: ClassId, slot: 'Melee' | 'Ranged'): WeaponId[] {
  const trained: readonly string[] = CLASSES[cls].weapons;
  return (Object.keys(ITEMS) as WeaponId[]).filter((id) => {
    const it = ITEMS[id];
    return it.slot === slot && (it.classes as readonly ClassId[]).includes(cls) && trained.includes(it.kind);
  });
}

/** The server's answers that mean a debug message was refused before it stored anything. */
export function isDebugGuardError(msg: string): boolean {
  return ['Debug is off.', 'Join a dungeon first.', 'Not during a run.', 'Not while ready.', 'Choose a character first.', 'Only weapons.'].includes(msg);
}

/** Which debug picks the user changed since the last reset (only those can be answered by an error). */
export type DebugTouched = { loadout: boolean; melee: boolean; ranged: boolean };

export const BUILD_ERROR = /needs |is not one of your abilities|cannot go in the|does not fit the|cannot use the item|not trained in the item/;

/** A server answer that refuses a build change (the selects must be drawn from the saved state again). */
export const isBuildRefusal = (msg: string): boolean => isDebugGuardError(msg) || BUILD_ERROR.test(msg);

/**
 * What to do with a server error about the debug picks the user changed: `reset` the selects to
 * their defaults, and `resend` the defaults of those the server may have stored (a refused sheet;
 * a guard refusal stored nothing). Errors that are not about a pick, or name another player, do nothing.
 */
export function debugReject(msg: string, touched: DebugTouched, others: string[]): { reset: DebugTouched; resend: DebugTouched } {
  const none: DebugTouched = { loadout: false, melee: false, ranged: false };
  if (!touched.loadout && !touched.melee && !touched.ranged) return { reset: none, resend: none };
  if (isDebugGuardError(msg)) return { reset: { ...touched }, resend: none };
  if (others.some((n) => msg.startsWith(`${n}: `)) || !BUILD_ERROR.test(msg)) return { reset: none, resend: none };
  return { reset: { ...touched }, resend: { ...touched } };
}

/** Debug mode only: `?debug&boss=demon|lich|dragon` preselects the end boss on the host's page. */
function debugBoss(): BossId | null {
  const b = debugOn() ? (new URLSearchParams(location.search).get('boss') ?? '') : '';
  const id = b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
  return BOSSES.includes(id as BossId) ? (id as BossId) : null;
}

/** Debug mode only (`?debug`): the waiting room shows the debug loadout picker. */
function debugOn(): boolean {
  return new URLSearchParams(location.search).has('debug');
}

export class Lobby {
  private root = document.createElement('div');
  private runs: RunSummary[] = [];
  private room: Room | null = null;
  private character: CharacterInfo | null = null;
  /** Room the debug boss was already preselected in. */
  private preselected = 0;
  /** The debug loadout picked in a waiting room (the server sends no echo). */
  private debugPick: { run: number; cls: ClassId; primary: AbilityId; secondary: AbilityId; melee: WeaponId | null; ranged: WeaponId | null; touched: DebugTouched } | null = null;
  myId = 0;

  constructor(
    host: HTMLElement,
    private net: Net,
    private atlas: Atlas,
    /** Back to the character hub (only outside of rooms). */
    private onBackToHub: () => void,
  ) {
    this.root.className = 'lobby hidden';
    host.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
  show(): void {
    this.root.classList.remove('hidden');
    this.render();
  }
  hide(): void {
    this.root.classList.add('hidden');
  }

  setRuns(runs: RunSummary[]): void {
    this.runs = runs;
    if (!this.room || !runs.some((r) => r.id === this.room!.run_id && !r.started)) {
      // We are not in a waiting room (left, or the run we were in ended).
      if (this.room && !runs.some((r) => r.id === this.room!.run_id)) this.room = null;
    }
    this.render();
  }

  setRoom(room: Room): void {
    this.room = room;
    const dev = debugBoss();
    if (dev && room.host === this.myId && this.preselected !== room.run_id) {
      this.preselected = room.run_id;
      if (room.boss !== dev) this.net.send({ t: 'SelectBoss', boss: dev });
    }
    this.render();
  }

  setCharacter(c: CharacterInfo): void {
    this.character = c;
    this.render();
  }

  leftRoom(): void {
    this.room = null;
    this.render();
  }

  error(msg: string): void {
    this.resetRejectedDebugPick(msg);
    // A refused build change is not followed by a Character message: draw the selects from the saved state again.
    // Any other error only writes the line, so half-typed input stays.
    if (isBuildRefusal(msg)) this.render();
    const e = this.root.querySelector('.error');
    if (e) e.textContent = msg;
  }

  /**
   * The server keeps no echo of a debug pick, and a refused one (a weapon the class is not trained in,
   * an Attribute shortfall) would stay selected: reset the selects the user changed, and the server
   * with them when it may have stored them. Nothing is ever sent for a pick the user did not change.
   */
  private resetRejectedDebugPick(msg: string): void {
    const pick = this.debugPick;
    if (!pick || !this.room) return;
    const me = this.room.players.find((p) => p.id === this.myId);
    const others = this.room.players.filter((p) => p !== me).map((p) => p.name);
    const { reset, resend } = debugReject(msg, pick.touched, others);
    if (!reset.loadout && !reset.melee && !reset.ranged) return;
    const start = CLASSES[pick.cls];
    if (reset.loadout) {
      pick.primary = start.primary;
      pick.secondary = start.secondary;
      pick.touched.loadout = false;
      if (resend.loadout) this.net.send({ t: 'DebugLoadout', primary: { ability: pick.primary, source: 'Own' }, secondary: { ability: pick.secondary, source: 'Own' } });
    }
    for (const [key, slot] of [['melee', 'Melee'], ['ranged', 'Ranged']] as const) {
      if (!reset[key]) continue;
      pick[key] = start.starter[key] as WeaponId | null;
      pick.touched[key] = false;
      if (resend[key]) this.net.send({ t: 'DebugEquip', slot, item: pick[key] });
    }
    this.render();
    const e = this.root.querySelector('.error');
    if (e) e.textContent = msg;
  }

  private render(): void {
    if (this.room) this.renderRoom();
    else this.renderHome();
  }

  private renderHome(): void {
    this.root.classList.remove('ui');
    const list = this.runs.length
      ? this.runs
          .map(
            (r) => `<li><span class="rname">${esc(r.name)}</span><span>${r.players}/${r.max_players}</span>
            ${r.started ? '<span class="tag">in progress</span>' : r.players >= r.max_players ? '<span class="tag">full</span>' : `<button data-join="${r.id}">Join</button>`}</li>`,
          )
          .join('')
      : '<li class="empty">No open dungeons. Create one!</li>';
    this.root.innerHTML = `
      ${logoHeader}
      <div class="panel hero"></div>
      <div class="panel">
        <h2>Dungeon runs</h2>
        <ul class="runs">${list}</ul>
        <div class="row"><input id="runname" maxlength="24" placeholder="Name your dungeon run"><button id="create">Open new run</button></div>
        <div class="error"></div>
      </div>`;
    const hero = this.root.querySelector('.hero')!;
    const c = this.character;
    if (c) {
      hero.classList.add(`c-${c.class.toLowerCase()}`);
      hero.append(classFigure(this.atlas, c.class, 3, figureWeapon(c)));
      const info = document.createElement('div');
      info.className = 'cinfo';
      info.innerHTML = `<small>Playing as</small><b>${esc(c.name)}</b><small>${className(c.class)}</small>`;
      hero.append(info);
    }
    const back = document.createElement('button');
    back.id = 'to-hub';
    back.textContent = '< Character';
    back.onclick = () => this.onBackToHub();
    hero.append(back);
    this.root.querySelector<HTMLButtonElement>('#create')!.onclick = () => {
      this.net.send({ t: 'CreateRun', name: this.root.querySelector<HTMLInputElement>('#runname')!.value });
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((b) => {
      b.onclick = () => this.net.send({ t: 'JoinRun', run_id: +b.dataset.join! });
    });
  }

  private renderRoom(): void {
    const room = this.room!;
    const me = room.players.find((p) => p.id === this.myId);
    const isHost = room.host === this.myId;
    this.root.classList.add('ui');
    const ch = this.character;
    // Your own row offers the pool while the sheet can still change (the host: until the run starts).
    const editable = !!me && !!ch && (isHost || !me.ready);
    const ability = (p: RoomPlayer, slot: 'Primary' | 'Secondary', key: string): string => {
      const pick = p.loadout[slot === 'Primary' ? 'primary' : 'secondary'];
      const icon = abilityIcon(pick.ability);
      if (!(editable && p.id === this.myId)) return `<span class="ui-abshow">${icon}<kbd>${key}</kbd>${esc(ABILITIES[pick.ability].name)}</span>`;
      const saved = ch!.loadout[slot === 'Primary' ? 'primary' : 'secondary'];
      const options = poolFor(ch!, slot)
        .filter((c) => !c.locked)
        .map((c) => `<option value='${esc(JSON.stringify(c.pick))}'${samePick(c.pick, saved) ? ' selected' : ''}>${esc(pickLabel(c.pick, ch!) + (c.error ? ` (${/needs /.test(c.error) ? c.error.slice(c.error.indexOf('needs ')) : c.error})` : ''))}</option>`)
        .join('');
      return `<span class="ui-abpick">${abilityIcon(saved.ability)}<kbd>${key}</kbd><select data-own="${slot}">${options}</select></span>`;
    };
    const players = room.players
      .map(
        (p) =>
          `<li class="c-${p.class.toLowerCase()}${p.id === this.myId ? ' me' : ''}"><span class="pn">${esc(p.name)}${p.id === room.host ? ' ★' : ''}</span><span class="pc">${className(p.class)}</span><span class="wp" data-id="${p.id}"></span>${ability(p, 'Primary', 'LMB')}${ability(p, 'Secondary', 'RMB')}<span class="${p.ready || p.id === room.host ? 'ok' : 'wait'}">${p.id === room.host ? 'host' : p.ready ? 'ready' : 'not ready'}</span></li>`,
      )
      .join('');
    this.root.innerHTML = `
      <h1>${esc(room.name)}</h1>
      <div class="panel ui-party"><h2>Party (${room.players.length}/4)</h2><ul class="players">${players}</ul></div>
      <div class="panel"><h2>End boss${isHost ? '' : ' (chosen by the host)'}</h2><div class="bosses"></div></div>
      ${me && debugOn() && (isHost || !me.ready) ? this.debugLoadoutRow(room.run_id, me.class) : ''}
      <div class="row actions">
        <button id="leave">Leave</button>
        ${isHost ? `<button id="start" class="primary">Enter the dungeon</button>` : `<button id="ready" class="primary">${me?.ready ? 'Not ready' : 'Ready!'}</button>`}
      </div>
      <div class="error"></div>`;
    for (const p of room.players) {
      const wp = this.root.querySelector(`.wp[data-id="${p.id}"]`)!;
      for (const w of p.weapons) wp.append(itemIcon(this.atlas, w, 28));
    }
    this.root.querySelectorAll<HTMLSelectElement>('[data-own]').forEach((sel) => {
      sel.onchange = () => {
        const get = (name: string): Pick => JSON.parse(this.root.querySelector<HTMLSelectElement>(`[data-own="${name}"]`)!.value) as Pick;
        const primary = get('Primary');
        const secondary = get('Secondary');
        this.net.send({ t: 'SetLoadout', primary, secondary });
        // A real SetLoadout clears the server's debug picks: the debug row shows the new abilities.
        const dbg = this.debugPick;
        if (dbg) {
          dbg.primary = primary.ability;
          dbg.secondary = secondary.ability;
          dbg.touched.loadout = false;
          for (const [slot, id] of [['primary', primary.ability], ['secondary', secondary.ability]] as const) {
            const d = this.root.querySelector<HTMLSelectElement>(`.debug-loadout [data-slot="${slot}"]`);
            if (d) d.value = id;
          }
        }
      };
    });
    const bosses = this.root.querySelector('.bosses')!;
    for (const b of [null, ...BOSSES]) {
      const card = document.createElement('button');
      card.className = `boss-card${room.boss === b ? ' selected' : ''}`;
      card.disabled = !isHost;
      if (b) {
        const [fig, filter, scale] = BOSS_FIG[b];
        const c = spritePreview(this.atlas, fig, scale);
        c.style.filter = filter;
        card.append(c);
      } else {
        const q = document.createElement('div');
        q.className = 'random';
        q.textContent = '?';
        card.append(q);
      }
      const info = document.createElement('div');
      info.innerHTML = b ? `<b>${BOSS_TEXT[b].short}</b><small>${BOSS_TEXT[b].blurb}</small>` : '<b>Random</b><small>A surprise at the end of the dungeon.</small>';
      card.append(info);
      if (isHost) card.onclick = () => this.net.send({ t: 'SelectBoss', boss: b });
      bosses.append(card);
    }
    this.root.querySelector<HTMLButtonElement>('#leave')!.onclick = () => {
      this.net.send({ t: 'LeaveRun' });
      this.leftRoom();
    };
    const start = this.root.querySelector<HTMLButtonElement>('#start');
    if (start) start.onclick = () => this.net.send({ t: 'StartRun' });
    const ready = this.root.querySelector<HTMLButtonElement>('#ready');
    if (ready) ready.onclick = () => this.net.send({ t: 'SetReady', ready: !me?.ready });
    this.root.querySelectorAll<HTMLSelectElement>('.debug-loadout select').forEach((sel) => {
      sel.onchange = () => {
        const pick = this.debugPick!;
        const slot = sel.dataset.slot;
        if (slot === 'melee' || slot === 'ranged') {
          const item = sel.value === '' ? null : (sel.value as WeaponId);
          pick[slot] = item;
          pick.touched[slot] = true;
          this.net.send({ t: 'DebugEquip', slot: slot === 'melee' ? 'Melee' : 'Ranged', item });
          return;
        }
        pick.touched.loadout = true;
        if (slot === 'primary') pick.primary = sel.value as AbilityId;
        else pick.secondary = sel.value as AbilityId;
        this.net.send({ t: 'DebugLoadout', primary: { ability: pick.primary, source: 'Own' }, secondary: { ability: pick.secondary, source: 'Own' } });
      };
    });
  }

  /** Debug: pickers for any primary and secondary of your class (`DebugLoadout`) and for its melee and ranged weapon (`DebugEquip`). */
  private debugLoadoutRow(run: number, cls: ClassId): string {
    if (!this.debugPick || this.debugPick.run !== run || this.debugPick.cls !== cls) {
      const lo = this.character?.class === cls ? this.character.loadout : null;
      this.debugPick = { run, cls, primary: lo?.primary.ability ?? CLASSES[cls].primary, secondary: lo?.secondary.ability ?? CLASSES[cls].secondary, melee: CLASSES[cls].starter.melee, ranged: CLASSES[cls].starter.ranged, touched: { loadout: false, melee: false, ranged: false } };
    }
    const pick = this.debugPick;
    const select = (slot: 'primary' | 'secondary', chosen: AbilityId) =>
      `<select data-slot="${slot}">${debugChoices(cls, slot === 'primary' ? 'Primary' : 'Secondary')
        .map((id) => `<option value="${id}"${id === chosen ? ' selected' : ''}>${ABILITIES[id].name}</option>`)
        .join('')}</select>`;
    // The starter is a plain choice (its item id); an empty value empties the slot (the Ranger's bow can go,
    // an empty melee slot falls back to the starter on the server).
    const weapon = (slot: 'melee' | 'ranged', chosen: WeaponId | null) => {
      const starter = CLASSES[cls].starter[slot];
      const options = debugWeapons(cls, slot === 'melee' ? 'Melee' : 'Ranged')
        .map((id) => `<option value="${id}"${id === chosen ? ' selected' : ''}>${ITEMS[id].name}${id === starter ? ' (starter)' : ''}</option>`)
        .join('');
      const empty = slot === 'ranged' ? `<option value=""${chosen === null ? ' selected' : ''}>(none)</option>` : '';
      return `<select data-slot="${slot}">${empty}${options}</select>`;
    };
    return `<div class="row debug-loadout"><small>Debug loadout</small>${select('primary', pick.primary)}${select('secondary', pick.secondary)}${weapon('melee', pick.melee)}${weapon('ranged', pick.ranged)}</div>`;
  }
}

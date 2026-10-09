import type { BossId } from '../generated/BossId';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { RoomPlayer } from '../generated/RoomPlayer';
import type { RunSummary } from '../generated/RunSummary';
import type { UpgradeStat } from '../generated/UpgradeStat';
import type { Net } from '../net';
import { spritePreview, type Atlas } from './atlas';
import { esc } from './hud';
import { classFigure } from './classes';
import { BOSS_TEXT, STAT_TEXT } from './text';

const BOSSES: BossId[] = ['Demon', 'Lich', 'Dragon'];
/** Pack figure, CSS filter approximating the in-game tint/hue (anim/defs.ts) and preview scale. */
const BOSS_FIG: Record<BossId, [string, string, number]> = {
  Demon: ['big_demon', '', 2],
  Lich: ['necromancer', '', 4],
  Dragon: ['lizard_m', 'hue-rotate(250deg)', 3],
};
const STATS: UpgradeStat[] = ['Damage', 'AttackSpeed', 'MoveSpeed', 'Life', 'Armor'];

type Room = { run_id: number; name: string; host: number; players: RoomPlayer[]; boss: BossId | null };

/** Debug mode only: `?debug&boss=demon|lich|dragon` preselects the end boss on the host's page. */
function debugBoss(): BossId | null {
  const q = new URLSearchParams(location.search);
  const b = q.has('debug') ? (q.get('boss') ?? '') : '';
  const id = b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
  return BOSSES.includes(id as BossId) ? (id as BossId) : null;
}

export class Lobby {
  private root = document.createElement('div');
  private runs: RunSummary[] = [];
  private room: Room | null = null;
  private character: CharacterInfo | null = null;
  /** Room the debug boss was already preselected in. */
  private preselected = 0;
  myId = 0;

  constructor(
    host: HTMLElement,
    private net: Net,
    private atlas: Atlas,
    /** Back to the character screen (only outside of rooms). */
    private onChangeCharacter: () => void,
  ) {
    this.root.className = 'lobby hidden';
    host.append(this.root);
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
    const e = this.root.querySelector('.error');
    if (e) e.textContent = msg;
  }

  private render(): void {
    if (this.room) this.renderRoom();
    else this.renderHome();
    this.bindUpgrades();
  }

  private upgradesPanel(): string {
    const p = this.character;
    if (!p) return '';
    const max = p.costs.length;
    const rows = STATS.map((s) => {
      const key = ({ Damage: 'damage', AttackSpeed: 'attack_speed', MoveSpeed: 'move_speed', Life: 'life', Armor: 'armor' } as const)[s];
      const level = p.upgrades[key];
      const cost = level < max ? p.costs[level] : null;
      const buy =
        cost === null
          ? '<button disabled>Max</button>'
          : `<button data-buy="${s}"${p.xp < cost ? ' disabled' : ''}>Buy ${cost} XP</button>`;
      return `<li><span class="sname">${STAT_TEXT[s].name}</span><span class="lvl">${level}/${max}</span><span class="bonus">${STAT_TEXT[s].bonus(p.mods)}</span>${buy}</li>`;
    }).join('');
    return `<div class="panel upgrades"><h2>Upgrades <span class="xp">${p.xp} XP <span class="coins"><i class="coin-icon"></i>${p.coins}</span></span></h2><ul class="stats">${rows}</ul>
      <small class="hint">Earn XP in the dungeon. Upgrades are permanent and belong to this character. Coins come from chests and mimics; they will buy loadouts later.</small></div>`;
  }

  private bindUpgrades(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
      b.onclick = () => this.net.send({ t: 'BuyUpgrade', stat: b.dataset.buy as UpgradeStat });
    });
  }

  private renderHome(): void {
    const list = this.runs.length
      ? this.runs
          .map(
            (r) => `<li><span class="rname">${esc(r.name)}</span><span>${r.players}/${r.max_players}</span>
            ${r.started ? '<span class="tag">in progress</span>' : r.players >= r.max_players ? '<span class="tag">full</span>' : `<button data-join="${r.id}">Join</button>`}</li>`,
          )
          .join('')
      : '<li class="empty">No open dungeons. Create one!</li>';
    this.root.innerHTML = `
      <h1>Tiny Adventurers</h1>
      <div class="panel hero"></div>
      <div class="panel">
        <h2>Dungeon runs</h2>
        <ul class="runs">${list}</ul>
        <div class="row"><input id="runname" maxlength="24" placeholder="Name your dungeon run"><button id="create">Open new run</button></div>
        <div class="error"></div>
      </div>
      ${this.upgradesPanel()}`;
    const hero = this.root.querySelector('.hero')!;
    const c = this.character;
    if (c) {
      hero.classList.add(`c-${c.class.toLowerCase()}`);
      hero.append(classFigure(this.atlas, c.class, 3));
      const info = document.createElement('div');
      info.className = 'cinfo';
      info.innerHTML = `<small>Playing as</small><b>${esc(c.name)}</b><small>${c.class}</small>`;
      hero.append(info);
    }
    const change = document.createElement('button');
    change.id = 'change-char';
    change.textContent = 'Change character';
    change.onclick = () => this.onChangeCharacter();
    hero.append(change);
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
    const players = room.players
      .map(
        (p) =>
          `<li class="c-${p.class.toLowerCase()}"><span>${esc(p.name)}${p.id === room.host ? ' ★' : ''}</span><span>${p.class}</span><span class="${p.ready || p.id === room.host ? 'ok' : 'wait'}">${p.id === room.host ? 'host' : p.ready ? 'ready' : 'not ready'}</span></li>`,
      )
      .join('');
    this.root.innerHTML = `
      <h1>${esc(room.name)}</h1>
      <div class="panel"><h2>Party (${room.players.length}/4)</h2><ul class="players">${players}</ul></div>
      <div class="panel"><h2>End boss${isHost ? '' : ' (chosen by the host)'}</h2><div class="bosses"></div></div>
      ${this.upgradesPanel()}
      <div class="row actions">
        <button id="leave">Leave</button>
        ${isHost ? `<button id="start" class="primary">Enter the dungeon</button>` : `<button id="ready" class="primary">${me?.ready ? 'Not ready' : 'Ready!'}</button>`}
      </div>
      <div class="error"></div>`;
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
  }
}

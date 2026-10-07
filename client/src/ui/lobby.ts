import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
import type { ProfileInfo } from '../generated/ProfileInfo';
import type { RoomPlayer } from '../generated/RoomPlayer';
import type { RunSummary } from '../generated/RunSummary';
import type { UpgradeStat } from '../generated/UpgradeStat';
import type { Net } from '../net';
import { spritePreview, type Atlas } from './atlas';
import { esc } from './hud';
import { BOSS_TEXT, CLASS_TEXT, STAT_TEXT } from './text';

const CLASSES: ClassId[] = ['Wizard', 'Paladin', 'Barbarian', 'Assassin'];
const FIG: Record<ClassId, [string, string]> = {
  Wizard: ['wizzard_m', 'weapon_red_magic_staff'],
  Paladin: ['knight_m', 'weapon_knight_sword'],
  Barbarian: ['dwarf_m', 'weapon_double_axe'],
  Assassin: ['elf_m', 'weapon_bow'],
};
const BOSSES: BossId[] = ['Demon', 'Lich', 'Dragon'];
/** Pack figure, CSS filter approximating the in-game tint/hue (anim/defs.ts) and preview scale. */
const BOSS_FIG: Record<BossId, [string, string, number]> = {
  Demon: ['big_demon', '', 2],
  Lich: ['necromancer', '', 4],
  Dragon: ['lizard_m', 'hue-rotate(250deg)', 3],
};
const STATS: UpgradeStat[] = ['Damage', 'AttackSpeed', 'MoveSpeed', 'Life', 'Armor'];

type Room = { run_id: number; name: string; host: number; players: RoomPlayer[]; boss: BossId | null };

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

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
  private profile: ProfileInfo | null = null;
  /** Room the debug boss was already preselected in. */
  private preselected = 0;
  myId = 0;

  constructor(
    host: HTMLElement,
    private net: Net,
    private atlas: Atlas,
  ) {
    this.root.className = 'lobby';
    host.append(this.root);
    // Always say hello: the server answers with our profile (and a token on first visit).
    this.hello(store('ta-name') ?? '');
    this.render();
  }

  private hello(name: string): void {
    this.net.send({ t: 'Hello', name, token: store('ta-token') });
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

  setProfile(p: ProfileInfo): void {
    this.profile = p;
    store('ta-token', p.token);
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
    const p = this.profile;
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
    return `<div class="panel upgrades"><h2>Upgrades <span class="xp">${p.xp} XP</span></h2><ul class="stats">${rows}</ul>
      <small class="hint">Earn XP in the dungeon. Upgrades are permanent and apply to every hero you play.</small></div>`;
  }

  private bindUpgrades(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
      b.onclick = () => this.net.send({ t: 'BuyUpgrade', stat: b.dataset.buy as UpgradeStat });
    });
  }

  private renderHome(): void {
    const name = store('ta-name') ?? '';
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
      <div class="panel">
        <label>Your name <input id="name" maxlength="16" value="${esc(name)}" placeholder="Adventurer"></label>
      </div>
      <div class="panel">
        <h2>Dungeon runs</h2>
        <ul class="runs">${list}</ul>
        <div class="row"><input id="runname" maxlength="24" placeholder="Name your dungeon run"><button id="create">Open new run</button></div>
        <div class="error"></div>
      </div>
      ${this.upgradesPanel()}`;
    const nameInput = this.root.querySelector<HTMLInputElement>('#name')!;
    nameInput.onchange = () => {
      store('ta-name', nameInput.value.trim());
      this.hello(nameInput.value.trim());
    };
    this.root.querySelector<HTMLButtonElement>('#create')!.onclick = () => {
      nameInput.onchange?.(new Event('change'));
      this.net.send({ t: 'CreateRun', name: this.root.querySelector<HTMLInputElement>('#runname')!.value });
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((b) => {
      b.onclick = () => {
        nameInput.onchange?.(new Event('change'));
        this.net.send({ t: 'JoinRun', run_id: +b.dataset.join! });
      };
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
      <div class="panel"><h2>Choose your class</h2><div class="classes"></div></div>
      <div class="panel"><h2>End boss${isHost ? '' : ' (chosen by the host)'}</h2><div class="bosses"></div></div>
      ${this.upgradesPanel()}
      <div class="row actions">
        <button id="leave">Leave</button>
        ${isHost ? `<button id="start" class="primary">Enter the dungeon</button>` : `<button id="ready" class="primary">${me?.ready ? 'Not ready' : 'Ready!'}</button>`}
      </div>
      <div class="error"></div>`;
    const classes = this.root.querySelector('.classes')!;
    for (const c of CLASSES) {
      const t = CLASS_TEXT[c];
      const card = document.createElement('button');
      card.className = `class-card c-${c.toLowerCase()}${me?.class === c ? ' selected' : ''}`;
      card.append(spritePreview(this.atlas, FIG[c][0], 4, FIG[c][1]));
      const info = document.createElement('div');
      info.innerHTML = `<b>${t.title}</b><small>${t.blurb}</small>
        <p><kbd>LMB</kbd> ${t.abilities[0].name}<br><span>${t.abilities[0].text}</span></p>
        <p><kbd>RMB</kbd> ${t.abilities[1].name}<br><span>${t.abilities[1].text}</span></p>`;
      card.append(info);
      card.onclick = () => this.net.send({ t: 'SelectClass', class: c });
      classes.append(card);
    }
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

import { ABILITIES, EFFECT, EFFECTS, FLAG } from '../generated/defs';
import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
import type { LevelId } from '../generated/LevelId';
import type { PlayerStats } from '../generated/PlayerStats';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Snapshot } from '../generated/Snapshot';
import { CooldownTracker } from './cooldown';
import { endText } from './endText';
import { BOSS_TEXT, className } from './text';
import { effectIconSvg } from './effectIcons';
import { SettingsView, type Toggle } from './settings';

export interface FrameStats {
  fps: number;
  frameMs: number;
  rtt: number;
  jitter: number;
  interp: number;
  snapBytes: number;
  correction: number;
  srvMs: number;
  cd1: number;
  cd2: number;
  ents: number;
  /** The viewed hero's darkvision, 0..1. */
  darkvision: number;
  /** Whether the hero has a living wolf; null when the secondary is not Summon Wolf. */
  wolf: boolean | null;
}

/** The secondary slot's name: the ranger's reads by whether the wolf lives. */
export function secondaryLabel(wolf: boolean | null, base: string): string {
  return wolf === null ? base : wolf ? 'Heal Wolf' : 'Summon Wolf';
}

/** The help line's keys and what they do; each key is drawn as a key cap. */
export const HELP_KEYS: [keys: string[], label: string][] = [
  [['WASD'], 'move'],
  [['LMB', 'RMB'], 'attack'],
  [['L'], 'log'],
  [['Esc'], 'menu'],
  [['F3'], 'stats'],
];

/** The in-run debug keys (debug runs, i.e. debug accounts), listed on the debug badge. */
export const DEBUG_KEYS: [key: string, label: string][] = [
  ['F4', 'darkvision 0/50/100 %'],
  ['F8', 'next effect on you'],
  ['F9', 'immortal on/off'],
];

/** The debug paths drawn in the dungeon and their colours (`GameScene.drawPathLine`). */
const DEBUG_PATHS: [colour: string, label: string][] = [
  ['#ffe040', 'path to the boss'],
  ['#40a0ff', 'path to the ogre'],
];

/** The debug badge: the immortality state, then one row per debug key and per path colour. */
export function debugBadgeHtml(immortal: boolean): string {
  const keys = DEBUG_KEYS.map(([k, l]) => `<div class="db-row"><kbd>${k}</kbd><span>${l}</span></div>`).join('');
  const paths = DEBUG_PATHS.map(([c, l]) => `<div class="db-row"><i class="db-swatch" style="background:${c}"></i><span>${l}</span></div>`).join('');
  return `<div class="db-title${immortal ? '' : ' mortal'}">DEBUG · ${immortal ? 'immortal' : 'MORTAL'}</div>${keys}${paths}`;
}

export function helpHtml(): string {
  return HELP_KEYS.map(([keys, label]) => `<span>${keys.map((k) => `<kbd>${k}</kbd>`).join('')}${label}</span>`).join('');
}

const el = (tag: string, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class Hud {
  private root = el('div', 'hud hidden');
  private hp = el('div', 'hp-bar');
  private hpFill = el('div', 'fill');
  private hpText = el('span');
  private fx = el('div', 'effects');
  private fxKey = '';
  private coins = el('div', 'coins');
  private coinCount = 0;
  private slots: HTMLElement[] = [];
  /** The equipped abilities' names, and until when (ms) each slot reads "Too close". */
  private slotNames = ['', ''];
  private tooCloseUntil = [0, 0];
  private party = el('div', 'party');
  private boss = el('div', 'boss hidden');
  private msgs = el('div', 'messages');
  private debug = el('pre', 'debug hidden');
  private banner = el('div', 'banner hidden');
  /** A panel above the HP bar while the own hero is asleep. */
  private statusHint = el('div', 'status-hint hidden', `${effectIconSvg(EFFECT.Sleep, 14)}Asleep. A teammate can wake you <kbd>E</kbd>`);
  private asleep = false;
  private menu = el('div', 'menu hidden');
  private end = el("div", "end hidden");
  private debugBadge = el("div", "debug-badge hidden", debugBadgeHtml(true));
  private trackers = [new CooldownTracker(), new CooldownTracker()];
  private debugT = 0;
  menuOpen = false;
  private toggles: Toggle[] = [];
  private view!: SettingsView;
  private inSettings = false;

  constructor(
    host: HTMLElement,
    private onLeave: () => void,
    private onBack: () => void,
  ) {
    const bottom = el('div', 'bottom');
    this.hp.append(this.hpFill, this.hpText);
    const abil = el('div', 'abilities');
    for (let i = 0; i < 2; i++) {
      const s = el('div', 'slot');
      s.append(el('div', 'ring'), el('span', 'cd'), el('div', 'key', i === 0 ? 'LMB' : 'RMB'), el('div', 'name'));
      this.slots.push(s);
      abil.append(s);
    }
    const hpCol = el('div', 'hp-col');
    hpCol.append(this.statusHint, this.hp, this.fx);
    bottom.append(hpCol, this.coins, abil);
    this.menu.append(el('div', 'title', 'Paused'), el('p', '', 'The dungeon keeps going while this is open.'));
    const leave = el('button', 'danger', 'Leave dungeon');
    leave.onclick = () => {
      this.toggleMenu();
      this.onLeave();
    };
    const resume = el('button', 'primary', 'Resume');
    resume.onclick = () => this.toggleMenu();
    const settings = el('button', '', 'Settings');
    settings.onclick = () => this.showSettings(true);
    this.menu.append(resume, settings, leave);
    this.buildView();
    this.root.append(this.party, this.boss, this.msgs, this.banner, bottom, this.debug, this.debugBadge, this.menu, this.end);
    this.root.append(el('div', 'help', helpHtml()));
    host.append(this.root);
  }

  /** The switches of the Settings view (the Hud adds Network stats last). */
  setToggles(t: Toggle[]): void {
    this.toggles = t;
    this.buildView();
  }

  private buildView(): void {
    const net: Toggle = { label: 'Network stats', key: 'F3', get: () => !this.debug.classList.contains('hidden'), set: (on) => this.debug.classList.toggle('hidden', !on) };
    const old = this.view?.root;
    this.view = new SettingsView([...this.toggles, net], () => this.showSettings(false));
    this.view.root.hidden = !this.inSettings;
    if (old) old.replaceWith(this.view.root);
    else this.menu.append(this.view.root);
  }

  private showSettings(on: boolean): void {
    this.inSettings = on;
    this.menu.classList.toggle('in-settings', on);
    this.view.root.hidden = !on;
    if (on) this.view.sync();
  }

  startRun(info: RunStartInfo): void {
    this.root.classList.remove('hidden');
    this.end.classList.add('hidden');
    this.debugBadge.classList.add("hidden");
    this.boss.classList.add('hidden');
    this.banner.classList.add('hidden');
    this.setAsleep(false);
    this.msgs.innerHTML = '';
    this.fx.innerHTML = '';
    this.fxKey = '';
    this.coinCount = 0;
    this.showCoins();
    [0, 1].forEach((i) => {
      this.slotNames[i] = ABILITIES[info.abilities[i].id].name;
      this.tooCloseUntil[i] = 0;
      this.slots[i].querySelector('.name')!.textContent = this.slotNames[i];
      this.trackers[i] = new CooldownTracker(info.abilities[i].cooldown);
      this.slots[i].classList.remove('flash');
    });
    this.party.innerHTML = '';
    for (const p of info.players) {
      const row = el('div', `member c-${p.class.toLowerCase()}`);
      row.dataset.ent = String(p.ent);
      const pname = el('span', 'pname');
      pname.textContent = p.name;
      if (p.ent === info.you) {
        const you = el('em');
        you.textContent = ' (you)';
        pname.append(you);
      }
      row.append(pname, el('div', 'mini'), el('div', 'pfx'));
      row.querySelector('.mini')!.append(el('div', 'fill'));
      this.party.append(row);
    }
  }

  /** Coins found this run (the whole party gets each find). */
  addCoins(v: number): void {
    this.coinCount += v;
    this.showCoins();
    this.coins.classList.remove('gain');
    void this.coins.offsetWidth; // restart the pop animation
    this.coins.classList.add('gain');
  }

  private showCoins(): void {
    this.coins.innerHTML = `<i class="coin-icon"></i>${this.coinCount}`;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  snapshot(s: Snapshot, info: RunStartInfo): void {
    const pct = Math.max(0, s.me.hp / s.me.max_hp);
    this.hpFill.style.width = `${pct * 100}%`;
    this.hpText.textContent = `${Math.ceil(s.me.hp)} / ${Math.round(s.me.max_hp)}`;
    this.hp.classList.toggle('low', pct < 0.3);
    this.showEffects(s.me.effects);
    for (const e of s.ents) {
      const row = this.party.querySelector<HTMLElement>(`[data-ent="${e[0]}"]`);
      if (!row) continue;
      const dead = (e[8] & FLAG.DEAD) !== 0;
      row.classList.toggle('dead', dead);
      (row.querySelector('.mini .fill') as HTMLElement).style.width = `${dead ? 0 : (e[4] / 255) * 100}%`;
      const pfx = row.querySelector<HTMLElement>('.pfx')!;
      if (pfx.dataset.bits !== String(e[10])) {
        pfx.dataset.bits = String(e[10]);
        pfx.innerHTML = Object.keys(EFFECTS)
          .map(Number)
          .filter((id) => (e[10] & (1 << id)) !== 0)
          .map((id) => `<span class="fx ${EFFECTS[id].positive ? 'pos' : 'neg'}">${effectIconSvg(id, 11)}</span>`)
          .join('');
      }
    }
    if (s.boss) {
      this.boss.classList.remove('hidden');
      const tags = `${s.boss.immune ? '<b class="chip immune">Immune</b>' : ''}${s.boss.enraged ? '<b class="chip enraged">Enraged</b>' : ''}`;
      this.boss.innerHTML = `<div class="bname">${BOSS_TEXT[s.boss.kind].name} ${tags}</div><div class="bbar"><div class="fill" style="width:${(s.boss.hp / s.boss.max_hp) * 100}%"></div></div>`;
    }
    if (!s.me.alive) {
      const watched = info.players.find((p) => p.ent === s.me.spectating)?.name;
      this.banner.classList.remove('hidden');
      this.banner.textContent = watched ? `You are dead — watching ${watched} (Q / E)` : 'You are dead';
    }
  }

  /** Own effect icons with the whole seconds left; rebuilt only when kinds or seconds change. */
  private showEffects(list: [number, number][]): void {
    const rows = list.map(([k, left]) => [k, Math.ceil(left)] as const);
    const key = rows.map((r) => r.join(':')).join(',');
    if (key === this.fxKey) return;
    this.fxKey = key;
    this.fx.innerHTML = rows
      .map(([k, t]) => `<span class="fx ${EFFECTS[k]?.positive ? 'pos' : 'neg'}">${effectIconSvg(k, 14)}<i>${t}</i></span>`)
      .join('');
  }

  /** A ranged ability used in melee: the slot reads "Too close" for 0.8 s. */
  tooClose(slot: 0 | 1): void {
    this.tooCloseUntil[slot] = performance.now() + 800;
  }

  frame(f: FrameStats): void {
    if (this.inSettings) this.view.sync();
    const now = performance.now();
    [0, 1].forEach((i) => {
      const name = this.slots[i].querySelector('.name')!;
      const label = now < this.tooCloseUntil[i] ? 'Too close' : i === 1 ? secondaryLabel(f.wolf, this.slotNames[1]) : this.slotNames[0];
      if (name.textContent !== label) name.textContent = label;
      this.slots[i].classList.toggle('too-close', now < this.tooCloseUntil[i]);
    });
    [f.cd1, f.cd2].forEach((cd, i) => {
      const { view, flash } = this.trackers[i].update(cd);
      const slot = this.slots[i];
      slot.style.setProperty('--p', `${view.fill * 100}%`);
      const cdEl = slot.querySelector('.cd')!;
      if (cdEl.textContent !== view.label) cdEl.textContent = view.label;
      slot.classList.toggle('ready', view.ready);
      if (flash) {
        slot.classList.remove('flash');
        void slot.offsetWidth;
        slot.classList.add('flash');
      }
    });
    if (!this.debug.classList.contains('hidden') && performance.now() - this.debugT > 200) {
      this.debugT = performance.now();
      this.debug.textContent =
        `FPS        ${f.fps.toFixed(0)}\n` +
        `frame      ${f.frameMs.toFixed(2)} ms\n` +
        `ping       ${f.rtt.toFixed(0)} ms\n` +
        `jitter     ${f.jitter.toFixed(1)} ms\n` +
        `interp     ${f.interp.toFixed(0)} ms\n` +
        `snapshot   ${f.snapBytes} B\n` +
        `correction ${f.correction.toFixed(2)} px\n` +
        `server     ${f.srvMs.toFixed(2)} ms/tick\n` +
        `entities   ${f.ents}\n` +
        `darkvision ${Math.round(f.darkvision * 100)}%`;
    }
  }

  /** Shows (or hides) the panel above the HP bar that tells the own hero is asleep. */
  setAsleep(on: boolean): void {
    if (on === this.asleep) return;
    this.asleep = on;
    this.statusHint.classList.toggle('hidden', !on);
  }

  message(text: string, kind: 'game' | 'notice' = 'notice'): void {
    const m = el('div', `msg ${kind}`);
    m.textContent = text;
    this.msgs.append(m);
    setTimeout(() => m.classList.add('fade'), 3000);
    setTimeout(() => m.remove(), 4000);
    while (this.msgs.children.length > 4) this.msgs.firstChild?.remove();
  }

  /** `on` changed: announce debug mode; `immortal` changed while on: the server announces it to the party. */
  setDebug(on: boolean, immortal: boolean, announce: boolean): void {
    this.debugBadge.classList.toggle("hidden", !on);
    this.debugBadge.innerHTML = debugBadgeHtml(immortal);
    if (announce) this.message(on ? "Debug mode on: immortal (F9 toggles), paths to the boss (yellow) and the ogre (blue) shown." : "Debug mode off.");
  }

  toggleDebug(): void {
    this.debug.classList.toggle('hidden');
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    this.menu.classList.toggle('hidden', !this.menuOpen);
    if (!this.menuOpen) {
      this.showSettings(false);
      // A hidden focused checkbox or button must not react to Space during play.
      const active = document.activeElement as HTMLElement | null;
      if (active && this.menu.contains(active)) active.blur();
    }
  }

  showEnd(m: { victory: boolean; level: LevelId; boss: BossId | null; time: number; stats: PlayerStats[] }): void {
    const mins = Math.floor(m.time / 60);
    const secs = Math.floor(m.time % 60).toString().padStart(2, '0');
    const rows = m.stats
      .map(
        (s) =>
          `<tr class="${s.alive ? '' : 'dead'}"><td>${esc(s.name)}</td><td>${className(s.class)}</td><td>${s.kills}</td><td>${Math.round(s.damage)}</td><td>${Math.round(s.healing)}</td><td>${s.xp}</td><td>${s.coins}</td></tr>`,
      )
      .join('');
    this.end.innerHTML = `
      <div class="title ${m.victory ? 'win' : 'lose'}">${m.victory ? 'VICTORY' : 'DEFEAT'}</div>
      <p>${endText(m.victory, m.level, m.boss)} Time ${mins}:${secs}</p>
      <table><tr><th>Hero</th><th>Class</th><th>Kills</th><th>Damage</th><th>Healing</th><th>XP</th><th>Coins</th></tr>${rows}</table>
      <p class="note">Your XP and coins were added to your profile. Spend XP on Attributes and the skill tree in the lobby.</p>`;
    const back = el('button', '', 'Back to lobby');
    back.onclick = () => this.onBack();
    this.end.append(back);
    this.end.classList.remove('hidden');
  }
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export type { ClassId };

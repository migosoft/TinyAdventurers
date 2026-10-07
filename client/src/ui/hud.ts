import { ABILITIES, CLASSES, FLAG } from '../generated/defs';
import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
import type { PlayerStats } from '../generated/PlayerStats';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Snapshot } from '../generated/Snapshot';
import { BOSS_TEXT, CLASS_TEXT } from './text';

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
  private coins = el('div', 'coins');
  private coinCount = 0;
  private slots: HTMLElement[] = [];
  private party = el('div', 'party');
  private boss = el('div', 'boss hidden');
  private msgs = el('div', 'messages');
  private debug = el('pre', 'debug hidden');
  private banner = el('div', 'banner hidden');
  private menu = el('div', 'menu hidden');
  private end = el("div", "end hidden");
  private debugBadge = el("div", "debug-badge hidden", "DEBUG · immortal · path to boss");
  private cdMax = [1, 1];
  private lastCd = [0, 0];
  private debugT = 0;
  menuOpen = false;

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
      s.append(el('div', 'sweep'), el('div', 'key', i === 0 ? 'LMB' : 'RMB'), el('div', 'name'));
      this.slots.push(s);
      abil.append(s);
    }
    bottom.append(this.hp, this.coins, abil);
    this.menu.append(el('div', 'title', 'Paused menu'), el('p', '', 'The dungeon keeps going while this is open.'));
    const leave = el('button', '', 'Leave dungeon');
    leave.onclick = () => {
      this.toggleMenu();
      this.onLeave();
    };
    const resume = el('button', '', 'Resume');
    resume.onclick = () => this.toggleMenu();
    this.menu.append(resume, leave);
    this.root.append(this.party, this.boss, this.msgs, this.banner, bottom, this.debug, this.debugBadge, this.menu, this.end);
    this.root.append(el('div', 'help', 'WASD move · LMB/RMB attack · Esc menu · F3 stats'));
    host.append(this.root);
  }

  startRun(info: RunStartInfo): void {
    this.root.classList.remove('hidden');
    this.end.classList.add('hidden');
    this.debugBadge.classList.add("hidden");
    this.boss.classList.add('hidden');
    this.banner.classList.add('hidden');
    this.msgs.innerHTML = '';
    this.coinCount = 0;
    this.showCoins();
    const me = info.players.find((p) => p.ent === info.you)!;
    const c = CLASSES[me.class];
    const names = [c.primary, c.secondary] as (keyof typeof ABILITIES)[];
    names.forEach((n, i) => {
      this.slots[i].querySelector('.name')!.textContent = CLASS_TEXT[me.class].abilities[i].name;
      this.cdMax[i] = ABILITIES[n].cooldown;
    });
    this.party.innerHTML = '';
    for (const p of info.players) {
      const row = el('div', `member c-${p.class.toLowerCase()}`);
      row.dataset.ent = String(p.ent);
      row.append(el('span', 'pname', `${p.name}${p.ent === info.you ? ' (you)' : ''}`), el('div', 'mini'));
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
    for (const e of s.ents) {
      const row = this.party.querySelector<HTMLElement>(`[data-ent="${e[0]}"]`);
      if (!row) continue;
      const dead = (e[8] & FLAG.DEAD) !== 0;
      row.classList.toggle('dead', dead);
      (row.querySelector('.mini .fill') as HTMLElement).style.width = `${dead ? 0 : (e[4] / 255) * 100}%`;
    }
    if (s.boss) {
      this.boss.classList.remove('hidden');
      const tags = `${s.boss.immune ? '<b class="immune">IMMUNE</b>' : ''}${s.boss.enraged ? '<b class="enraged">ENRAGED</b>' : ''}`;
      this.boss.innerHTML = `<div class="bname">${BOSS_TEXT[s.boss.kind].name} ${tags}</div><div class="bbar"><div class="fill" style="width:${(s.boss.hp / s.boss.max_hp) * 100}%"></div></div>`;
    }
    if (!s.me.alive) {
      const watched = info.players.find((p) => p.ent === s.me.spectating)?.name;
      this.banner.classList.remove('hidden');
      this.banner.textContent = watched ? `You are dead — watching ${watched} (Q / E)` : 'You are dead';
    }
  }

  frame(f: FrameStats): void {
    [f.cd1, f.cd2].forEach((cd, i) => {
      if (cd > this.lastCd[i] + 0.01) this.cdMax[i] = cd;
      this.lastCd[i] = cd;
      const k = cd > 0 ? cd / this.cdMax[i] : 0;
      const sw = this.slots[i].querySelector('.sweep') as HTMLElement;
      sw.style.background = k > 0 ? `conic-gradient(rgba(10,6,18,.75) ${k * 360}deg, transparent 0)` : 'transparent';
      this.slots[i].classList.toggle('ready', k === 0);
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
        `entities   ${f.ents}`;
    }
  }

  message(text: string): void {
    const m = el('div', 'msg', text);
    this.msgs.append(m);
    setTimeout(() => m.classList.add('fade'), 3000);
    setTimeout(() => m.remove(), 4000);
    while (this.msgs.children.length > 4) this.msgs.firstChild?.remove();
  }

  setDebug(on: boolean): void {
    this.debugBadge.classList.toggle("hidden", !on);
    this.message(on ? "Debug mode on: immortal, path to the boss shown." : "Debug mode off.");
  }

  toggleDebug(): void {
    this.debug.classList.toggle('hidden');
  }

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
    this.menu.classList.toggle('hidden', !this.menuOpen);
  }

  showEnd(m: { victory: boolean; boss: BossId; time: number; stats: PlayerStats[]; banked: boolean }): void {
    const mins = Math.floor(m.time / 60);
    const secs = Math.floor(m.time % 60).toString().padStart(2, '0');
    const rows = m.stats
      .map(
        (s) =>
          `<tr class="${s.alive ? '' : 'dead'}"><td>${esc(s.name)}</td><td>${s.class}</td><td>${s.kills}</td><td>${Math.round(s.damage)}</td><td>${Math.round(s.healing)}</td><td>${s.xp}</td><td>${s.coins}</td></tr>`,
      )
      .join('');
    this.end.innerHTML = `
      <div class="title ${m.victory ? 'win' : 'lose'}">${m.victory ? 'VICTORY' : 'DEFEAT'}</div>
      <p>${m.victory ? `${BOSS_TEXT[m.boss].name} has been slain.` : 'The dungeon claims another party.'} Time ${mins}:${secs}</p>
      <table><tr><th>Hero</th><th>Class</th><th>Kills</th><th>Damage</th><th>Healing</th><th>XP</th><th>Coins</th></tr>${rows}</table>
      <p class="note">${m.banked ? 'Your XP and coins were added to your profile. Spend XP on upgrades in the lobby.' : 'Debug mode was used: no XP or coins were added to the profiles.'}</p>`;
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

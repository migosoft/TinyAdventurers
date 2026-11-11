import { ABILITIES, EFFECT, EFFECTS, FLAG } from '../generated/defs';
import type { Attr } from '../generated/Attr';
import type { BossId } from '../generated/BossId';
import type { ClassId } from '../generated/ClassId';
import type { LevelId } from '../generated/LevelId';
import type { PlayerStats } from '../generated/PlayerStats';
import type { ResolvedAbility } from '../generated/ResolvedAbility';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { ServerMsg } from '../generated/ServerMsg';
import type { Snapshot } from '../generated/Snapshot';
import { ITEMS, TREES } from '../generated/progression';
import type { ItemId } from '../generated/ItemId';
import type { NodeId } from '../generated/NodeId';
import { CooldownTracker } from './cooldown';
import { endText } from './endText';
import { BOSS_TEXT, className, needsText } from './text';
import { DRAIN_TEXT, effectIconSvg } from './effectIcons';
import { SettingsView, type Toggle } from './settings';
import { CharmView, charmLeft } from './charmView';

export interface FrameStats {
  fps: number;
  /** The whole frame: Phaser's step from `PRE_STEP` to `POST_RENDER`, ms. */
  wholeMs: number;
  /** Its render part, ms. */
  renderMs: number;
  /** `RunSession.frame`, ms. */
  frameMs: number;
  /** The client's systems inside `update`, ms each (`FrameTimer`). */
  systems: readonly (readonly [name: string, ms: number])[];
  /** The scene's display list size. */
  objects: number;
  /** WebGL draw calls of the last frame. */
  drawCalls: number;
  /** The canvas's pixel size and its CSS upscale (above 1 only with `?res=world`, #295). */
  canvas: { w: number; h: number; cssZoom: number };
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

/** The F3 panel's text: frame timings with the per-system breakdown, then the network figures. */
export function statsText(f: FrameStats): string {
  const ms = (v: number) => `${v.toFixed(2)} ms`;
  return (
    `FPS        ${f.fps.toFixed(0)}\n` +
    `frame      ${ms(f.wholeMs)}\n` +
    `render     ${ms(f.renderMs)}\n` +
    `update     ${ms(f.frameMs)}\n` +
    f.systems.map(([name, v]) => `  ${name.padEnd(9)}${v.toFixed(2)}\n`).join('') +
    `objects    ${f.objects}\n` +
    `draw calls ${f.drawCalls}\n` +
    `canvas     ${f.canvas.w}x${f.canvas.h}${f.canvas.cssZoom === 1 ? '' : ` x${f.canvas.cssZoom} css`}\n` +
    `ping       ${f.rtt.toFixed(0)} ms\n` +
    `jitter     ${f.jitter.toFixed(1)} ms\n` +
    `interp     ${f.interp.toFixed(0)} ms\n` +
    `snapshot   ${f.snapBytes} B\n` +
    `correction ${f.correction.toFixed(2)} px\n` +
    `server     ${f.srvMs.toFixed(2)} ms/tick\n` +
    `entities   ${f.ents}\n` +
    `darkvision ${Math.round(f.darkvision * 100)}%`
  );
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
  ['F7', 'nearest enemy incorporeal'],
  ['F8', 'next effect on you'],
  ['Shift+F7', 'anti-magic on/off'],
  ['Shift+F8', 'dispel on you'],
  ['F9', 'immortal on/off'],
];

/** The debug paths drawn in the dungeon and their colours (`PhaserRunView.drawPathLine`). */
const DEBUG_PATHS: [colour: string, label: string][] = [
  ['#ffe040', 'path to the boss'],
  ['#40a0ff', 'path to the ogre'],
  ['#40e070', 'path to the cove'],
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

/** Per slot, the Attribute requirement that disables the pick during a run (`HeroChanged`), or null. */
export type Disabled = Extract<ServerMsg, { t: 'HeroChanged' }>['disabled'];

export class Hud {
  private root = el('div', 'hud hidden');
  private hp = el('div', 'hp-bar');
  private hpFill = el('div', 'fill');
  private hpText = el('span');
  private fx = el('div', 'effects');
  private fxKey = '';  // the shown icons' kinds, seconds, amounts, paused flags and chip ids
  private coins = el('div', 'coins');
  private coinCount = 0;
  private slots: HTMLElement[] = [];
  /** The equipped abilities' names, and each slot's hint (it replaces the name until `until`, ms). */
  private slotNames = ['', ''];
  private hint = [{ text: '', until: 0 }, { text: '', until: 0 }];
  private party = el('div', 'party');
  /** The charmed player's view (mockup B), behind the rest of the HUD. */
  private charm!: CharmView;
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
  /** The ability id in each slot, so a running cooldown survives a HeroChanged that did not change it. */
  private slotIds: (string | null)[] = [null, null];
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
    this.charm = new CharmView(this.root);
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
    this.charm.update(null, 0);
    for (const slot of this.slots) slot.querySelector('.charm-heart')?.remove();
    this.msgs.innerHTML = '';
    this.fx.innerHTML = '';
    this.fxKey = '';
    this.coinCount = 0;
    this.showCoins();
    [0, 1].forEach((i) => {
      this.slotNames[i] = ABILITIES[info.abilities[i].id].name;
      this.hint[i].until = 0;
      this.slots[i].removeAttribute('title');
      this.slots[i].querySelector('.name')!.textContent = this.slotNames[i];
      this.trackers[i] = new CooldownTracker(info.abilities[i].cooldown);
      this.slotIds[i] = info.abilities[i].id;
      this.slots[i].classList.remove('flash', 'disabled');
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
    this.showEffects(s.me.effects, s.me.paused_items, s.me.paused_nodes);
    // Shown only while the charm is on the hero (a paused charm shows nothing).
    const by = s.me.charmed_by ?? null;
    this.charm.update(by, charmLeft(s.me.effects));
    for (const slot of this.slots) {
      const heart = slot.querySelector('.charm-heart');
      if (by !== null && !heart) slot.append(el('div', 'charm-heart', effectIconSvg(EFFECT.Charmed, 26)));
      else if (by === null && heart) heart.remove();
    }
    for (const e of s.ents) {
      const row = this.party.querySelector<HTMLElement>(`[data-ent="${e[0]}"]`);
      if (!row) continue;
      const dead = (e[8] & FLAG.DEAD) !== 0;
      row.classList.toggle('dead', dead);
      (row.querySelector('.mini .fill') as HTMLElement).style.width = `${dead ? 0 : (e[4] / 255) * 100}%`;
      // Charmed: the name turns pink with a heart (the heart is the effect icon, as over the head and in the slots).
      const charmed = (e[10] & (1 << EFFECT.Charmed)) !== 0;
      if (row.classList.contains('charmed') !== charmed) {
        row.classList.toggle('charmed', charmed);
        const pname = row.querySelector<HTMLElement>('.pname')!;
        pname.querySelector('.pheart')?.remove();
        if (charmed) pname.prepend(el('span', 'pheart', effectIconSvg(EFFECT.Charmed, 12)));
      }
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
      const tags = `${s.boss.immune ? '<b class="chip immune">Immune</b>' : ''}`;
      this.boss.innerHTML = `<div class="bname">${BOSS_TEXT[s.boss.kind].name} ${tags}</div><div class="bbar"><div class="fill" style="width:${(s.boss.hp / s.boss.max_hp) * 100}%"></div></div>`;
    }
    if (!s.me.alive) {
      const watched = info.players.find((p) => p.ent === s.me.spectating)?.name;
      this.banner.classList.remove('hidden');
      this.banner.textContent = watched ? `You are dead — watching ${watched} (Q / E)` : 'You are dead';
    }
  }

  /** Own effect icons and paused-source chips; the DOM is rebuilt only when the markup would change. */
  private showEffects(list: Snapshot['me']['effects'], items: ItemId[], nodes: NodeId[]): void {
    const rows = effectRows(list);
    const key = `${rows.map((r) => r.join(':')).join(',')}|${items.join(',')}|${nodes.join(',')}`;
    if (key === this.fxKey) return;
    this.fxKey = key;
    this.fx.innerHTML = effectsRowHtml(rows, items, nodes);
  }

  /** The equipped abilities changed (an Attribute drain started or ended): names, cooldowns, greyed slots. */
  setAbilities(abilities: readonly ResolvedAbility[], disabled: Disabled): void {
    [0, 1].forEach((i) => {
      this.slotNames[i] = ABILITIES[abilities[i].id].name;
      this.slots[i].querySelector('.name')!.textContent = this.slotNames[i];
      if (this.slotIds[i] !== abilities[i].id) {
        this.trackers[i] = new CooldownTracker(abilities[i].cooldown);
        this.slotIds[i] = abilities[i].id;
      }
      const need = disabled[i];
      this.slots[i].classList.toggle('disabled', need !== null);
      if (need) this.slots[i].title = needsText(need);
      else this.slots[i].removeAttribute('title');
    });
  }

  /** A ranged ability used in melee: the slot reads "Too close" for 0.8 s. */
  tooClose(slot: 0 | 1): void {
    this.showHint(slot, 'Too close');
  }

  /** A press on a slot an Attribute drain disabled: the slot reads what it needs ("Needs DEX 14") for 0.8 s. */
  needs(slot: 0 | 1, req: [Attr, number]): void {
    this.showHint(slot, needsText(req));
  }

  private showHint(slot: 0 | 1, text: string): void {
    this.hint[slot] = { text, until: performance.now() + 800 };
  }

  frame(f: FrameStats): void {
    if (this.inSettings) this.view.sync();
    const now = performance.now();
    [0, 1].forEach((i) => {
      const name = this.slots[i].querySelector('.name')!;
      const hint = now < this.hint[i].until;
      const label = hint ? this.hint[i].text : i === 1 ? secondaryLabel(f.wolf, this.slotNames[1]) : this.slotNames[0];
      if (name.textContent !== label) name.textContent = label;
      this.slots[i].classList.toggle('hint', hint);
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
      this.debug.textContent = statsText(f);
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
    if (announce) this.message(on ? "Debug mode on: immortal (F9 toggles), paths to the boss (yellow), the ogre (blue) and the cove (green) shown." : "Debug mode off.");
  }

  toggleDebug(): void {
    this.debug.classList.toggle('hidden');
  }

  /** Whether the F3 panel is open (the scene times its frame only then). */
  get statsOn(): boolean {
    return !this.debug.classList.contains('hidden');
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

/** One own-effect chip: the glyph, the whole seconds left, and for an Attribute drain the amount (`−2`) with a tooltip. */
export function effectChipHtml(k: number, left: number, amount: number, paused = false): string {
  const drain = DRAIN_TEXT[k];
  const rate = EFFECTS[k]?.cd_rate ?? 1;
  const tip = drain && amount !== 0
    ? ` title="${drain.name} (${drain.attr} \u2212${Math.abs(amount)})"`
    : rate !== 1
      ? ` title="cooldowns ${Math.round(Math.abs(rate - 1) * 100)} % ${rate > 1 ? 'faster' : 'slower'}"`
      : '';
  const num = amount !== 0 ? `<b>\u2212${Math.abs(amount)}</b>` : '';
  return `<span class="fx ${EFFECTS[k]?.positive ? 'pos' : 'neg'}${paused ? ' paused' : ''}"${tip}>${effectIconSvg(k, 14)}${num}<i>${Math.ceil(left)}</i></span>`;
}

const NODE_NAMES: Record<string, string> = {};
for (const tree of Object.values(TREES)) for (const [id, n] of Object.entries(tree.nodes)) NODE_NAMES[id] = n.name;

/**
 * The own effect row: one icon per kind (an unpaused entry wins, with the longest time left; a kind whose entries
 * are all paused shows greyed), then a small grey chip with the name of each paused item and node.
 */
export function effectsHtml(list: Snapshot['me']['effects'], items: readonly ItemId[], nodes: readonly NodeId[]): string {
  return effectsRowHtml(effectRows(list), items, nodes);
}

type EffectRow = readonly [kind: number, left: number, amount: number, paused: boolean];

/** One row per kind: timer from the unpaused entry with the longest time left; the amount sums the unpaused entries (all, if every entry is paused). */
function effectRows(list: Snapshot['me']['effects']): EffectRow[] {
  const best = new Map<number, { left: number; paused: boolean; unpaused: number; all: number }>();
  for (const [k, left, amount, paused] of list) {
    const cur = best.get(k);
    if (!cur) {
      best.set(k, { left, paused, unpaused: paused ? 0 : amount, all: amount });
      continue;
    }
    cur.all += amount;
    if (!paused) cur.unpaused += amount;
    if ((cur.paused && !paused) || (cur.paused === paused && left > cur.left)) {
      cur.left = left;
      cur.paused = paused;
    }
  }
  return [...best].map(([k, c]) => [k, Math.ceil(c.left), c.paused ? c.all : c.unpaused, c.paused] as const);
}

function effectsRowHtml(rows: readonly EffectRow[], items: readonly ItemId[], nodes: readonly NodeId[]): string {
  const icons = rows.map(([k, left, amount, paused]) => effectChipHtml(k, left, amount, paused));
  const chips = [...items.map((i) => ITEMS[i].name), ...nodes.map((n) => NODE_NAMES[n] ?? n)].map((n) => `<span class="pchip">${esc(n)}</span>`);
  return icons.concat(chips).join('');
}

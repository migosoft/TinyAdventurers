import type { Net } from '../net';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Snapshot } from '../generated/Snapshot';
import { tagText } from './tags';
import { LogBuffer } from './buffer';
import { LogPanel } from './panel';
import type { Toggle } from '../ui/settings';
import { loadPrefs, savePrefs, type LogPrefs } from './prefs';

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * The rules log, client side, without Phaser: opt-in, keys, buffer and panel. Both views host it through a few one-line hooks
 * (see `boundary.test.ts`): the snapshot feed comes from the run session, the key from the host, the tags are drawn by the view
 * (`phaserTags.ts` in 2D, the overlay layout in 3D).
 */
export class RulesLog {
  private prefs: LogPrefs;
  private buffer = new LogBuffer();
  private panel: LogPanel;
  /** The latest tags, by entity: (EntityKind id, number). */
  private tags = new Map<number, [number, number]>();
  private names = new Map<number, string>();
  private you: number;
  private store: Storage | null;

  constructor(private net: Pick<Net, 'send'>, info: RunStartInfo, store?: Storage | null) {
    this.store = store === undefined ? storage() : store;
    this.you = info.you;
    for (const p of info.players) this.names.set(p.ent, p.name);
    this.prefs = loadPrefs(this.store);
    this.panel = new LogPanel(document.body, (on) => this.setDetails(on));
    this.panel.setDetails(this.prefs.details);
    this.panel.show(this.prefs.on);
    if (this.prefs.on) this.send();
  }

  get on(): boolean {
    return this.prefs.on;
  }

  onSnapshot(s: Snapshot): void {
    if (!this.prefs.on || !s.log) return;
    this.tags = new Map(s.log[0].map(([id, k, n]) => [id, [k, n]]));
    if (s.log[1].length === 0) return;
    const { add, drop } = this.buffer.push(s.log[1], this.prefs.details);
    this.panel.append(add, drop);
  }

  /** L toggles the log, Shift+L the calculation lines; a key repeat does nothing. */
  key(e: { shiftKey: boolean; repeat: boolean }): void {
    if (e.repeat) return;
    if (e.shiftKey) this.setDetails(!this.prefs.details);
    else this.setOn(!this.prefs.on);
  }

  /** The tag over a creature while the log is on, else null. */
  tagOf(e: { id: number; kind: number; extra: number; side: number }): string | null {
    return this.prefs.on ? tagText(e, this.tags, this.names, this.you) : null;
  }

  destroy(): void {
    this.panel.destroy();
  }

  private setOn(on: boolean): void {
    this.prefs.on = on;
    if (!on) {
      this.buffer.clear();
      this.tags.clear();
    }
    this.panel.show(on);
    this.render();
    this.persist();
  }

  private setDetails(on: boolean): void {
    this.prefs.details = on;
    this.panel.setDetails(on);
    this.render();
    this.persist();
  }

  /** The rules log's switches for the Settings view; they save the prefs as the keys do. */
  settings(): Toggle[] {
    return [
      { label: 'Rules log', key: 'L', get: () => this.prefs.on, set: (on) => this.setOn(on) },
      { label: 'Calculation lines', key: 'Shift+L', get: () => this.prefs.details, set: (on) => this.setDetails(on) },
    ];
  }

  private persist(): void {
    savePrefs(this.store, this.prefs);
    this.send();
  }

  private send(): void {
    this.net.send({ t: 'RulesLog', on: this.prefs.on, details: this.prefs.details });
  }

  private render(): void {
    this.panel.render(this.buffer.recordRows(this.prefs.details));
  }
}

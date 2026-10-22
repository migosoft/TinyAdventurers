import type Phaser from 'phaser';
import type { EntState } from '../game/world';
import type { Net } from '../net';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Snapshot } from '../generated/Snapshot';
import { LogBuffer } from './buffer';
import { LogPanel } from './panel';
import { loadPrefs, savePrefs, type LogPrefs } from './prefs';

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** The rules log, client side: opt-in, keys, buffer and panel. GameScene reaches it through four one-line hooks. */
export class RulesLog {
  private prefs: LogPrefs;
  private buffer = new LogBuffer();
  private panel: LogPanel;
  /** The latest tags (entity, EntityKind id, number) for `draw` (Task 9). */
  tags: [number, number, number][] = [];
  private store = storage();
  private onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.shiftKey) this.setDetails(!this.prefs.details);
    else this.setOn(!this.prefs.on);
  };

  constructor(private scene: Phaser.Scene, private net: Net, _info: RunStartInfo) {
    this.prefs = loadPrefs(this.store);
    this.panel = new LogPanel(document.body, (on) => this.setDetails(on));
    this.panel.setDetails(this.prefs.details);
    this.panel.show(this.prefs.on);
    scene.input.keyboard?.on('keydown-L', this.onKey);
    if (this.prefs.on) this.send();
  }

  onSnapshot(s: Snapshot): void {
    if (!this.prefs.on || !s.log) return;
    this.tags = s.log[0];
    if (s.log[1].length === 0) return;
    this.buffer.push(s.log[1]);
    this.render();
  }

  /** Creature tags over the heads: Task 9. */
  draw(_ents: Iterable<EntState>, _heightOf: (id: number) => number | undefined): void {}

  destroy(): void {
    this.scene.input.keyboard?.off('keydown-L', this.onKey);
    this.panel.destroy();
  }

  private setOn(on: boolean): void {
    this.prefs.on = on;
    if (!on) {
      this.buffer.clear();
      this.tags = [];
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

  private persist(): void {
    savePrefs(this.store, this.prefs);
    this.send();
  }

  private send(): void {
    this.net.send({ t: 'RulesLog', on: this.prefs.on, details: this.prefs.details });
  }

  private render(): void {
    this.panel.render(this.buffer.rows(this.prefs.details));
  }
}

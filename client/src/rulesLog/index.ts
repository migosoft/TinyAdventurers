import type Phaser from 'phaser';
import type { EntState } from '../game/world';
import type { Net } from '../net';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Snapshot } from '../generated/Snapshot';
import { DEPTH } from '../game/effects';
import { tagText } from './tags';
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
  /** The latest tags, by entity: (EntityKind id, number), for `draw`. */
  private tags = new Map<number, [number, number]>();
  private names = new Map<number, string>();
  private you: number;
  private pool: Phaser.GameObjects.Text[] = [];
  private used = new Map<number, Phaser.GameObjects.Text>();
  private store = storage();
  private onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.shiftKey) this.setDetails(!this.prefs.details);
    else this.setOn(!this.prefs.on);
  };

  constructor(private scene: Phaser.Scene, private net: Net, info: RunStartInfo) {
    this.you = info.you;
    for (const p of info.players) this.names.set(p.ent, p.name);
    this.prefs = loadPrefs(this.store);
    this.panel = new LogPanel(document.body, (on) => this.setDetails(on));
    this.panel.setDetails(this.prefs.details);
    this.panel.show(this.prefs.on);
    scene.input.keyboard?.on('keydown-L', this.onKey);
    if (this.prefs.on) this.send();
  }

  onSnapshot(s: Snapshot): void {
    if (!this.prefs.on || !s.log) return;
    this.tags = new Map(s.log[0].map(([id, k, n]) => [id, [k, n]]));
    if (s.log[1].length === 0) return;
    this.buffer.push(s.log[1]);
    this.render();
  }

  /** Creature tags over the heads, 4 px above the health bar; nothing is created while the log is off. */
  draw(ents: Iterable<EntState>, heightOf: (id: number) => number | undefined): void {
    if (!this.prefs.on) {
      this.release(new Set());
      return;
    }
    const seen = new Set<number>();
    for (const e of ents) {
      const h = heightOf(e.id);
      if (h === undefined) continue;
      const text = tagText(e, this.tags, this.names, this.you);
      if (text === null) continue;
      seen.add(e.id);
      let t = this.used.get(e.id);
      if (!t) {
        t = this.pool.pop() ?? this.makeText();
        this.used.set(e.id, t);
      }
      t.setText(text).setPosition(Math.round(e.x), Math.round(e.y - h - 7)).setVisible(true);
    }
    this.release(seen);
  }

  private makeText(): Phaser.GameObjects.Text {
    const cam = this.scene.cameras.main;
    return this.scene.add
      .text(0, 0, '', {
        fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
        fontStyle: '600',
        fontSize: '8px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.numbers)
      .setResolution(cam.zoom * (window.devicePixelRatio || 1));
  }

  private release(seen: Set<number>): void {
    for (const [id, t] of this.used) {
      if (seen.has(id)) continue;
      t.setVisible(false);
      this.pool.push(t);
      this.used.delete(id);
    }
  }

  destroy(): void {
    this.scene.input.keyboard?.off('keydown-L', this.onKey);
    this.panel.destroy();
    for (const t of [...this.pool, ...this.used.values()]) t.destroy();
    this.pool = [];
    this.used.clear();
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

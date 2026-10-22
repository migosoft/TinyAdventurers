import type Phaser from 'phaser';
import type { EntState } from '../game/world';
import type { Net } from '../net';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Snapshot } from '../generated/Snapshot';
import { DEPTH } from '../game/effects';
import { FONT_TEXT } from '../fonts';
import { smoothText, WORLD_TEXT } from '../game/worldText';
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

/** The rules log, client side: opt-in, keys, buffer and panel. GameScene reaches it through five one-line hooks (create, onSnapshot, draw and cleanup in GameScene, plus the raw log element in wire.ts). */
export class RulesLog {
  private prefs: LogPrefs;
  private buffer = new LogBuffer();
  private panel: LogPanel;
  /** The latest tags, by entity: (EntityKind id, number), for `draw`. */
  private tags = new Map<number, [number, number]>();
  private names = new Map<number, string>();
  private you: number;
  private seen = new Set<number>();
  private res = 0;
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
    this.res = this.resolution();
  }

  onSnapshot(s: Snapshot): void {
    if (!this.prefs.on || !s.log) return;
    this.tags = new Map(s.log[0].map(([id, k, n]) => [id, [k, n]]));
    if (s.log[1].length === 0) return;
    const { add, drop } = this.buffer.push(s.log[1], this.prefs.details);
    this.panel.append(add, drop);
  }

  /** Creature tags over the heads, 4 px above the health bar; nothing is created while the log is off. */
  draw(ents: Iterable<EntState>, heightOf: (id: number) => number | undefined): void {
    if (!this.prefs.on) {
      if (this.used.size > 0) {
        this.seen.clear();
        this.release(this.seen);
      }
      return;
    }
    const seen = this.seen;
    seen.clear();
    this.syncResolution();
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
    return smoothText(
      this.scene.add
        .text(0, 0, '', {
          fontFamily: FONT_TEXT,
          fontStyle: WORLD_TEXT.tag.style,
          fontSize: `${WORLD_TEXT.tag.size}px`,
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.numbers)
        .setResolution(this.res),
    );
  }

  private resolution(): number {
    return this.scene.scale.zoom * this.scene.cameras.main.zoom * (window.devicePixelRatio || 1);
  }

  /** The screen's real pixels per world pixel changed (window resize): re-apply, only on change. */
  private syncResolution(): void {
    const r = this.resolution();
    if (r === this.res) return;
    this.res = r;
    for (const t of [...this.pool, ...this.used.values()]) t.setResolution(r);
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

import type Phaser from 'phaser';
import type { EntState } from '../game/world';
import { DEPTH } from '../game/effects';
import { FONT_TEXT } from '../fonts';
import { smoothText, WORLD_TEXT } from '../game/worldText';
import type { RulesLog } from '.';

/** The 2D view's creature tags over the heads, 7 px above the figure's height; pooled texts, nothing is created while the log is off. */
export class PhaserTags {
  private seen = new Set<number>();
  private res: number;
  private pool: Phaser.GameObjects.Text[] = [];
  private used = new Map<number, Phaser.GameObjects.Text>();

  constructor(private scene: Phaser.Scene) {
    this.res = this.resolution();
  }

  draw(log: RulesLog, ents: Iterable<EntState>, heightOf: (id: number) => number | undefined): void {
    if (!log.on) {
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
      const text = log.tagOf(e);
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
    for (const t of [...this.pool, ...this.used.values()]) t.destroy();
    this.pool = [];
    this.used.clear();
  }
}

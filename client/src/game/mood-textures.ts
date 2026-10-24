// The generated textures behind the dungeon air: a soft smoke puff and a tileable haze.
import type Phaser from 'phaser';

export const SMOKE_TEX = 'mood-smoke';
export const HAZE_TEX = 'mood-haze';
/** Phaser's `FilterMode.LINEAR` (a runtime import of Phaser would not load in unit tests). */
const LINEAR = 0;

/** The generated textures: a soft round puff and a tileable cloudy haze (both smooth, white so they can be tinted). */
export function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(SMOKE_TEX)) {
    const c = scene.textures.createCanvas(SMOKE_TEX, 32, 32)!;
    const ctx = c.getContext();
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    c.refresh();
    c.setFilter(LINEAR);
  }
  if (!scene.textures.exists(HAZE_TEX)) {
    // Every blob is drawn at its wrapped copies too, so the texture tiles.
    const S = 128;
    const c = scene.textures.createCanvas(HAZE_TEX, S, S)!;
    const ctx = c.getContext();
    let seed = 7;
    const r01 = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = r01() * S;
      const y = r01() * S;
      const r = 14 + r01() * 30;
      const a = 0.25 + r01() * 0.35;
      for (const ox of [-S, 0, S])
        for (const oy of [-S, 0, S]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, `rgba(255,255,255,${a})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
        }
    }
    c.refresh();
    c.setFilter(LINEAR);
  }
}

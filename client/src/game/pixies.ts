// Pixies (#202): a few tiny glowing balls of light drifting around the cove's tree. Each is a 1-2 px
// bright core with a soft additive glow and a pale wing pixel on each side that flips every frame (a
// hummingbird buzz). Client-only: no light of their own, no game effect. The path is pure and seeded.
import type Phaser from 'phaser';
import { DEPTH } from './effects';
import { PIXIE_COLOURS, PIXIE_COUNT, PIXIE_GLOW_ALPHA, PIXIE_WING_ALPHA, pixieAt, wingUp } from './pixieMath';

export { pixieAt, wingUp } from './pixieMath';

const GLOW_TEX = 'pixie-glow';
const GLOW_SIZE = 9;
const ADD = 1; // Phaser.BlendModes.ADD
/** A 9x9 soft round glow, white, to be tinted. */
function ensureTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW_TEX)) return;
  const c = scene.textures.createCanvas(GLOW_TEX, GLOW_SIZE, GLOW_SIZE)!;
  const ctx = c.getContext();
  const m = GLOW_SIZE / 2;
  const g = ctx.createRadialGradient(m, m, 0, m, m, m);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  c.refresh();
}

interface Pixie {
  glow: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Rectangle;
  /** The second core pixel below, on half the pixies. */
  core2?: Phaser.GameObjects.Rectangle;
  wingL: Phaser.GameObjects.Rectangle;
  wingR: Phaser.GameObjects.Rectangle;
}

export class Pixies {
  /** Hidden and not updated while false. */
  on = true;
  private pixies: Pixie[] = [];

  constructor(scene: Phaser.Scene, private centre: { x: number; y: number }, count = PIXIE_COUNT, private seed = 0) {
    ensureTexture(scene);
    const px = (color: number, alpha = 1) => scene.add.rectangle(0, 0, 1, 1, color, alpha).setOrigin(0).setDepth(DEPTH.fx);
    for (let i = 0; i < count; i++) {
      const glow = scene.add.image(0, 0, GLOW_TEX).setTint(PIXIE_COLOURS.glow).setAlpha(PIXIE_GLOW_ALPHA).setBlendMode(ADD).setDepth(DEPTH.fx);
      const core = px(PIXIE_COLOURS.core);
      const core2 = i % 2 === 0 ? px(PIXIE_COLOURS.core2) : undefined;
      this.pixies.push({ glow, core, core2, wingL: px(PIXIE_COLOURS.wing, PIXIE_WING_ALPHA), wingR: px(PIXIE_COLOURS.wing, PIXIE_WING_ALPHA) });
    }
  }

  update(t: number, frame: number): void {
    for (const [i, p] of this.pixies.entries()) {
      for (const o of [p.glow, p.core, p.core2, p.wingL, p.wingR]) o?.setVisible(this.on);
      if (!this.on) continue;
      const at = pixieAt(i, t, this.centre, this.seed);
      const x = Math.round(at.x);
      const y = Math.round(at.y);
      const wy = wingUp(i, frame) ? y - 1 : y;
      p.glow.setPosition(x + 0.5, y + 0.5);
      p.core.setPosition(x, y);
      p.core2?.setPosition(x, y + 1);
      p.wingL.setPosition(x - 1, wy);
      p.wingR.setPosition(x + 1, wy);
    }
  }

  destroy(): void {
    for (const p of this.pixies) for (const o of [p.glow, p.core, p.core2, p.wingL, p.wingR]) o?.destroy();
    this.pixies = [];
  }
}

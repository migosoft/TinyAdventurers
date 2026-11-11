// A lost and restored WebGL context (driver crash or update, a GPU switch, the browser reclaiming graphics memory)
// recreates every render texture empty: they exist only in graphics memory, unlike image and canvas textures, which
// Phaser re-uploads. Whatever is drawn into a render texture once must be drawn again then (#298).
// Phaser is imported for types only, so modules using this stay loadable in unit tests (no `window` there).
import type Phaser from 'phaser';
import { TILE, type TileMap } from '../sim/map';
import { tileDraws } from './autotile';
import { DEPTH } from './effects';

/** `Phaser.Renderer.Events.RESTORE_WEBGL`: the renderer emits it once the context and its resources are back. */
const RESTORE_WEBGL = 'restorewebgl';
/** `Phaser.Scenes.Events.SHUTDOWN`. */
const SHUTDOWN = 'shutdown';

/** Calls `redraw` after each restored WebGL context, until the scene shuts down or the returned function is called.
 *  Phaser has recreated the textures and framebuffers by then, so `redraw` may draw into render textures at once. */
export function onContextRestored(scene: Phaser.Scene, redraw: () => void): () => void {
  const renderer = scene.game.renderer;
  if (!('gl' in renderer)) return () => {}; // the canvas renderer has no context to lose
  const off = () => {
    renderer.off(RESTORE_WEBGL, redraw);
    scene.events.off(SHUTDOWN, off);
  };
  renderer.on(RESTORE_WEBGL, redraw);
  scene.events.once(SHUTDOWN, off);
  return off;
}

/** A demo scene's board: the map's tiles drawn once into a map-sized render texture, and again after a restored
 *  context. (The game's board, with its tile tints and grid lines, is `PhaserRunView.paintBoard`.) */
export function demoBoard(scene: Phaser.Scene, map: TileMap): Phaser.GameObjects.RenderTexture {
  const rt = scene.add.renderTexture(0, 0, map.w * TILE, map.h * TILE).setOrigin(0).setDepth(DEPTH.map);
  const paint = () => {
    rt.clear();
    rt.beginDraw();
    for (let y = 0; y < map.h; y++)
      for (let x = 0; x < map.w; x++)
        for (const d of tileDraws(map, x, y)) rt.batchDrawFrame('atlas', d.frame, x * TILE, y * TILE + (d.dy ?? 0));
    rt.endDraw();
  };
  paint();
  onContextRestored(scene, paint);
  return rt;
}

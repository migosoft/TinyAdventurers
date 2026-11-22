// The stage of the ?r3d=demo page (#301): a small walled room with a few figures and the player to walk around.

import { closeCam, keysToWorld } from './camera';
import { buildDynamic } from './cards';
import { parseMap, MAP_ROWS } from './demoMap';
import { MOVE_KEYS, type Stage, type StageCtx } from './host';
import { AMBIENT, sceneLights } from './light';
import { newScene, stepScene } from './scene';
import { seeLook } from './seeThrough';
import { coverJob, coverSources, type CoverJob } from './cover/coverJob';
import { tilesSeed } from './cover/moss';
import type { Assets, View, WorldInput } from './view';
import { stoneField } from './stone/field';
import { makeStoneRun } from './stone/stoneRun';

export function createDemoStage(assets: Assets, initialParams: { pitch: number; yaw: number }): Stage {
  const map = parseMap(MAP_ROWS);
  const world: WorldInput = { map, painted: false, clear: 'stone', stone: stoneField(map) };
  const stoneRun = makeStoneRun(world, { x: map.w / 2, z: map.h / 2 });
  const scene = newScene();
  const cam = { x: scene.player.x, z: scene.player.z, pitch: (initialParams.pitch * Math.PI) / 180, yaw: (initialParams.yaw * Math.PI) / 180 };

  // The dev scene's cover: moss in every room (`everywhere`), built whole at the first build and kept for the rebuilds.
  let job: CoverJob | null = null;
  return {
    world,
    built(view: View): void {
      if (!job) {
        job = coverJob(coverSources(map, { woodland: null, cove: null, spawnRow: 0, spots: [] }, { everywhere: true }), tilesSeed(map));
        job.step(Infinity);
      }
      view.setCover(job.result()!);
    },
    frame(c: StageCtx): number {
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      stepScene(map, scene, ix || iz ? keysToWorld(cam.yaw, ix, iz) : { x: 0, z: 0 }, c.dt);
      const k = 1 - Math.exp(-c.dt * 6);
      cam.x += (scene.player.x - cam.x) * k;
      cam.z += (scene.player.z - cam.z) * k;
      c.timer.lap('sim');
      const dynamic = buildDynamic(scene, assets.frames, cam, c.now, c.params.orb);
      c.timer.lap('cards');
      const lights = sceneLights(scene, c.now, c.params.orb);
      c.timer.lap('lights');
      const cr = (job as CoverJob | null)?.result();
      if (cr && window.__r3d) window.__r3d.cover = { sheets: cr.sheets, bushels: cr.bushels.length };
      stoneRun.frame(c.view);
      if (!c.view) return 0; // while the view is being rebuilt the scene keeps stepping; only the drawing waits
      c.timer.renderStart();
      return c.view.draw(
        { cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient: AMBIENT, lava: null, lavaVersion: 0, darkvision: null, casters: [], shadows: c.params.shadows, smooth: c.params.smooth, t: c.now, see: { openers: [{ id: 0, x: scene.player.x, z: scene.player.z, mid: 0.5, who: 'hero' }], look: seeLook(c.params) }, cover: { on: c.params.cover, gh: c.params.gh, wind: c.params.wind, t: c.now } },
        c.timer,
      );
    },
    dispose(): void {},
  };
}

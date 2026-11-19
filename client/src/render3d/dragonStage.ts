// SPIKE (#358), throwaway: the stage of `?r3d=dragon`. A boss hall of 60 x 44 tiles, the knight (WASD) as the measure of a human,
// and the dragon try-out of `dragonSpike.ts` in the middle. `&scale=2..4` (default 3) is the size factor against the old sprite;
// `&air=1`, `&roar=1`, `&spread=1`, `&face=<deg>`, `&t=<s>` (pins the clock), `&px=`/`&pz=` (the knight's place) for check shots.

import { closeCam, keysToWorld, viewRay } from './camera';
import { buildDynamic } from './cards';
import { parseMap } from './demoMap';
import { createDragonSpike, DRAGON_DIMS, GOLD_DRAGON, RED_DRAGON, SILVER_DRAGON, WHITE_DRAGON } from './dragonSpike';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { sceneLights } from './light';
import { newScene, stepScene } from './scene';
import { seeLook } from './seeThrough';
import type { Assets, View, WorldInput } from './view';

export const HALL_W = 60, HALL_H = 44;
const WALL = 2;
const AMBIENT: [number, number, number] = [0.5, 0.48, 0.5];

export function createDragonStage(assets: Assets, initialParams: { pitch: number; yaw: number }, search: string, host?: Pick<Host, 'setPageButtons'>): Stage {
  const q = new URLSearchParams(search);
  const num = (key: string, def: number): number => { const v = Number(q.get(key) ?? NaN); return Number.isFinite(v) ? v : def; };
  const rows = [...Array(HALL_H + 2 * WALL).keys()].map((z) => (z < WALL || z >= HALL_H + WALL ? '#'.repeat(HALL_W + 2 * WALL) : '#'.repeat(WALL) + '.'.repeat(HALL_W) + '#'.repeat(WALL)));
  const map = parseMap(rows);
  const world: WorldInput = { map, painted: false, clear: 'stone' };
  const centre = { x: WALL + HALL_W / 2, z: WALL + HALL_H / 2 };
  const scene = newScene();
  scene.player.x = num('px', centre.x);
  scene.player.z = num('pz', centre.z + 2);
  scene.ents = [scene.player];
  scene.props = [];
  scene.torches = [...Array(7).keys()].map((i) => ({ x: WALL + 6 + i * 8 + 0.5, y: 1.0, z: WALL + 0.16, ph: i * 1.7 }));
  const cam = { x: num('cx', scene.player.x), z: num('cz', scene.player.z), pitch: (initialParams.pitch * Math.PI) / 180, yaw: (initialParams.yaw * Math.PI) / 180 };
  const fixedCam = q.has('cx') || q.has('cz');
  const pinned = q.has('t') ? num('t', 0) : null;
  const pose = { scale: Math.min(5, Math.max(1, num('scale', 3))), air: num('air', 0), roar: num('roar', 0), spread: num('spread', 0), face: (num('face', 20) * Math.PI) / 180 };
  // the red dragon left of the middle, the white one to its right, so the two sizes can be compared
  const cast = [
    { look: RED_DRAGON, x: centre.x - 15, z: centre.z - 9 }, { look: GOLD_DRAGON, x: centre.x + 13, z: centre.z - 9 },
    { look: WHITE_DRAGON, x: centre.x - 13, z: centre.z + 10 }, { look: SILVER_DRAGON, x: centre.x + 12, z: centre.z + 10 },
  ].map((c) => ({ ...c, spike: createDragonSpike(c.look) }));
  const spike = {
    attach: (sc: Parameters<(typeof cast)[0]['spike']['attach']>[0]) => cast.forEach((c) => c.spike.attach(sc)),
    step: (dt: number, t: number, p: Parameters<(typeof cast)[0]['spike']['step']>[2]) => cast.forEach((c, i) => c.spike.step(dt, t + i * 1.7, { ...p, x: c.x, z: c.z })),
    dispose: () => cast.forEach((c) => c.spike.dispose()),
  };
  let view: View | null = null;
  let clock = 0;

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);color:#dfe6f2;background:rgba(10,10,16,.72);padding:5px 12px;border-radius:6px;font:13px sans-serif;z-index:5;pointer-events:none;text-align:center;white-space:nowrap';
  document.body.appendChild(label);
  const describe = (): void => {
    const d = DRAGON_DIMS;
    const line = (l: typeof RED_DRAGON): string => {
      const tiles = (px: number): string => ((px * pose.scale * l.size) / 16).toFixed(1);
      return `${l.name} dragon ${(pose.scale * l.size).toFixed(1)}× the old sprite · wingspan ${tiles(d.span * l.wing)} tiles · shoulder ${tiles(d.shoulder)}, head ${tiles(d.head)} tiles high · hit circle ${tiles(2 * d.hit)} tiles across`;
    };
    label.innerHTML = `${cast.map((c) => line(c.look)).join('<br>')}<br>hall ${HALL_W} × ${HALL_H} tiles (old: 26 × 20) · a tile is 16 px, the knight sprite about 1 tile`;
  };
  describe();
  const size = (s: number) => ({ name: `${s}×`, pressed: () => pose.scale === s, press: () => { pose.scale = s; describe(); } });
  host?.setPageButtons([
    size(2), size(3), size(4),
    { name: 'Fly', pressed: () => pose.air > 0, press: () => { pose.air = pose.air > 0 ? 0 : 1; } },
    { name: 'Roar', pressed: () => pose.roar > 0, press: () => { pose.roar = pose.roar > 0 ? 0 : 1; } },
    { name: 'Spread wings', pressed: () => pose.spread > 0, press: () => { pose.spread = pose.spread > 0 ? 0 : 1; } },
    { name: 'Turn 45°', pressed: null, press: () => { pose.face += Math.PI / 4; } },
  ]);

  return {
    world,
    built(v: View): void {
      view = v;
      spike.attach(v.spike!.scene);
    },
    frame(c: StageCtx): number {
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      stepScene(map, scene, ix || iz ? keysToWorld(cam.yaw, ix, iz) : { x: 0, z: 0 }, c.dt);
      if (!fixedCam) {
        const k = 1 - Math.exp(-c.dt * 6);
        cam.x += (scene.player.x - cam.x) * k;
        cam.z += (scene.player.z - cam.z) * k;
      }
      const p = { x: centre.x, z: centre.z, ...pose, look: { x: scene.player.x, z: scene.player.z }, stretch: 1 / Math.cos(cam.pitch), view: viewRay(cam.pitch, cam.yaw) };
      // a pinned clock (`&t=`) runs up to its time in fixed steps, then stands still
      if (pinned === null) { clock += c.dt; spike.step(c.dt, clock, p); }
      else {
        for (let i = 0; i < 60 && clock < pinned; i++) { clock = Math.min(pinned, clock + 1 / 30); spike.step(1 / 30, clock, p); }
        spike.step(0.0001, clock, p);
      }
      const dynamic = buildDynamic(scene, assets.frames, cam, c.now, false);
      const lights = sceneLights(scene, c.now, false);
      if (!c.view || !view) return 0;
      c.timer.renderStart();
      return c.view.draw(
        { cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient: AMBIENT, lava: null, lavaVersion: 0, darkvision: null, casters: [], shadows: c.params.shadows, smooth: c.params.smooth, t: c.now, see: { openers: [{ id: 0, x: scene.player.x, z: scene.player.z, mid: 0.5, who: 'hero' }], look: seeLook(c.params) } },
        c.timer,
      );
    },
    dispose(): void {
      host?.setPageButtons([]);
      label.remove();
      spike.dispose();
    },
  };
}

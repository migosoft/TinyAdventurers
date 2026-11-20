// SPIKE (#380), throwaway: the stage of ?r3d=stone, the stone demo level. The knight walks; a lamp follows him (`&lamp=0` off);
// `&at=cave|border|hall|runes|door|cave2` starts him in that place.
import { closeCam, keysToWorld } from './camera';
import { buildDynamic } from './cards';
import { MOVE_KEYS, type Stage, type StageCtx } from './host';
import { AMBIENT, torchFlicker, type Light } from './light';
import { stepScene, type SceneState } from './scene';
import { seeLook } from './seeThrough';
import { STONE_LEVEL } from './stone/stoneMap';
import type { Assets, WorldInput } from './view';

export function createStoneStage(assets: Assets, initialParams: { pitch: number; yaw: number }, search: string): Stage {
  const L = STONE_LEVEL;
  const q = new URLSearchParams(search);
  const start = L.places[q.get('at') ?? ''] ?? L.spawn;
  const lamp = q.get('lamp') !== '0';
  const world: WorldInput = { map: L.map, painted: false, clear: 'stone' };
  const player = { kind: 'knight' as const, x: start.x, z: start.z, vx: 0, vz: 0, fx: 1, fz: 0, flip: false, moving: false, t: 0, speed: 4.6, at: 1, pause: 0, wait: 0 };
  const scene: SceneState = { player, ents: [player], props: [], torches: L.torches };
  const cam = { x: player.x, z: player.z, pitch: (initialParams.pitch * Math.PI) / 180, yaw: (initialParams.yaw * Math.PI) / 180 };
  return {
    world,
    built(): void {},
    frame(c: StageCtx): number {
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      stepScene(L.map, scene, ix || iz ? keysToWorld(cam.yaw, ix, iz) : { x: 0, z: 0 }, c.dt);
      const k = 1 - Math.exp(-c.dt * 6);
      cam.x += (player.x - cam.x) * k;
      cam.z += (player.z - cam.z) * k;
      const dynamic = buildDynamic(scene, assets.frames, cam, c.now, false);
      const lights: Light[] = L.torches.map((tc) => {
        const f = torchFlicker(c.now, tc.ph);
        return { x: tc.x, y: tc.y + 0.25, z: tc.z + 0.1, radius: 8.5, r: 1.2 * f, g: 0.76 * f, b: 0.4 * f, shadow: true, skip: -1 };
      });
      for (const cr of L.crystals) lights.push({ x: cr.x, y: cr.y, z: cr.z, radius: 5.5, r: cr.r, g: cr.g, b: cr.b, shadow: true, skip: -1 });
      if (lamp) lights.push({ x: player.x, y: 1.1, z: player.z + 0.05, radius: 5, r: 0.9, g: 0.62, b: 0.36, shadow: true, skip: -1 });
      if (!c.view) return 0;
      c.timer.renderStart();
      return c.view.draw(
        { cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient: AMBIENT, lava: null, lavaVersion: 0, darkvision: null, casters: [], shadows: c.params.shadows, smooth: c.params.smooth, t: c.now, see: { openers: [{ id: 0, x: player.x, z: player.z, mid: 0.5, who: 'hero' }], look: seeLook(c.params) }, cover: { on: false, gh: c.params.gh, wind: c.params.wind, t: c.now } },
        c.timer,
      );
    },
    dispose(): void {},
  };
}

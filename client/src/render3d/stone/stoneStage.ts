// The stage of the ?r3d=stone page (#380): the stonework's own level on the real code, no server. A knight walks with WASD.
// `&stone=laid|rock|zones` (default: the map's own kinds), `&at=cave|border|hall|circle|mosaic|cave2|door|grate`, `&lamp=0` (the light that walks with the knight off),
// `&break=1` (every crystal broken: its light is off and its cluster is stumps), `&t=<s>` shifts the clock of the lights' flicker and the puddles' drops; `&refl=0` turns the puddles' reflections off.
import { LIGHT, LIGHT_KIND } from '../../generated/defs';
import { LightField } from '../../game/light';
import { closeCam, keysToWorld } from '../camera';
import { buildDynamic } from '../cards';
import { MOVE_KEYS, type Stage, type StageCtx } from '../host';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient } from '../light';
import { footprint, lightView, movingCands, selectLights, staticCands } from '../lights';
import { reflects, type R3dParams } from '../params';
import { newScene, stepScene } from '../scene';
import { seeLook } from '../seeThrough';
import { coverJob, coverSources, type CoverJob } from '../cover/coverJob';
import { tilesSeed } from '../cover/moss';
import { marksOf, type Assets, type View, type WorldInput } from '../view';
import { Water3d } from '../water/water';
import { ROCK, stoneField } from './field';
import { CRYSTAL_TILES, PLACES, STONE_SEED, STONE_SPAWN, TORCH_TILES, stoneMap, zoneKinds } from './stoneMap';
import { makeStoneRun } from './stoneRun';

const TILE = 16;

export function createStoneStage(assets: Assets, p: R3dParams, search: string): Stage {
  const q = new URLSearchParams(search);
  const map = stoneMap();
  const mode = q.get('stone');
  const kinds = mode === 'rock' ? new Uint8Array(map.w * map.h).fill(ROCK) : mode === 'laid' ? null : zoneKinds(map);
  const world: WorldInput = { map, painted: false, clear: 'stone', stone: stoneField(map, kinds, STONE_SEED) };
  const [px, pz] = PLACES[(q.get('at') ?? 'cave') as keyof typeof PLACES] ?? PLACES.cave;
  const stoneRun = makeStoneRun(world, { x: px, z: pz });

  // One knight, no props or torch figures: the scene is the demo's with everything else taken out.
  const scene = newScene();
  scene.ents = [scene.player];
  scene.props = [];
  scene.torches = [];
  scene.player.x = px;
  scene.player.z = pz;
  const cam = { x: px, z: pz, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };

  const field = new LightField(map);
  let id = 1;
  // the wall beside a lamp's tile: north, west, east (the stage's lamps stand at one)
  const wall = (x: number, y: number): number => (map.opaque(x, y - 1) ? 1 : map.opaque(x - 1, y) ? 2 : map.opaque(x + 1, y) ? 3 : 0);
  for (const [x, y] of TORCH_TILES) field.add({ id: id++, kind: LIGHT_KIND.Torch, colour: LIGHT[LIGHT_KIND.Torch].colour, x, y, on: true, wall: wall(x, y) });
  for (const [x, y] of CRYSTAL_TILES) field.add({ id: id++, kind: LIGHT_KIND.Crystal, colour: LIGHT[LIGHT_KIND.Crystal].colour, x, y, on: q.get('break') !== '1', wall: wall(x, y) });
  world.taken = { lights: [...field.lights.values()], spawn: STONE_SPAWN };
  const lamp = q.get('lamp') !== '0';
  const water = new Water3d(map);
  const NONE_IDS = new Set<number>();
  let t = Number(q.get('t')) > 0 ? Number(q.get('t')) : 0;

  // The cover as the dev scene has it (moss in every room), built whole at the first build and kept for the rebuilds.
  let job: CoverJob | null = null;
  return {
    world,
    built(view: View): void {
      if (!job) {
        job = coverJob(coverSources(map, { woodland: null, cove: null, spawnRow: 0, spots: [], marks: marksOf(world) }, { everywhere: true }), tilesSeed(map));
        job.step(Infinity);
      }
      view.setCover(job.result()!);
    },
    frame(c: StageCtx): number {
      t += c.dt;
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      stepScene(map, scene, ix || iz ? keysToWorld(cam.yaw, ix, iz) : { x: 0, z: 0 }, c.dt);
      const k = 1 - Math.exp(-c.dt * 6);
      cam.x += (scene.player.x - cam.x) * k;
      cam.z += (scene.player.z - cam.z) * k;
      c.timer.lap('sim');
      stoneRun.frame(c.view);
      if (!c.view) return 0;
      const dynamic = buildDynamic(scene, assets.frames, cam, c.now, c.params.orb);
      c.timer.lap('cards');
      const game = c.params.light === 'game';
      const ambient = game ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
      const lights = game
        ? selectLights([...staticCands(field, t), ...movingCands(lamp ? [[scene.player.x * TILE, scene.player.z * TILE, LIGHT_KIND.Torch, LIGHT[LIGHT_KIND.Torch].colour]] : [], [], () => null, t)], lightView(footprint(cam, c.plan.halfW, c.plan.halfH), cam), cam, Math.min(LIGHT_CAP, c.params.lcap)).list
        : [];
      c.timer.lap('lights');
      // The puddles' drops, on the page's clock `t`.
      const wo = water.step({ dt: c.dt, now: t, figs: [], sinks: [], landed: null, hidden: NONE_IDS, puddles: c.view.stone?.marks.puddles, fp: footprint(cam, c.plan.halfW, c.plan.halfH) });
      c.timer.renderStart();
      return c.view.draw(
        {
          cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: [{ id: 0, x: scene.player.x, z: scene.player.z, mid: 0.5, who: 'hero' }], look: seeLook(c.params) },
          lava: null, lavaVersion: 0, darkvision: null, casters: [],
          water: { ripples: wo.ripples, now: t, reflect: reflects(c.params) },
          crystals: { off: (i) => field.lights.get(i)?.on === false, now: t },
          cover: { on: c.params.cover, gh: c.params.gh, wind: c.params.wind, t: c.now },
        },
        c.timer,
      );
    },
    dispose(): void {},
  };
}

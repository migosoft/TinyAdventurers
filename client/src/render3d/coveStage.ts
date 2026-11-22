// The stage of the ?r3d=cove page (#329): the nymph's cove in the 3D view, no server, no login. A dark stone room of the real cove's size with
// the trunk tile at its middle, the cove's willow and bushes as grown trees, its tufts and ferns as bushels in the ground cover (with moss in the room), its seven pixies, two wall
// torches and a knight to walk with WASD, with the sight on. There is no sun: the trees are lit by the torches, the pixies and the base light.
import type { CoveInfo } from '../generated/CoveInfo';
import { ANIM, CONST, KIND, LEAF_PALETTE, LIGHT_KIND, SIDE, TILE_ID } from '../generated/defs';
import { LightField } from '../game/light';
import { DEFAULT_HAZE } from '../game/sightField';
import type { EntState } from '../game/world';
import { TileMap } from '../sim/map';
import { View as SightView } from '../sim/view';
import { CoverField } from './cover/coverField';
import { coverJob, coverSources, type CoverJob } from './cover/coverJob';
import { tilesSeed } from './cover/moss';
import { atlasBounds } from './atlasBounds';
import { closeCam, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Cove3d } from './cove3d';
import { Figures3d } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { MOVE_KEYS, type Stage, type StageCtx } from './host';
import { LIGHT_CAP, dungeonAmbient, stoneClear } from './light';
import { assignSkips, carrierMap, CASTER_CAP, footprint, lightView, selectCasters, selectLights, staticCands, TorchPairs } from './lights';
import { MIST } from './mist';
import { seenOpeners } from './openers';
import type { R3dParams } from './params';
import { seeLook } from './seeThrough';
import { SightMask, hiddenAt } from './sightmask';
import { SIGHT_OFF, type SightFrame } from './sightNodes';
import { Forest, TREE_BUDGET_MS } from './trees/forest';
import { marksOf, type Assets, type View, type WorldInput } from './view';
import { stoneField } from './stone/field';
import { makeStoneRun } from './stone/stoneRun';

const TILE = 16;
const KNIGHT_ID = 100;
/** The knight's speed in tiles per second. */
const KNIGHT_SPEED = 4;
const ALL_VISIBLE = { isVisible: (): boolean => true };

/** The stage's room: the real cove's size (26 x 20 tiles) with the trunk at its middle. */
export const COVE_STAGE: CoveInfo = { x: 9, y: 6, w: 26, h: 20, tree_x: 22, tree_y: 16, seed: 1 };
const MAP_W = 44;
const MAP_H = 32;
/** Where the knight starts (tiles): in front of the tree. */
const KNIGHT_START = { x: 22.5, z: 20.5 };
/** Two stone pillars (one wall tile each) in the room, 9 tiles either side of the trunk (past the willow's curtains) and a row north of it, for the torches to hang on. */
export const PILLARS = [{ x: 13, y: 14 }, { x: 31, y: 14 }];
/** The two wall torches: the spot (px) on the floor row under each pillar, as the lights demo hangs them. */
const TORCHES = PILLARS.map((p) => ({ x: (p.x + 0.5) * TILE, y: (p.y + 1) * TILE + 0.5, colour: 0xffaa5a }));

/** The stage's map: stone walls round the room's floor, the pillars and the trunk tile at the tree. */
export function coveStageMap(): TileMap {
  const c = COVE_STAGE;
  const tiles = new Uint8Array(MAP_W * MAP_H).fill(TILE_ID.Wall);
  for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) tiles[y * MAP_W + x] = TILE_ID.Floor;
  for (const p of PILLARS) tiles[p.y * MAP_W + p.x] = TILE_ID.Wall;
  tiles[c.tree_y * MAP_W + c.tree_x] = TILE_ID.Trunk;
  return new TileMap(MAP_W, MAP_H, tiles);
}

const ent = (id: number, kind: number, x: number, y: number, o: Partial<EntState> = {}): EntState => ({
  id, kind, x, y, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0,
  side: kind === KIND.Knight ? SIDE.Friendly : SIDE.Neutral, entangled: 0, ...o,
});

export function createCoveStage(assets: Assets, p: R3dParams, search = ''): Stage {
  const map = coveStageMap();
  const world: WorldInput = { map, painted: false, clear: 'stone', stone: stoneField(map) };
  const stoneRun = makeStoneRun(world, KNIGHT_START);
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  // `at=x,z`: the knight (and the camera) starts on that tile when it is walkable; for the pictures.
  const at = /[?&]at=(\d+),(\d+)/.exec(search);
  const start = at && !map.blocks(Number(at[1]), Number(at[2]), 'hero') ? { x: Number(at[1]) + 0.5, z: Number(at[2]) + 0.5 } : KNIGHT_START;
  const knight = { x: start.x, z: start.z, aim: 0, moving: false };
  const cam = { x: knight.x, z: knight.z, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };

  // The cove as a run makes it: the willow and bushes are grown by `step`, the tufts and ferns are bushels of the cover layer.
  const cove = new Cove3d(COVE_STAGE, assets.frames);
  const forest = new Forest([cove.tree(), ...cove.bushes()], map, LEAF_PALETTE.Summer, cove.builder());
  const coveCasters = cove.casters();

  // The cover as a run builds it (moss in the room, the cove's grass and bushels), whole at the first build and kept for the rebuilds after a lost device.
  let job: CoverJob | null = null;
  let coverField: CoverField | null = null;
  const build = (): CoverJob => {
    if (!job) {
      job = coverJob(coverSources(map, { woodland: null, cove: COVE_STAGE, spawnRow: KNIGHT_START.z, spots: cove.bushelSpots(), marks: marksOf(world) }), tilesSeed(map));
      job.step(Infinity);
    }
    return job;
  };

  // The two torches: a light on each torch's tile and a flame figure.
  const field = new LightField(map);
  TORCHES.forEach((t, i) => field.add({ id: i + 1, kind: LIGHT_KIND.Torch, colour: t.colour, x: Math.floor(t.x / TILE), y: Math.floor(t.y / TILE), on: true }));
  const pairs = new TorchPairs();
  const torchEnts = TORCHES.map((t, i) => ent(i + 1, KIND.Torch, t.x, t.y, { extra: 0, anim: 1 }));
  for (const e of torchEnts) pairs.see(e);

  // The sight, as a run in a dungeon has it.
  const hardView = new SightView(map.w, map.h);
  const mask = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });
  let sightKey = '';

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  label.textContent = "the nymph's cove in 3D: a willow and bushes lit by torches and pixies, no sun; WASD walks";
  document.body.appendChild(label);

  /** Moves the knight by `d` tiles along the world direction (wx, wz), one axis at a time so it slides along what blocks. */
  const walk = (wx: number, wz: number, d: number): void => {
    const len = Math.hypot(wx, wz) || 1;
    const nx = knight.x + (wx / len) * d;
    if (!map.blocks(Math.floor(nx), Math.floor(knight.z), 'hero')) knight.x = nx;
    const nz = knight.z + (wz / len) * d;
    if (!map.blocks(Math.floor(knight.x), Math.floor(nz), 'hero')) knight.z = nz;
  };

  let seconds = 0;
  world.taken = { lights: [...field.lights.values()], spawn: KNIGHT_START };
  return {
    world,
    built(view: View): void {
      const r = build().result()!;
      view.setCover(r);
      coverField = new CoverField(r);
    },
    frame(c: StageCtx): number {
      const params = c.params;
      seconds += c.dt;
      cam.pitch = (params.pitch * Math.PI) / 180;
      cam.yaw = (params.yaw * Math.PI) / 180;
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      knight.moving = ix !== 0 || iz !== 0;
      if (knight.moving) {
        const w = keysToWorld(cam.yaw, ix, iz);
        walk(w.x, w.z, KNIGHT_SPEED * c.dt);
        if (w.x !== 0) knight.aim = w.x < 0 ? Math.PI : 0;
      }
      cam.x = knight.x;
      cam.z = knight.z;
      const ents: EntState[] = [...torchEnts, ent(KNIGHT_ID, KIND.Knight, knight.x * TILE, knight.z * TILE, { anim: knight.moving ? ANIM.Move : ANIM.Idle, animMs: c.now * 1000, aim: knight.aim })];
      c.timer.lap('sim');
      stoneRun.frame(c.view);
      if (!c.view) return 0;

      const ambient = dungeonAmbient(params.amb);
      const ground = coverField && params.cover ? (x: number, z: number, rad: number): number => coverField!.topAt(x, z, rad, params.gh) : undefined;
      const fo = figures.frame(galleryFrame(ents, c.now, c.dt), cam, { ambient, dark: params.dark, torchGlow: false, oval: 1, ground });
      cove.push(seconds, cam, fo.glows, fo.ghosts, params.sight ? mask : null);
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');

      forest.step(cam, TREE_BUDGET_MS);
      c.timer.lap('plants');

      const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
      const sel = selectLights([...staticCands(field, pairs, map, seconds), ...cove.lights(seconds)], lightView(fp, cam), { x: knight.x, z: knight.z }, Math.min(LIGHT_CAP, params.lcap));
      const lights = sel.list;
      // The cove's plants cast only where the knight sees them, as in a run.
      const shown = params.sight ? coveCasters.filter((k) => !hiddenAt(mask, k.x, k.z)) : coveCasters;
      const casters = selectCasters([...fo.casters, ...shown], lights, Math.min(CASTER_CAP, params.ccap));
      assignSkips(lights, carrierMap(lights), casters);
      c.timer.lap('lights');

      let sight: SightFrame = SIGHT_OFF;
      if (params.sight) {
        const key = `${knight.x.toFixed(1)},${knight.z.toFixed(1)}`;
        if (key !== sightKey) {
          sightKey = key;
          hardView.compute(map, knight.x * TILE, knight.z * TILE, CONST.FOV_RADIUS, 'hard');
        }
        mask.update(hardView, null, 0);
        sight = { mode: 'dark', mask, clear: stoneClear(ambient), haze: DEFAULT_HAZE, mist: MIST, mistDay: 1, mistLight: [1, 1, 1], wind: [0, 0], t: c.now };
      }
      c.timer.lap('sight');

      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.lights = { list: lights.length, inView: sel.inView };
        r.casters = casters.length;
        r.plants = { built: forest.built, total: forest.total };
        const cr = (job as CoverJob | null)?.result();
        if (cr) r.cover = { sheets: cr.sheets, bushels: cr.bushels.length };
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient, shadows: params.shadows, smooth: params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(params) },
          lava: null, lavaVersion: 0, darkvision: null, casters, sight,
          trees: forest.frame({ wind: params.wind, t: seconds, leafOverride: params.leaf === null ? -1 : params.leaf / 100, plain: params.plain, leafRate: params.leafRate }),
          cover: { on: params.cover, gh: params.gh, wind: params.wind, t: seconds },
        },
        c.timer,
      );
    },
    dispose(): void {
      label.remove();
    },
  };
}

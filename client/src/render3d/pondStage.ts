// Spike (#348): the stage of the ?r3d=pond page, a throwaway look study. A woodland scene (the ?r3d=woodland page's sun, sky, wind,
// trees and painted ground) with a hand-laid lake and a stream running into it: the water sheet of pond/pondWater.ts, and the lilies,
// reeds, frogs, dragonflies and fish of pond/pondLife.ts. A knight walks with WASD; the shallow rim slows it and the deep part blocks
// it, as the dungeon's water does. No server, no generator change.
import { ANIM, CONST, KIND, LEAF_PALETTE, SIDE, TILE_ID } from '../generated/defs';
import type { PlantInfo } from '../generated/PlantInfo';
import { DEFAULT_HAZE } from '../game/sightField';
import { PLANT_KINDS, type PlantKind } from '../game/vegetation';
import type { EntState } from '../game/world';
import { View as SightView } from '../sim/view';
import { atlasBounds } from './atlasBounds';
import { keysToWorld, viewRay } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Critters3d } from './critters3d';
import { Figures3d } from './figures';
import { Fireflies } from './fireflies';
import { galleryFrame, galleryInit } from './galleryStage';
import { CoverField } from './cover/coverField';
import { coverJob, coverSources, type CoverJob } from './cover/coverJob';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { WOODLAND_CLEAR, WORK_AMBIENT } from './light';
import { assignSkips, carrierMap, CASTER_CAP, footprint, selectCasters } from './lights';
import { MIST } from './mist';
import { seenOpeners } from './openers';
import { DEFAULT_HOUR, type R3dParams } from './params';
import { PondLife } from './pond/pondLife';
import { POND_START, POND_TREES, pondMaps } from './pond/pondShape';
import { makePondWater, type PondWater } from './pond/pondWater';
import { seeLook } from './seeThrough';
import { SightMask } from './sightmask';
import { SIGHT_OFF, type SightFrame } from './sightNodes';
import { SkyClock, hourLabel, mistInputs, ovalOf, sky, sunFrame } from './sun';
import { Forest, TREE_BUDGET_MS } from './trees/forest';
import { treeSpecOf, type TreeSpec } from './trees/spec';
import type { Assets, View, WorldInput } from './view';
import { WIND } from './wind';

const TILE = 16;
const KNIGHT_ID = 100;
const KNIGHT_SPEED = 4;
const SEED = 348;
const ALL_VISIBLE = { isVisible: (): boolean => true };
const TREE_KINDS: PlantKind[] = ['round', 'wide', 'tall', 'conifer', 'round', 'wide'];
const BUSHES: [number, number][] = [[7, 2], [13, 1], [19, 2], [26, 1], [32, 2], [38, 1], [44, 2]];

const PLANTS: PlantInfo[] = [
  ...POND_TREES.map(([x, z], i): PlantInfo => [PLANT_KINDS.indexOf(TREE_KINDS[i % TREE_KINDS.length]), x * TILE + TILE / 2, z * TILE + 12, 401 + i, 100, i % 2 === 1, 100, false]),
  ...BUSHES.map(([x, z], i): PlantInfo => [PLANT_KINDS.indexOf('bush'), x * TILE + TILE / 2, z * TILE + 12, 451 + i, 100, i % 2 === 1, 100, false]),
];
/** A willow leaning over the lake's west end. */
const WILLOW: TreeSpec = { form: 'willow', x: 7.5, z: 13.75, seed: 341, scalePct: 100, mirrored: false, leaf: 1, dead: false };

const mix3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

export function createPondStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'setDaylight' | 'setSky'>): Stage {
  const maps = pondMaps();
  maps.view.tiles[Math.floor(WILLOW.z) * maps.view.w + Math.floor(WILLOW.x)] = TILE_ID.Trunk;
  maps.rules.tiles[Math.floor(WILLOW.z) * maps.rules.w + Math.floor(WILLOW.x)] = TILE_ID.Trunk;
  const world: WorldInput = { map: maps.view, painted: true, clear: WOODLAND_CLEAR };
  // The figures read the rules map: a figure on a ShallowWater tile wades.
  const figures = new Figures3d({ ...galleryInit(), map: maps.rules }, assets.frames, atlasBounds(assets.image, assets.frames));
  host?.setDaylight(true);
  host?.setSky(true);

  // `at=x,z`: the knight (and the camera) starts on that tile; for the pictures.
  const at = /[?&]at=(\d+),(\d+)/.exec(search);
  const knight: { x: number; z: number; aim: number; moving: boolean } = { x: at ? Number(at[1]) + 0.5 : POND_START.x, z: at ? Number(at[2]) + 0.5 : POND_START.z, aim: 0, moving: false };
  const cam = { x: knight.x, z: knight.z, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };

  const hardView = new SightView(maps.view.w, maps.view.h);
  const allView = new SightView(maps.view.w, maps.view.h);
  const mask = new SightMask(maps.view, { daylight: true, feather: DEFAULT_HAZE.feather, ramp: DEFAULT_HAZE.ramp });
  let sightKey = '';
  const sightFrame: SightFrame = { mode: 'mist', mask: null, clear: [0, 0, 0], haze: DEFAULT_HAZE, mist: { ...MIST }, mistDay: 1, mistLight: [1, 1, 1], wind: WIND, t: 0 };

  const forest = new Forest([...PLANTS.map(treeSpecOf), WILLOW], maps.view, LEAF_PALETTE.Summer);
  const critters = new Critters3d(maps.paint, SEED);
  const fireflies = new Fireflies(SEED);
  const life = new PondLife(SEED);
  let water: PondWater | null = null;
  (window as unknown as { __pond?: PondLife }).__pond = life; // for the pictures script and a look in the console

  let job: CoverJob | null = null;
  const paint = (): CoverJob => {
    if (!job) {
      job = coverJob(coverSources(maps.paint, { woodland: { seed: SEED }, cove: null, spawnRow: POND_START.z, spots: [] }), SEED);
      job.step(Infinity);
    }
    return job;
  };
  let field: CoverField | null = null;

  const clock = new SkyClock(DEFAULT_HOUR);
  let seconds = 0;
  let wadeT = 0;
  let wasWading = false;

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);
  let shown = '';

  const tileAt = (x: number, z: number): number => maps.rules.get(Math.floor(x), Math.floor(z));
  const walk = (wx: number, wz: number, d: number): void => {
    const len = Math.hypot(wx, wz) || 1;
    const nx = knight.x + (wx / len) * d;
    if (!maps.rules.blocks(Math.floor(nx), Math.floor(knight.z), 'hero')) knight.x = nx;
    const nz = knight.z + (wz / len) * d;
    if (!maps.rules.blocks(Math.floor(knight.x), Math.floor(nz), 'hero')) knight.z = nz;
  };

  return {
    world,
    built(view: View): void {
      const r = paint().result()!;
      view.setGround(r.bare!);
      view.setCover(r);
      field = new CoverField(r);
      // A rebuilt view (lost device) gets a new sheet; the stage's life goes on.
      view.addExtra?.((k) => {
        water = makePondWater(k);
        return water.mesh;
      });
    },
    frame(c: StageCtx): number {
      const params = c.params;
      seconds += c.dt;
      cam.pitch = (params.pitch * Math.PI) / 180;
      cam.yaw = (params.yaw * Math.PI) / 180;
      const hour = clock.hour(params, seconds);
      const s = sky(hour);
      const text = `pond in 3D (spike): ${hourLabel(hour)}; WASD walks`;
      if (text !== shown) { shown = text; label.textContent = text; }

      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      knight.moving = ix !== 0 || iz !== 0;
      const wading = tileAt(knight.x, knight.z) === TILE_ID.ShallowWater;
      if (knight.moving) {
        const w = keysToWorld(cam.yaw, ix, iz);
        walk(w.x, w.z, KNIGHT_SPEED * (wading ? CONST.SHALLOW_SPEED : 1) * c.dt);
        if (w.x !== 0) knight.aim = w.x < 0 ? Math.PI : 0;
      }
      // Wading stirs the surface: a strong ring on entering, one about every 0.3 s while moving (#345).
      wadeT -= c.dt;
      if (wading && !wasWading) { water?.ripple(knight.x, knight.z, 1); wadeT = 0.3; }
      else if (wading && knight.moving && wadeT <= 0) { water?.ripple(knight.x, knight.z, 0.55); wadeT = 0.3; }
      wasWading = wading;
      life.step(c.dt, { x: knight.x, z: knight.z, wading }, water);
      cam.x = knight.x;
      cam.z = knight.z;
      const ents: EntState[] = [{
        id: KNIGHT_ID, kind: KIND.Knight, x: knight.x * TILE, y: knight.z * TILE, hp: 10, anim: knight.moving ? ANIM.Move : ANIM.Idle, aim: knight.aim,
        animMs: c.now * 1000, flags: 0, extra: 0, effects: 0, side: SIDE.Friendly, entangled: 0,
      }];
      c.timer.lap('sim');
      if (!c.view) return 0;

      const game = params.light === 'game';
      const ambient = game ? s.ambient : WORK_AMBIENT;
      const ground = field && params.cover ? (x: number, z: number, rad: number): number => field!.topAt(x, z, rad, params.gh) : undefined;
      const fo = figures.frame(galleryFrame(ents, c.now, c.dt), cam, { ambient, dark: params.dark, torchGlow: !game, oval: game ? ovalOf(s) : 1, ground });
      const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
      const seenMask = params.sight ? mask : null;
      critters.push(fo.cards, assets.frames, cam, seconds, s.day, seenMask, fp, ground);
      fireflies.step(c.dt, cam);
      fireflies.push(fo.glows, cam, s.night, seenMask);
      life.push(fo, assets.frames, cam, seconds, { day: s.day, wind: params.wind, mask: seenMask, view: fp, ground });
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');

      forest.step(cam, TREE_BUDGET_MS);
      c.timer.lap('plants');

      const casters = game ? selectCasters(fo.casters, [], Math.min(CASTER_CAP, params.ccap)) : [];
      assignSkips([], carrierMap([]), casters);
      c.timer.lap('lights');

      let sight: SightFrame = SIGHT_OFF;
      if (params.sight) {
        const key = `${knight.x.toFixed(1)},${knight.z.toFixed(1)}`;
        if (key !== sightKey) {
          sightKey = key;
          hardView.compute(maps.view, knight.x * TILE, knight.z * TILE, CONST.FOV_RADIUS, 'hard');
          allView.compute(maps.view, knight.x * TILE, knight.z * TILE, CONST.FOV_RADIUS, 'all');
        }
        mask.update(hardView, allView, 0);
        sightFrame.mask = mask;
        sightFrame.mist.high = params.mistHigh;
        sightFrame.mist.top = params.mistTop;
        sightFrame.mist.drift = params.mistDrift;
        Object.assign(sightFrame, mistInputs(s, params.wind));
        sightFrame.t = seconds;
        sight = sightFrame;
      }
      c.timer.lap('sight');

      // The sky the water mirrors: blue by day, the haze's colour toward the horizon, dark at night.
      water?.set({ t: seconds, toward: viewRay(cam.pitch, cam.yaw), zenith: mix3([0.015, 0.025, 0.06], [0.3, 0.5, 0.82], s.day), horizon: s.haze });
      const sun = game ? sunFrame(s, fp, cam, maps.view, params, seconds, c.view.maxTexture) : null;
      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.plants = { built: forest.built, total: forest.total };
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam, plan: c.plan, dynamic, lights: [], ambient, shadows: params.shadows, smooth: params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(params) },
          lava: null, lavaVersion: 0, darkvision: null, casters, sight, sun, cover: { on: params.cover, gh: params.gh, wind: params.wind, t: seconds },
          trees: forest.frame({ wind: params.wind, t: seconds, leafOverride: params.leaf === null ? -1 : params.leaf / 100, plain: params.plain, leafRate: params.leafRate }),
        },
        c.timer,
      );
    },
    dispose(): void {
      label.remove();
    },
  };
}

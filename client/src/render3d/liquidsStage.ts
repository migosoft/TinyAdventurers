// The stage of the ?r3d=liquids page (#324): the sunken terrain on its own, no server. One room (liquidsMap.ts) with a water pool
// (shallow rim, deep centre), a lava pool against the east wall and a chasm; an elf wading up and down the rim, a knight walking into
// the lava and out, and an imp beside the water, an imp and a barrel beside the chasm that are pushed in on key 1 (chasm), 2 (deep
// water) and 3 (barrel), or by the panel's buttons. The script (liquidsScript.ts) sends the figures the run's events (`Sink`, `Died`).
// `&push=chasm|water|barrel` asks that push at t = 1 s; `&t=<s>` pins the clock. `window.__r3d.liquids = { t, fallers, ripples }`
// (`ripples`: the live ripples of the water, #345). The water's own `Water3d` is stepped with the page's clock `t` (the elf's wading, the
// imp's drowning, their droplets through the effects); a pinned page steps it in its replay loop too, so the rings, splashes and bubbles of the last seconds show.
// The run's own light list (torches, lava), the sight off, the game light; WASD pans a free camera.
import { KIND, LIGHT_KIND } from '../generated/defs';
import { LightField } from '../game/light';
import { TERRAIN } from '../game/terrain-layers';
import type { EntState } from '../game/world';
import { atlasBounds } from './atlasBounds';
import { freeClamp, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { Effects3d, FX_KIND } from './fx/effects3d';
import { FxPass } from './fx/pass';
import { emitWaterCues } from './fx/waterFx';
import { galleryFrame, galleryInit } from './galleryStage';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient } from './light';
import { assignSkips, carrierMap, CASTER_CAP, footprint, lavaTexels, lightView, selectCasters, selectLights, staticCands, TorchPairs } from './lights';
import { LIQUIDS_TORCHES, liquidsMap } from './liquidsMap';
import { BACK_TIME, SLIDE_TIME, liquidsScript, PUSHES, type Push } from './liquidsScript';
import { seenOpeners } from './openers';
import { reflects, type R3dParams } from './params';
import { seeLook } from './seeThrough';
import { SIGHT_OFF } from './sightNodes';
import type { Assets, View, WorldInput } from './view';
import { Water3d } from './water/water';
import { coverJob, coverSources, type CoverJob } from './cover/coverJob';
import { tilesSeed } from './cover/moss';
import { TILE } from '../sim/map';

const PAN_SPEED = 12;
const KEYS: Record<string, Push> = { Digit1: 'chasm', Digit2: 'water', Digit3: 'barrel' };
const NAMES: Record<Push, string> = { chasm: 'Push chasm', water: 'Push water', barrel: 'Push barrel' };
const NONE_IDS: ReadonlySet<number> = new Set();
const ALL_VISIBLE = { isVisible: (): boolean => true };
/**
 * A pinned clock shows a fall in progress: the first frame plays the REPLAY seconds before it as frames of STEP seconds (the events as the
 * script sends them, the figures drawn and thrown away), then the page holds still (the figures get no time).
 */
const REPLAY = 6;
const STEP = 1 / 60;

export interface LiquidsOpts { push: Push | null; start: number; pinned: boolean; slow: number }

export function parseLiquids(search: string): LiquidsOpts {
  const q = new URLSearchParams(search);
  const t = Number(q.get('t') ?? NaN);
  const push = q.get('push');
  const slow = Number(q.get('slow') ?? 1);
  return {
    push: push === 'chasm' || push === 'water' || push === 'barrel' ? push : null,
    start: Number.isFinite(t) && t > 0 ? t : 0, pinned: q.has('t') && Number.isFinite(t),
    slow: Number.isFinite(slow) && slow > 0 ? slow : 1,
  };
}

export function createLiquidsStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'setPageButtons' | 'syncPageButtons'>): Stage {
  const opts = parseLiquids(search);
  const map = liquidsMap();
  const world: WorldInput = { map, painted: false, clear: 'stone' };
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  const cam = { x: map.w / 2, z: map.h / 2 + 0.6, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };
  const pushes: Record<Push, number | null> = { chasm: null, water: null, barrel: null };
  if (opts.push) pushes[opts.push] = 1;
  const pass = new FxPass(NONE_IDS);
  const fx = new Effects3d(map);
  // Made with the stage, whose clock only runs forward: a new page makes a new one.
  const water = new Water3d(map);
  let t = opts.start;
  let prev = opts.pinned ? t - STEP : t;
  let warmed = !opts.pinned;

  // The field: the wall torches, then a light on every lava tile (ids from 1, as in 2D).
  const field = new LightField(map);
  let lightId = 1;
  for (const tc of LIQUIDS_TORCHES) field.add({ id: lightId++, kind: LIGHT_KIND.Torch, colour: 0xffaa5a, x: tc.tx, y: tc.ty, on: true });
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.get(x, y) === TERRAIN.Lava) field.add({ id: lightId++, kind: LIGHT_KIND.Lava, colour: 0xff4818, x, y, on: true });
  const pairs = new TorchPairs();
  const lava = new Float32Array(map.w * map.h * 4);
  lavaTexels(field, map, lava);
  const torchEnts: EntState[] = LIQUIDS_TORCHES.map((tc, i) => ({
    id: 1 + i, kind: KIND.Torch, x: tc.side === 0 ? (tc.tx + 0.5) * TILE : tc.side === 1 ? tc.tx * TILE + 0.5 : (tc.tx + 1) * TILE - 0.5,
    y: tc.side === 0 ? tc.ty * TILE + 0.5 : (tc.ty + 0.5) * TILE, hp: 10, anim: 1, aim: 0, animMs: 0, flags: 0, extra: tc.side, effects: 0, side: 0, entangled: 0,
  }));
  for (const e of torchEnts) pairs.see(e);

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);

  /** Asks a push at the page's clock; ignored while that push is still playing. */
  const ask = (k: Push): boolean => {
    const at = pushes[k];
    if (at !== null && t < at + SLIDE_TIME + BACK_TIME) return false;
    pushes[k] = t;
    return true;
  };
  host?.setPageButtons(PUSHES.map((k) => ({ name: NAMES[k], pressed: null, press: () => { ask(k); } })));

  // The page's cover: the moss along the pool (`ignoreLava`: a run's dungeon with lava has no moss, this room shows every terrain),
  // built whole at the first build and kept for the rebuilds.
  let job: CoverJob | null = null;
  return {
    world,
    built(view: View): void {
      if (!job) {
        job = coverJob(coverSources(map, { woodland: null, cove: null, spawnRow: 0, spots: [] }, { ignoreLava: true }), tilesSeed(map));
        job.step(Infinity);
      }
      view.setCover(job.result()!);
    },
    frame(c: StageCtx): number {
      const dt = c.dt / opts.slow;
      if (!opts.pinned) t += dt;
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      if (ix || iz) {
        const w = keysToWorld(cam.yaw, ix, iz);
        const len = Math.hypot(w.x, w.z) || 1;
        const q = freeClamp(map, cam.x + (w.x / len) * PAN_SPEED * c.dt, cam.z + (w.z / len) * PAN_SPEED * c.dt);
        cam.x = q.x;
        cam.z = q.z;
      }
      const game = c.params.light === 'game';
      const ambient = game ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
      const look = { ambient, dark: c.params.dark, torchGlow: !game, oval: 1 };
      // A pinned page plays the seconds before its clock once, then holds still.
      let fdt = dt;
      if (opts.pinned) {
        if (!warmed) {
          warmed = true;
          for (let k = Math.ceil(REPLAY / STEP); k >= 1; k--) {
            const tau = t - k * STEP;
            if (tau < 0) continue;
            const w = liquidsScript(tau, STEP, pushes);
            for (const ev of w.events) figures.event(ev);
            const wo = figures.frame(galleryFrame([...torchEnts, ...w.ents], tau, STEP), cam, look);
            for (const fl of wo.falls) fx.emit(FX_KIND.RimDust, tau, fl.x, fl.z, fl.id);
            // The droplets of the replayed seconds too, stamped with the replay's own time (the cues of the main frame go through the pass).
            emitWaterCues(fx, water.step({ dt: STEP, now: tau, figs: wo.figs, sinks: wo.sinks, landed: null, hidden: NONE_IDS }).cues, tau, NONE_IDS);
          }
          fdt = STEP;
        } else fdt = 0;
      }
      // The actors and the events born since the last frame, sent to the figures as a run sends them.
      const sc = liquidsScript(t, Math.max(0, t - prev), pushes);
      prev = t;
      for (const ev of sc.events) figures.event(ev);
      const ents = [...torchEnts, ...sc.ents];
      label.textContent = `liquids (#324): t ${t.toFixed(2)} s; 1 push into the chasm, 2 into deep water, 3 the barrel; WASD pans`;
      c.timer.lap('sim');
      if (!c.view) return 0;

      const fo = figures.frame(galleryFrame(ents, t, fdt), cam, look);
      const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
      const wo = water.step({ dt: fdt, now: t, figs: fo.figs, sinks: fo.sinks, landed: null, hidden: NONE_IDS });
      pass.run(fx, { cam, now: t, quality: c.params.quality, figs: fo.figs, ents: new Map(ents.map((e) => [e.id, e])), shots: [], hiddenShots: NONE_IDS, snap: undefined, hidden: NONE_IDS, you: -1, ownCast: null, falls: fo.falls, water: wo.cues, fp }, fo.glows);
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');
      let lights: ReturnType<typeof selectLights>['list'] = [];
      let inView = 0;
      if (game) {
        const sel = selectLights(staticCands(field, pairs, map, t), lightView(fp, cam), { x: cam.x, z: cam.z }, Math.min(LIGHT_CAP, c.params.lcap));
        lights = sel.list;
        inView = sel.inView;
      }
      const casters = game ? selectCasters(fo.casters, lights, Math.min(CASTER_CAP, c.params.ccap)) : [];
      assignSkips(lights, carrierMap(lights), casters);
      c.timer.lap('lights');
      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.lights = { list: lights.length, inView };
        r.casters = casters.length;
        r.liquids = { t, fallers: figures.fallers, ripples: wo.live };
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam, plan: c.plan, dynamic, lights, ambient, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) },
          lava: game ? lava : null, lavaVersion: 0, darkvision: null, casters, sight: SIGHT_OFF, cracks: [], shafts: c.params.shafts, fx: { tris: pass.blend, lit: pass.lit },
          cover: { on: c.params.cover, gh: c.params.gh, wind: c.params.wind, t: c.now },
          // The water (#345): the page's own clock, so a pinned page holds the waves still.
          water: { ripples: wo.ripples, now: t, reflect: reflects(c.params) },
        },
        c.timer,
      );
    },
    key(e: KeyboardEvent): boolean {
      const k = KEYS[e.code];
      if (!k || e.repeat) return false;
      ask(k);
      host?.syncPageButtons();
      return true;
    },
    dispose(): void {
      label.remove();
      host?.setPageButtons([]);
    },
  };
}

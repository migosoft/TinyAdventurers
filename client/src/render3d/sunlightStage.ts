// The stage of the ?r3d=sunlight page (#307): the sunlight demo room, no server, no login.
// It uses the fixtures of game/sunlightDemoScript.ts: a tall room with a pillar and one Daylight crack at SUN, a knight in the
// patch and one beside it, the room's torch out, and an open alcove with a lit torch. The air is the dungeon's dust and haze only.
// The page keeps its own `SunLook` (the shared `sunLook` stays the run's). Keys: 2 second crack, R reroll (new ids, so new looks),
// V vary on/off. URL: second=1, vary=0 and, with vary=0, shape, patch, slant, from, clouds, often, height, style, rays, glow;
// `shafts=0` turns the shafts off. WASD pans a free camera.
import { ANIM, CONST, KIND, LIGHT, LIGHT_KIND, SIDE } from '../generated/defs';
import { LightField } from '../game/light';
import { DEFAULT_HAZE } from '../game/sightField';
import { sunLook, type SunLook } from '../game/sunmath';
import { HEIGHTS, OFTEN, SECOND, SUN, SUNLIGHT_KNIGHTS, SUNLIGHT_PROPS, SUNLIGHT_TORCHES, SUNLIGHT_VIEWER, SUNLIGHT_WARM, sunlightMap } from '../game/sunlightDemoScript';
import type { EntState } from '../game/world';
import { TILE } from '../sim/map';
import { View as SightView } from '../sim/view';
import { Air3d } from './air/air';
import { CRACK_CAP, crackOf, selectCracks, type Crack } from './air/cracks';
import { atlasBounds } from './atlasBounds';
import { closeCam, freeClamp, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient, stoneClear } from './light';
import { assignSkips,CASTER_CAP, footprint, lightView, selectCasters, selectLights, staticCands, torchOf } from './lights';
import { MIST } from './mist';
import { seenOpeners } from './openers';
import type { R3dParams } from './params';
import { seeLook } from './seeThrough';
import { SightMask } from './sightmask';
import { SIGHT_OFF } from './sightNodes';
import type { Assets, FrameInput, WorldInput } from './view';
import { stoneField } from './stone/field';
import { makeStoneRun } from './stone/stoneRun';

/** The free camera's speed in tiles per second. */
const PAN_SPEED = 12;
/** Ids of the Daylight lights: the first crack's, the second's, plus ROLL_STEP per reroll. */
const FIRST_ID = 1;
const SECOND_ID = 3;
const ROLL_STEP = 1000;

/** What the entity of a prop frame is (the skull has none and stays out of the 3D room). */
const PROP_KIND: Record<string, number | undefined> = { crate: KIND.Barrel };

const ent = (id: number, kind: number, x: number, y: number, o: Partial<EntState> = {}): EntState => ({
  id, kind, x, y, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0,
  side: kind === KIND.Knight ? SIDE.Friendly : SIDE.Neutral, entangled: 0, ...o,
});

/** The entities of the page: the two torches (ids 1, 2; the sunlit room's is out), the two knights and the props. */
export function sunlightEnts(): EntState[] {
  const out: EntState[] = [];
  let id = 1;
  for (const tc of SUNLIGHT_TORCHES) out.push(ent(id++, KIND.Torch, tc.x, tc.y, { extra: tc.side, anim: tc.lit ? 1 : 0 }));
  id = 100;
  for (const k of SUNLIGHT_KNIGHTS) out.push(ent(id++, KIND.Knight, k.x * TILE, k.y * TILE, { aim: k.flip ? Math.PI : 0 }));
  for (const f of SUNLIGHT_PROPS) {
    const kind = PROP_KIND[f.frame];
    if (kind !== undefined) out.push(ent(id++, kind, f.x * TILE, f.y * TILE));
  }
  return out;
}

/**
 * The page's own sun look from the URL keys: shape=straight|widening, patch, slant, from=left|right, clouds, often=1, height (4..7), style=fan|parallel,
 * rays (1..3), glow, vary=0. They apply with vary=0 (a varied sun takes only slant, direction and cloud gap). `gap` is one of OFTEN's arrays.
 */
export function parseSunLook(search: string): SunLook {
  const q = new URLSearchParams(search);
  const look: SunLook = { ...sunLook, gap: OFTEN[0] };
  const num = (k: string): number | null => (q.get(k) !== null && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  if (q.get('shape') !== null) look.widen = q.get('shape') !== 'straight';
  look.patch = num('patch') ?? look.patch;
  look.slant = num('slant') ?? look.slant;
  if (q.get('from') !== null) look.dir = q.get('from') === 'right' ? 1 : -1;
  look.clouds = num('clouds') ?? look.clouds;
  const height = num('height');
  if (height !== null && HEIGHTS.includes(height)) look.height = height;
  const rays = num('rays');
  if (rays === 1 || rays === 2 || rays === 3) look.rays = rays;
  look.glow = num('glow') ?? look.glow;
  const style = q.get('style');
  if (style === 'fan' || style === 'parallel') look.style = style;
  if (q.get('vary') === '0') look.vary = false;
  if (q.get('often') !== null) look.gap = q.get('often') === '1' ? OFTEN[1] : OFTEN[0];
  return look;
}

const ALL_VISIBLE = { isVisible: (): boolean => true };

/** `host`: the panel gets the page's three buttons (Second crack, Reroll, Vary), the same as the keys 2, R and V. */
export function createSunlightStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'setPageButtons' | 'syncPageButtons'>): Stage {
  const map = sunlightMap();
  const world: WorldInput = { map, painted: false, clear: 'stone', stone: stoneField(map) };
  const stoneRun = makeStoneRun(world, { x: map.w / 2, z: map.h / 2 });
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  const cam = { x: map.w / 2, z: 8.8, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };

  const look = parseSunLook(search);
  let second = new URLSearchParams(search).get('second') === '1';
  let roll = 0;
  const viewer = { x: SUNLIGHT_VIEWER.x / TILE, z: SUNLIGHT_VIEWER.y / TILE };
  const hardView = new SightView(map.w, map.h);
  hardView.compute(map, SUNLIGHT_VIEWER.x, SUNLIGHT_VIEWER.y, CONST.FOV_RADIUS, 'hard');
  const mask = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });

  // The field: the alcove's torch, and the Daylight cracks (re-placed on a reroll or when the second one switches).
  const field = new LightField(map);
  for (const tc of SUNLIGHT_TORCHES) if (tc.light) field.add({ id: tc.light.id, kind: LIGHT_KIND.Torch, colour: SUNLIGHT_WARM, x: tc.light.x, y: tc.light.y, on: true, wall: tc.side + 1 });
  let sunIds: number[] = [];
  const placeSuns = (): void => {
    for (const id of sunIds) field.remove(id);
    sunIds = [];
    const at = (id: number, x: number, y: number): void => {
      field.add({ id, kind: LIGHT_KIND.Daylight, colour: LIGHT[LIGHT_KIND.Daylight].colour, x, y, on: true, wall: 0 });
      sunIds.push(id);
    };
    at(FIRST_ID + ROLL_STEP * roll, SUN.x, SUN.y);
    if (second) at(SECOND_ID + ROLL_STEP * roll, SECOND.x, SECOND.y);
  };
  placeSuns();
  const ents = sunlightEnts();
  const air = new Air3d(map);
  const torches = ents.filter((e) => e.kind === KIND.Torch).map((e) => ({ ...torchOf(e), lit: e.anim === 1 }));

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);
  let shown = '';
  const caption = (): void => {
    const s = `sunlight demo in 3D: vary ${look.vary ? 'on' : 'off'} (V), reroll #${roll} (R), second crack ${second ? 'on' : 'off'} (2); WASD pans`;
    if (s !== shown) label.textContent = shown = s;
  };
  const changed = (): void => {
    placeSuns();
    caption();
  };
  host?.setPageButtons([
    { name: 'Second crack', pressed: () => second, press: () => { second = !second; changed(); } },
    { name: 'Reroll', pressed: null, press: () => { roll++; changed(); } },
    { name: 'Vary', pressed: () => look.vary, press: () => { look.vary = !look.vary; changed(); } },
  ]);
  world.taken = { lights: [...field.lights.values()], spawn: { x: map.w / 2, z: map.h / 2 } };

  return {
    world,
    frame(c: StageCtx): number {
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
      caption();
      c.timer.lap('sim');
      stoneRun.frame(c.view);
      if (!c.view) return 0; // the air pauses while the view is rebuilt after a device loss
      const game = c.params.light === 'game';
      const ambient = game ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
      const fo = figures.frame(galleryFrame(ents, c.now, c.dt), cam, { ambient, dark: c.params.dark, torchGlow: !game, oval: 1 });
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');

      mask.update(hardView, null, 0);
      const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
      let lights: ReturnType<typeof selectLights>['list'] = [];
      let inView = 0;
      let cracks: Crack[] = [];
      if (game) {
        // The cracks the viewer sees (as runView3d), and the torch and the bounce fill of each crack as lights.
        cracks = selectCracks(field, fp, c.params.sight ? mask : null, CRACK_CAP, look).map((l) => crackOf(l, look, c.now));
        const sel = selectLights(staticCands(field, c.now, look), lightView(fp, cam), viewer, Math.min(LIGHT_CAP, c.params.lcap));
        lights = sel.list;
        inView = sel.inView;
      }
      const casters = game ? selectCasters(fo.casters, lights, Math.min(CASTER_CAP, c.params.ccap)) : [];
      assignSkips(lights, casters);
      c.timer.lap('lights');
      const sight = c.params.sight
        ? { mode: 'dark' as const, mask, clear: stoneClear(ambient), haze: DEFAULT_HAZE, mist: MIST, mistDay: 1, mistLight: [1, 1, 1] as [number, number, number], wind: [0, 0] as [number, number], t: c.now }
        : SIGHT_OFF;
      c.timer.lap('sight');

      // The air: dust (in the sun's patch too) and haze; no smoke, embers or drips.
      const p2 = c.params;
      const parts = air.step({
        dt: c.dt, t: c.now, fp, mask: p2.sight ? mask : null, torches, shots: [], movers: [], lights, cracks,
        on: { dust: p2.dust, smoke: false, embers: false, drips: false, stir: p2.stir, draft: p2.draft }, respawn: p2.respawn,
        drift: null, kinds: 'dungeon',
      });
      const frameAir: NonNullable<FrameInput['air']> = { parts, haze: { on: p2.haze, t: c.now } };
      c.timer.lap('air');

      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.lights = { list: lights.length, inView };
        r.casters = casters.length;
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) },
          lava: null, lavaVersion: 0, darkvision: null,
          casters, sight, cracks, shafts: c.params.shafts, air: frameAir,
        },
        c.timer,
      );
    },
    key(e: KeyboardEvent): boolean {
      if (e.repeat) return false;
      if (e.code === 'Digit2') second = !second;
      else if (e.code === 'KeyR') roll++;
      else if (e.code === 'KeyV') look.vary = !look.vary;
      else return false;
      changed();
      host?.syncPageButtons();
      return true;
    },
    dispose(): void {
      label.remove();
      host?.setPageButtons([]);
    },
  };
}

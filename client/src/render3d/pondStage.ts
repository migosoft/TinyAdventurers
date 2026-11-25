// The stage of the ?r3d=pond page (#360): a generated woodland pond (pond-demo.json) drawn as a run draws it, no server. The knight walks the
// rules map (deep water blocks, shallow water slows) and is drawn on the view map (a bridge's tiles are water, the deck lifts the feet).
// `&pond=0..3` picks the level (0 plain pond, 1 inflow with a road bridge, 2 inflow and outflow, 3 a pond bridge; default 1),
// `&at=pond|mouth|bridge|stream` the start of the knight (the camera holds on the pond's middle at `pond` until the first step), `&hour=`,
// `&t=<s>` pins every clock, `&zoom=`, `&dry=1` leaves the water's surface out (the bed for look work). The stage owns one `PondScene` (the pond's field and the hooks the later pond work fills in).
import { ANIM, KIND, LEAF_PALETTE, SIDE, TILE_ID } from '../generated/defs';
import type { PondInfo } from '../generated/PondInfo';
import type { WoodlandInfo } from '../generated/WoodlandInfo';
import demo from '../generated/pond-demo.json';
import { TILE, TileMap } from '../sim/map';
import { atlasBounds } from './atlasBounds';
import { closeCam, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { CoverField } from './cover/coverField';
import { coverJob, coverSources, type CoverJob } from './cover/coverJob';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { WOODLAND_CLEAR, WORK_AMBIENT } from './light';
import { footprint } from './lights';
import { DEFAULT_HOUR, reflects, type R3dParams } from './params';
import { walkBedAt } from './dips/shape';
import { pondField, pondViewMap, setPondField, type PondField } from './pond/pondField';
import { seenOpeners } from './openers';
import { seeLook } from './seeThrough';
import { SIGHT_OFF } from './sightNodes';
import { SkyClock, hourLabel, ovalOf, sky, sunFrame, waterSky } from './sun';
import { Forest, TREE_BUDGET_MS } from './trees/forest';
import { treeSpecOf } from './trees/spec';
import type { Assets, View, WorldInput } from './view';
import { Water3d } from './water/water';
import type { EntState } from '../game/world';

const KNIGHT_ID = 100;
const KNIGHT_SPEED = 4; // tiles per second
const ALL_VISIBLE = { isVisible: (): boolean => true };
const NONE_IDS: ReadonlySet<number> = new Set();
/** With `&t=`: the water is stepped up to the pinned time in steps of this many seconds, over the last WARM_MAX seconds at most. */
const WARM_STEP = 1 / 30, WARM_MAX = 60;

/** What the pond's later work fills in: the pond's field, a step per frame with the figures' tile positions, and the push of its drawables. Empty for now (the fish need neither: `Water3d` steps them and the water's material draws them). */
export interface PondScene {
  field: PondField;
  step(dt: number, figs: { x: number; z: number }[]): void;
  push(): void;
}

/** The page's stage: the knight's tile position and the pond scene are readable (tests, the shots script). */
export interface PondStage extends Stage {
  scene: PondScene;
  knight: { x: number; z: number };
  /** The pond's body: the tiles (z * width + x) of its water without its streams and decks. */
  body: ReadonlySet<number>;
}

/** The first walkable dry tile of rules `map` at `ok`, searching rings around (tx, tz). */
function nearestLand(map: TileMap, tx: number, tz: number, ok: (x: number, z: number) => boolean = () => true): { x: number; z: number } | null {
  for (let r = 0; r < 40; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = Math.floor(tx) + dx, z = Math.floor(tz) + dz;
      const t = map.get(x, z);
      if (!map.blocks(x, z, 'hero') && t !== TILE_ID.ShallowWater && ok(x, z)) return { x: x + 0.5, z: z + 0.5 };
    }
  }
  return null;
}

export function createPondStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'setDaylight' | 'setSky'>): PondStage {
  const q = new URLSearchParams(search);
  const n = Number(q.get('pond') ?? 1);
  const idx = Number.isInteger(n) && n >= 0 && n < demo.length ? n : 1;
  const level = demo[idx];
  const wl = level.woodland as unknown as WoodlandInfo;
  const pond = wl.pond as PondInfo;
  const rules = new TileMap(level.w, level.h, Uint8Array.from(level.tiles));
  // The view draws a copy (a bridge's tiles are water) with the pond's field, as a run does.
  const map = pondViewMap(rules, pond);
  const field = pondField(rules, pond);
  setPondField(map, field);
  const scene: PondScene = { field, step() {}, push() {} };
  const pin = q.has('t') && Number.isFinite(Number(q.get('t'))) ? Number(q.get('t')) : null;

  // The pond's middle: the water tile farthest from the shore.
  let mid = { x: 0, z: 0 }, best = -1;
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
    if (rules.get(x, z) !== TILE_ID.DeepWater && rules.get(x, z) !== TILE_ID.ShallowWater) continue;
    const s = field.shoreAt(x + 0.5, z + 0.5);
    if (s > best) { best = s; mid = { x: x + 0.5, z: z + 0.5 }; }
  }
  const isW = (x: number, z: number): boolean => map.get(x, z) === TILE_ID.ShallowWater || map.get(x, z) === TILE_ID.DeepWater;
  // The pond's body: the water tiles connected to its middle (4-neighbours) without crossing a stream cell (within 1 tile of a stream's line
  // with the shore <= 1 tile away) or a bridge-deck tile (water on the view map only).
  const nearLine = (x: number, z: number): boolean => pond.streams.some((s) => s.points.some((a, i) => {
    if (!i) return false;
    const [ax, az] = [s.points[i - 1][0] / TILE, s.points[i - 1][1] / TILE], [bx, bz] = [a[0] / TILE, a[1] / TILE];
    const ex = bx - ax, ez = bz - az, t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    return Math.hypot(x - (ax + ex * t), z - (az + ez * t)) <= 1;
  }));
  const body = new Set<number>();
  const open = [Math.floor(mid.z) * map.w + Math.floor(mid.x)];
  while (open.length) {
    const k = open.pop()!, x = k % map.w, z = Math.floor(k / map.w);
    if (body.has(k) || (rules.get(x, z) !== TILE_ID.ShallowWater && rules.get(x, z) !== TILE_ID.DeepWater)) continue; // rules water: a deck tile is not
    if (nearLine(x + 0.5, z + 0.5) && field.shoreAt(x + 0.5, z + 0.5) <= 1) continue;
    body.add(k);
    open.push(k + 1, k - 1, k + map.w, k - map.w);
  }
  const bodyNear = (x: number, z: number, r: number): boolean => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (body.has((z + j) * map.w + x + i)) return true;
    return false;
  };
  // On the road's side: dry ground with no water beside it and the pond's body within two tiles, nearest to the road tile nearest to the pond's middle.
  const pondStart = (): { x: number; z: number } => {
    let road: { x: number; z: number } | null = null, rd = Infinity;
    for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
      if (rules.get(x, z) !== TILE_ID.Road) continue;
      const d = Math.hypot(x - mid.x, z - mid.z);
      if (d < rd) { rd = d; road = { x, z }; }
    }
    const goal = road ?? mid;
    let found: { x: number; z: number } | null = null, fd = Infinity;
    for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) {
      if (rules.blocks(x, z, 'hero') || isW(x, z) || isW(x + 1, z) || isW(x - 1, z) || isW(x, z + 1) || isW(x, z - 1) || !bodyNear(x, z, 2)) continue;
      const d = Math.hypot(x - goal.x, z - goal.z);
      if (d < fd) { fd = d; found = { x: x + 0.5, z: z + 0.5 }; }
    }
    return found ?? nearestLand(rules, mid.x, mid.z)!;
  };
  const at = q.get('at');
  const tileAt = /^(\d+),(\d+)$/.exec(at ?? ''); // `at=x,z`: that tile, when the knight can stand there (for the pictures and tests)
  const start = ((): { x: number; z: number } => {
    if (tileAt && !rules.blocks(Number(tileAt[1]), Number(tileAt[2]), 'hero')) return { x: Number(tileAt[1]) + 0.5, z: Number(tileAt[2]) + 0.5 };
    if (at === 'mouth' && field.mouths.length) { const m = field.mouths[0]; return nearestLand(rules, m.x - m.dz * 2, m.z + m.dx * 2) ?? pondStart(); }
    if (at === 'bridge' && field.decks.length) {
      const d = field.decks[0];
      return d.alongX ? { x: d.x0 + 0.5, z: (d.z0 + d.z1) / 2 } : { x: (d.x0 + d.x1) / 2, z: d.z0 + 0.5 };
    }
    if (at === 'stream' && pond.streams.length) {
      const pts = pond.streams[0].points, i = Math.max(1, pts.length >> 1), m = pts[i], a = pts[i - 1];
      const len = Math.hypot(m[0] - a[0], m[1] - a[1]) || 1; // beside the point, 2 tiles along the perpendicular of the line
      return nearestLand(rules, m[0] / TILE - ((m[1] - a[1]) / len) * 2, m[1] / TILE + ((m[0] - a[0]) / len) * 2) ?? pondStart();
    }
    return pondStart();
  })();
  const knight = { x: start.x, z: start.z, aim: 0, moving: false };
  let focus: { x: number; z: number } | null = !at || at === 'pond' ? mid : null; // the camera holds on the pond's middle until the knight walks
  const cam = { x: knight.x, z: knight.z, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };

  const world: WorldInput = { map, painted: true, clear: WOODLAND_CLEAR, stone: null, dry: q.get('dry') === '1' };
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  host?.setDaylight(true);
  host?.setSky(true);
  const forest = new Forest(wl.plants.map(treeSpecOf), map, wl.palette ?? LEAF_PALETTE.Summer);
  const water = new Water3d(map);
  // A pinned clock shows the pond as it is after that many seconds (the last WARM_MAX of them): the fish have swum, and fled the knight if it stands in the water.
  if (pin !== null) {
    const figs = [{ id: KNIGHT_ID, x: knight.x, z: knight.z, foot: walkBedAt(map, knight.x, knight.z), dashing: false }];
    for (let s = Math.max(0, pin - WARM_MAX) + WARM_STEP; s <= pin; s += WARM_STEP) water.step({ dt: WARM_STEP, now: s, figs, sinks: [], landed: null, hidden: NONE_IDS });
  }

  let job: CoverJob | null = null;
  const paint = (): CoverJob => {
    if (!job) {
      job = coverJob(coverSources(map, { woodland: wl, cove: null, spawnRow: knight.z, spots: [] }), wl.seed);
      job.step(Infinity);
    }
    return job;
  };
  let cover: CoverField | null = null;

  const clock = new SkyClock(DEFAULT_HOUR);
  let seconds = 0;
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);

  /** Moves the knight by `d` tiles along the world direction (wx, wz), one axis at a time, on the rules map. */
  const walk = (wx: number, wz: number, d: number): void => {
    const len = Math.hypot(wx, wz) || 1;
    const nx = knight.x + (wx / len) * d;
    if (!rules.blocks(Math.floor(nx), Math.floor(knight.z), 'hero')) knight.x = nx;
    const nz = knight.z + (wz / len) * d;
    if (!rules.blocks(Math.floor(knight.x), Math.floor(nz), 'hero')) knight.z = nz;
  };

  return {
    world, scene, knight, body,
    built(view: View): void {
      const r = paint().result()!;
      view.setGround(r.bare!);
      view.setCover(r);
      cover = new CoverField(r);
    },
    frame(c: StageCtx): number {
      const params = c.params;
      const dt = pin !== null ? 0 : c.dt;
      seconds = pin ?? seconds + c.dt;
      const now = pin ?? c.now;
      cam.pitch = (params.pitch * Math.PI) / 180;
      cam.yaw = (params.yaw * Math.PI) / 180;
      const hour = clock.hour(params, seconds);
      const s = sky(hour);
      label.textContent = `pond ${idx}, at=${at ?? 'pond'}: ${hourLabel(hour)}; WASD walks`;

      let ix = 0, iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      knight.moving = ix !== 0 || iz !== 0;
      if (knight.moving) {
        focus = null;
        const w = keysToWorld(cam.yaw, ix, iz);
        walk(w.x, w.z, KNIGHT_SPEED * rules.speedFactor(knight.x * TILE, knight.z * TILE, 'hero') * c.dt);
        if (w.x !== 0) knight.aim = w.x < 0 ? Math.PI : 0;
      }
      cam.x = focus?.x ?? knight.x;
      cam.z = focus?.z ?? knight.z;
      scene.step(dt, [{ x: knight.x, z: knight.z }]);
      const ents: EntState[] = [{
        id: KNIGHT_ID, kind: KIND.Knight, x: knight.x * TILE, y: knight.z * TILE, hp: 10, anim: knight.moving ? ANIM.Move : ANIM.Idle, aim: knight.aim,
        animMs: now * 1000, flags: 0, extra: 0, effects: 0, side: SIDE.Friendly, entangled: 0,
      }];
      c.timer.lap('sim');
      if (!c.view) return 0;

      const game = params.light === 'game';
      const ambient = game ? s.ambient : WORK_AMBIENT;
      const ground = cover && params.cover ? (x: number, z: number, rad: number): number => cover!.topAt(x, z, rad, params.gh) : undefined;
      const fo = figures.frame(galleryFrame(ents, now, dt), cam, { ambient, dark: params.dark, oval: game ? ovalOf(s) : 1, ground });
      const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
      scene.push();
      const wo = water.step({ dt, now, figs: fo.figs, sinks: fo.sinks, landed: null, hidden: NONE_IDS });
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');
      forest.step(cam, TREE_BUDGET_MS);
      c.timer.lap('plants');
      const sun = game ? sunFrame(s, fp, cam, map, params, seconds, c.view.maxTexture) : null;
      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.plants = { built: forest.built, total: forest.total };
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights: [], ambient, shadows: params.shadows, smooth: params.smooth, t: now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(params) },
          brush: [], lava: null, lavaVersion: 0, darkvision: null, casters: [], sight: SIGHT_OFF, sun,
          cover: { on: params.cover, gh: params.gh, wind: params.wind, t: seconds },
          water: { ripples: wo.ripples, now, reflect: reflects(params), sky: waterSky(s), fish: wo.fish },
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

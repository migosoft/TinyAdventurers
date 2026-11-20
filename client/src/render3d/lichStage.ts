// SPIKE (#358), throwaway: the stage of `?r3d=lich`. A boss hall of 26 x 20 tiles, the knight (WASD) as the measure of a human, and the
// lich try-out of `lichSpike.ts`. The panel's buttons play each action in a loop. For check shots: `&act=nova|raise|fling|gaze`,
// `&at=<s>` (pins the action's clock), `&glide=1`, `&claws=0`, `&size=<humans>`, `&face=<deg>`, `&t=<s>` (pins the clock), `&px=`/`&pz=`.

import { closeCam, keysToWorld, viewRay } from './camera';
import { buildDynamic } from './cards';
import { parseMap } from './demoMap';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { ACTION_SECS, createLichSpike, LICH_DIMS, type LichAction } from './lichSpike';
import { sceneLights } from './light';
import { newScene, stepScene } from './scene';
import { seeLook } from './seeThrough';
import type { Assets, View, WorldInput } from './view';

const HALL_W = 26, HALL_H = 20, WALL = 2;
const AMBIENT: [number, number, number] = [0.5, 0.48, 0.5];
const SPEED = 2.2, PAUSE = 1.8;

export function createLichStage(assets: Assets, initialParams: { pitch: number; yaw: number }, search: string, host?: Pick<Host, 'setPageButtons'>): Stage {
  const q = new URLSearchParams(search);
  const num = (key: string, def: number): number => { const v = Number(q.get(key) ?? NaN); return Number.isFinite(v) ? v : def; };
  const rows = [...Array(HALL_H + 2 * WALL).keys()].map((z) => (z < WALL || z >= HALL_H + WALL ? '#'.repeat(HALL_W + 2 * WALL) : '#'.repeat(WALL) + '.'.repeat(HALL_W) + '#'.repeat(WALL)));
  const map = parseMap(rows);
  const world: WorldInput = { map, painted: false, clear: 'stone' };
  const centre = { x: WALL + HALL_W / 2, z: WALL + HALL_H / 2 };
  const scene = newScene();
  scene.player.x = num('px', centre.x + 1.6);
  scene.player.z = num('pz', centre.z + 2.4);
  scene.ents = [scene.player];
  scene.props = [];
  scene.torches = [...Array(4).keys()].map((i) => ({ x: WALL + 3 + i * 7 + 0.5, y: 1.0, z: WALL + 0.16, ph: i * 1.7 }));
  const lich = { x: centre.x, z: centre.z, face: (num('face', 30) * Math.PI) / 180 };
  const cam = { x: lich.x, z: lich.z, pitch: (initialParams.pitch * Math.PI) / 180, yaw: (initialParams.yaw * Math.PI) / 180 };
  const pinned = q.has('t') ? num('t', 0) : null, pinnedAt = q.has('at') ? num('at', 0) : null, fixedFace = q.has('face');
  const state = { size: num('size', 1.2), claws: q.get('claws') !== '0', glide: q.get('glide') === '1', action: (q.get('act') ?? 'idle') as LichAction, at: 0 };
  const path = [[-6, -3], [6, -3], [6, 4], [-6, 4]].map(([x, z]) => ({ x: centre.x + x, z: centre.z + z }));
  let leg = 0, wait = 0;
  const spike = createLichSpike();
  let view: View | null = null;
  let clock = 0;
  // cost readout (#358, Task 1): the running mean of `spike.step` in ms as `window.__r3d.lichMs`; `&lich=0` leaves the lich out
  const lichOn = q.get('lich') !== '0';
  let lichMs = 0;

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);color:#dfe6f2;background:rgba(10,10,16,.72);padding:5px 12px;border-radius:6px;font:13px sans-serif;z-index:5;pointer-events:none;text-align:center;white-space:nowrap';
  document.body.appendChild(label);
  const describe = (): void => {
    const tall = state.size * 18;
    label.innerHTML = `lich ${state.size.toFixed(2)} humans tall (${tall.toFixed(1)} px, ${(tall / 16).toFixed(2)} tiles) · staff ${((tall * LICH_DIMS.staff) / LICH_DIMS.height / 16).toFixed(2)} tiles · the hem lies ${((tall * LICH_DIMS.hem) / LICH_DIMS.height / 16).toFixed(2)} tiles across · the knight is one human`;
  };
  describe();
  const size = (s: number) => ({ name: `${s}×`, pressed: () => state.size === s, press: () => { state.size = s; describe(); } });
  const act = (name: string, a: LichAction) => ({ name, pressed: () => state.action === a && !state.glide, press: () => { state.action = a; state.at = 0; state.glide = false; } });
  host?.setPageButtons([
    act('Stand', 'idle'),
    { name: 'Glide', pressed: () => state.glide, press: () => { state.glide = !state.glide; state.action = 'idle'; } },
    act('Nova', 'nova'), act('Raise Dead', 'raise'), act('Bolts / curse', 'fling'), act('Stone Gaze', 'gaze'),
    { name: 'Claws', pressed: () => state.claws, press: () => { state.claws = !state.claws; } },
    size(1.1), size(1.2), size(1.3),
  ]);

  const step = (dt: number, c: StageCtx): void => {
    clock += dt;
    let faceTo = Math.atan2(scene.player.z - lich.z, scene.player.x - lich.x);
    if (state.glide) {
      if (wait > 0) wait -= dt;
      else {
        const to = path[leg], dx = to.x - lich.x, dz = to.z - lich.z, d = Math.hypot(dx, dz), go = SPEED * dt;
        if (d <= go) { lich.x = to.x; lich.z = to.z; leg = (leg + 1) % path.length; wait = PAUSE; } else { lich.x += (dx / d) * go; lich.z += (dz / d) * go; faceTo = Math.atan2(dz, dx); }
      }
    }
    if (!fixedFace) lich.face += Math.atan2(Math.sin(faceTo - lich.face), Math.cos(faceTo - lich.face)) * (1 - Math.exp(-dt * 4));
    if (pinnedAt !== null) state.at = pinnedAt;
    else if (state.action !== 'idle') { state.at += dt; if (state.at > ACTION_SECS[state.action] + 0.9) state.at = 0; }
    if (!lichOn) return;
    const t0 = performance.now();
    spike.step(dt, clock, {
      x: lich.x, z: lich.z, face: lich.face, size: state.size, action: state.action, at: state.at, claws: state.claws,
      look: { x: scene.player.x, z: scene.player.z }, stretch: 1 / Math.cos(cam.pitch), view: viewRay(cam.pitch, cam.yaw),
    });
    lichMs += (performance.now() - t0 - lichMs) * 0.02;
    const r = window.__r3d as unknown as Record<string, unknown> | undefined;
    if (r) r.lichMs = lichMs;
    void c;
  };

  return {
    world,
    built(v: View): void {
      view = v;
      if (lichOn) spike.attach(v.spike!.scene);
    },
    frame(c: StageCtx): number {
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      stepScene(map, scene, ix || iz ? keysToWorld(cam.yaw, ix, iz) : { x: 0, z: 0 }, c.dt);
      // a pinned clock (`&t=`) runs up to its time in fixed steps, then stands still
      if (pinned === null) step(c.dt, c);
      else {
        for (let i = 0; i < 60 && clock < pinned; i++) step(Math.min(1 / 30, pinned - clock), c);
        step(0.0001, c);
      }
      const k = 1 - Math.exp(-c.dt * 6);
      cam.x += (lich.x + 0.4 - cam.x) * k;
      cam.z += (lich.z - 0.5 - cam.z) * k;
      const dynamic = buildDynamic(scene, assets.frames, cam, c.now, false);
      const lights = sceneLights(scene, c.now, false);
      if (!c.view || !view) return 0;
      c.timer.renderStart();
      return c.view.draw(
        { cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient: AMBIENT, lava: null, lavaVersion: 0, darkvision: null, casters: [], shadows: c.params.shadows, smooth: c.params.smooth, t: c.now, see: { openers: [{ id: 0, x: scene.player.x, z: scene.player.z, mid: 0.5, who: 'hero' }], look: seeLook(c.params) }, cover: { on: c.params.cover, gh: c.params.gh, wind: c.params.wind, t: c.now } },
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

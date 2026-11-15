// The glowing shots in flight and their wall hits (#308, design §6): a fire bolt is a lumpy ball of fire with a trail of sparks, a frost
// bolt a crystal with ice dust, every other glowing shot a pulsing core with a glow and a trail of motes (the lich's gloom shots trail
// dark wisps). Shots carry the server's light, so none is added here. A shot's picture is a pure function of (clock, seed, place, aim);
// its trail lies behind the drawn position along the flight, so no history is kept. Frame shots (arrows, the axe) stay cards.
import { GLOOM } from '../../game/fxLooks';
import { isProjectileKind, PROJECTILES } from '../../game/anim/defs';
import { KIND, RUNE_LOOK } from '../../generated/defs';
import { TILE } from '../../sim/map';
import { pushGlow } from '../cards';
import { SHOT_LIFT } from '../camera';
import { hash3 } from './rand';
import { FX_KIND, registerFx, type FxFrame, type FxRec } from './effects3d';
import { RUNE_PALETTES } from './runes';
import { BALL1, burst, crystal, dot, fireBall, fireColour, PX, type BurstSpec, type MV3, type V3 } from './shapes';
import type { FxCtx, FxOut } from './types';

const GLOOM_DARK = GLOOM.dark, GLOOM_MID = GLOOM.mid;

export type ShotLook = 'fire' | 'cold' | 'glow';

/** How a projectile kind is drawn in 3D, or null for a frame shot (a card) and unknown kinds. */
export function shotLook(kind: number): ShotLook | null {
  const pd = PROJECTILES[kind];
  if (!pd || pd.frame || pd.glow === undefined) return null;
  if (kind === KIND.Fireball || kind === KIND.FireBolt || kind === KIND.FireOrb || kind === KIND.DragonFireball) return 'fire';
  if (kind === KIND.FrostBolt) return 'cold';
  return 'glow';
}

const col: MV3 = [0, 0, 0];
const rgbIn = (c: number, out: MV3): MV3 => { out[0] = ((c >> 16) & 255) / 255; out[1] = ((c >> 8) & 255) / 255; out[2] = (c & 255) / 255; return out; };

const TRAIL_FIRE = 16, TRAIL_COLD = 14, TRAIL_GLOW = 8, WISPS = 6;

/** One glowing shot at (x, y, z) tiles flying along world angle `dir` (radians), `age` seconds on the run's clock. */
export function shotTris(out: FxOut, ctx: FxCtx, kind: number, x: number, y: number, z: number, dir: number, age: number, seed: number): void {
  const look = shotLook(kind);
  if (look === null) return;
  const pd = PROJECTILES[kind];
  const T = out.tris, ax = ctx.ax, dx = Math.cos(dir), dz = Math.sin(dir);
  const sd = seed | 0, step = Math.floor(age * 24);
  if (look === 'fire') {
    const size = kind === KIND.DragonFireball ? 1.6 : 1;
    fireBall(T, BALL1, x, y, z, 0.17 * size, age * 3, (sd & 1023) * 0.0137, 1.05, 0, false);
    for (let i = 0; i < TRAIL_FIRE; i++) {
      const back = ((i / TRAIL_FIRE) * 0.28 + hash3(sd, i, 90) * 0.03) * size;
      const jx = (hash3(sd, i, 91 + step) - 0.5) * 0.16 * size, jy = (hash3(sd, i, 92 + step) - 0.5) * 0.16 * size + back * 0.5, jz = (hash3(sd, i, 93 + step) - 0.5) * 0.16 * size;
      fireColour(1 - (back / size) * 3, col);
      dot(T, ax, x - dx * back + jx, y + jy, z - dz * back + jz, PX, col[0], col[1], col[2], 1 - back / size / 0.31);
    }
    const c = RUNE_PALETTES[RUNE_LOOK.Fire].runes[0];
    pushGlow(out.glows, x, y, z, 0.55, [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55], ctx.cam);
  } else if (look === 'cold') {
    const base: V3 = [x - dx * 0.3, y, z - dz * 0.3];
    crystal(T, base, [dx, 0, dz], 0.55, 0.075, 0.95);
    for (let i = 0; i < TRAIL_COLD; i++) {
      const back = (i / TRAIL_COLD) * 0.3 + hash3(sd, i, 90) * 0.03;
      const jx = (hash3(sd, i, 91 + step) - 0.5) * 0.2, jy = (hash3(sd, i, 92 + step) - 0.5) * 0.2 - back * 0.4, jz = (hash3(sd, i, 93 + step) - 0.5) * 0.2;
      const w = i % 3 === 0;
      dot(T, ax, x - dx * back + jx, y + jy, z - dz * back + jz, PX, w ? 1 : 0.7, w ? 1 : 0.88, 1, 1 - back / 0.33);
    }
    const c = RUNE_PALETTES[RUNE_LOOK.Cold].runes[0];
    pushGlow(out.glows, x, y, z, 0.55, [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55], ctx.cam);
  } else {
    const glow = rgbIn(pd.glow as number, col), gr = glow[0], gg = glow[1], gb = glow[2];
    const pulse = 0.9 + 0.15 * Math.sin(age * 20), core = (pd.scale * 3) / 16 * pulse;
    dot(T, ax, x, y, z, core, gr, gg, gb, 1);
    dot(T, ax, x, y, z, core * 0.5, 1, 1, 1, 1);
    pushGlow(out.glows, x, y, z, (pd.scale * 7) / TILE, [gr, gg, gb], ctx.cam);
    if (pd.gloom) {
      for (let i = 0; i < WISPS; i++) {
        const k = (hash3(sd, i, 94) + age * 1.4) % 1, back = k * 0.3;
        const m = rgbIn(i % 2 ? GLOOM_MID : GLOOM_DARK, col);
        dot(T, ax, x - dx * back + (hash3(sd, i, 95) - 0.5) * 0.14, y + k * 0.15 + (hash3(sd, i, 96) - 0.5) * 0.1, z - dz * back + (hash3(sd, i, 97) - 0.5) * 0.14, PX * 1.6 * (1 - k * 0.4), m[0], m[1], m[2], 0.75 * (1 - k));
      }
    } else if (pd.trail !== undefined) {
      const t = rgbIn(pd.trail, col), tr = t[0], tg = t[1], tb = t[2];
      for (let i = 0; i < TRAIL_GLOW; i++) {
        const back = (i / TRAIL_GLOW) * 0.25 + hash3(sd, i, 90) * 0.03;
        const jx = (hash3(sd, i, 91 + step) - 0.5) * 0.1, jy = (hash3(sd, i, 92 + step) - 0.5) * 0.1, jz = (hash3(sd, i, 93 + step) - 0.5) * 0.1;
        dot(T, ax, x - dx * back + jx, y + jy, z - dz * back + jz, PX, tr, tg, tb, 1 - back / 0.3);
      }
    }
  }
}

/** Draws the shots of the frame: the server's projectile entities (unless hidden) and the own predicted shots. */
export function drawShots(out: FxOut, f: FxFrame): void {
  const ctx = f.ctx;
  for (const e of f.ents.values()) {
    if (!isProjectileKind(e.kind) || f.hiddenShots.has(e.id)) continue;
    shotTris(out, ctx, e.kind, e.x / TILE, SHOT_LIFT, e.y / TILE, e.aim, ctx.now, e.id);
  }
  for (const s of f.shots) shotTris(out, ctx, s.kind, s.x / TILE, SHOT_LIFT, s.y / TILE, Math.atan2(s.vy, s.vx), ctx.now, s.shot);
}

const FIRE_SPARKS = [0xffd060, 0xff8020, 0xfff0b0];
const ICE_DUST = [0xb0e0ff, 0xffffff, 0x8cc8ff];
const oneColour = [0xffffff];
const hitSpec: BurstSpec = { x: 0, y: 0, z: 0, n: 0, speed: [1.5, 4], up: [0.1, 1.2], life: [0.25, 0.45], g: 9, drag: 0, size: 0.035, colours: FIRE_SPARKS, streak: true };

/** The sparks of a shot that hit a wall (`rec.a` is the shot's kind). Retires the record for shots that are cards. */
function drawHit(out: FxOut, f: FxFrame, rec: FxRec, age: number): void | boolean {
  const look = shotLook(rec.a);
  if (look === null) return false;
  const s = hitSpec;
  s.x = rec.x; s.y = SHOT_LIFT; s.z = rec.z;
  if (look === 'fire') {
    s.n = 10; s.g = 9; s.drag = 0; s.size = 0.035; s.streak = true; s.colours = FIRE_SPARKS; s.speed = [1.5, 4];
  } else if (look === 'cold') {
    s.n = 12; s.g = 2; s.drag = 3.2; s.size = 0.05; s.streak = false; s.colours = ICE_DUST; s.speed = [1, 2.5];
  } else {
    oneColour[0] = PROJECTILES[rec.a].trail ?? 0xffffff;
    s.n = 8; s.g = 9; s.drag = 0; s.size = 0.035; s.streak = true; s.colours = oneColour; s.speed = [1.5, 4];
  }
  burst(out.tris, f.ctx.ax, s, age, rec.seed);
}

/** Registers the drawer of wall hits (the shots in flight are drawn by `drawShots`, which `Effects3d.frame` calls). */
export function registerShots(): void {
  registerFx(FX_KIND.ShotHit, drawHit);
}

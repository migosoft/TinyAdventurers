// Dev page ?sunlight (no server): sunlight through a ceiling crack, to judge the look (#156).
// One tall room with a pillar and one Daylight light in its middle (a pale beam from above onto a soft
// bright floor patch, dust motes in the beam). One knight stands in the patch and one beside it, the
// south-west corner is left dark, the room's wall torch is out, and an open alcove on the east side has
// a lit torch, so warm and daylight can be compared. The viewer sees the whole scene. Mood is on (dust, haze), so beam dust can be judged against normal dust.
// Buttons at the bottom (tap or click) cycle: Shape (widening / straight), Patch (1.5 / 2 / 3 tiles),
// Slant (0 / 1 / 1.5 / 2 tiles; starts on the picked 2), From (left / right), Clouds (off / soft / medium / strong),
// Often (normal / often: a cloud every 2-4 s instead of 8-25 s), Height (3 / 4 / 5 / 6 tiles, ceiling to floor), Rays (1 / 2 / 3 narrower rays per crack), Glow (x1 / x1.5 / x2: brightness of beam
// and patch) and switch Beam and Dust on / off.
// URL: ?shape=straight&patch=3&slant=2&from=right&clouds=0.3&often=1&height=5&rays=2&glow=1.5&beam=0&dust=0 (clouds is 0..0.6, the dip).
// Zoomed to fit the rooms to the screen, so it reads on a phone.
import Phaser from 'phaser';
import { CONST, LIGHT, LIGHT_KIND, TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { tileDraws } from './autotile';
import { Effects, DEPTH } from './effects';
import { LightField } from './light';
import { LightView } from './lightview';
import { Mood } from './mood';
import { Sunbeams } from './sunbeams';
import { sunLook } from './sunmath';
import { TerrainLayer } from './terrain';
import { TorchView } from './torch';
import { VisionMask } from './visionmask';

const W = 15;
const H = 17;
const WARM = 0xffaa5a;
const SUN = { x: 5, y: 8 };

const PATCHES = [1.5, 2, 3];
const SLANTS = [0, 1, 1.5, 2];
const CLOUDS: [string, number][] = [['off', 0], ['soft', 0.3], ['medium', 0.45], ['strong', 0.6]];
const HEIGHTS = [3, 4, 5, 6];
const GLOWS = [1, 1.5, 2];
const OFTEN: [number, number][] = [[8, 25], [2, 4]];

function buildMap(): TileMap {
  const tiles = new Uint8Array(W * H).fill(TILE_ID.Wall);
  for (let y = 2; y <= 14; y++) for (let x = 1; x <= 9; x++) tiles[y * W + x] = TILE_ID.Floor;
  // An open alcove on the east side. No wall stubs and the pillar stands in a corner, so the viewer's
  // line of sight casts no black wedge over the floor (it would read as a daylight shadow).
  for (let y = 6; y <= 10; y++) for (let x = 10; x <= 13; x++) tiles[y * W + x] = TILE_ID.Floor;
  tiles[13 * W + 9] = TILE_ID.Wall; // a pillar by the south-east corner
  return new TileMap(W, H, tiles);
}

export class SunlightDemoScene extends Phaser.Scene {
  private t = 0;
  private fx!: Effects;
  private layer!: TerrainLayer;
  private view!: LightView;
  private mask!: VisionMask;
  private mood!: Mood;
  private sun!: Sunbeams;
  private viewer = { x: 7.5 * TILE, y: 8.5 * TILE };
  private torches: { view: TorchView; x: number; y: number; side: number; lit: boolean }[] = [];
  private bar?: HTMLDivElement;

  constructor() {
    super('sunlight-demo');
  }

  create(): void {
    const q = new URLSearchParams(location.search);
    this.readParams(q);
    const map = buildMap();
    this.cameras.main.setBackgroundColor('#000000');
    this.fx = new Effects(this);
    const rt = this.add.renderTexture(0, 0, W * TILE, H * TILE).setOrigin(0).setDepth(DEPTH.map);
    rt.beginDraw();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        for (const d of tileDraws(map, x, y)) rt.batchDrawFrame('atlas', d.frame, x * TILE, y * TILE + (d.dy ?? 0));
    rt.endDraw();
    this.layer = new TerrainLayer(this, map, this.fx);

    const field = new LightField(map);
    let id = 1;
    field.add({ id: id++, kind: LIGHT_KIND.Daylight, colour: LIGHT[LIGHT_KIND.Daylight].colour, x: SUN.x, y: SUN.y, on: true });
    // The sunlit room's torch is out; the small room's torch is lit.
    this.torches.push({ view: new TorchView(this), x: 1 * TILE + 0.5, y: 8.5 * TILE, side: 1, lit: false });
    this.torches.push({ view: new TorchView(this), x: 14 * TILE - 0.5, y: 8.5 * TILE, side: 2, lit: true });
    field.add({ id: id++, kind: LIGHT_KIND.Torch, colour: WARM, x: 13, y: 8, on: true });
    this.view = new LightView(this, map, field);
    this.mask = new VisionMask(this, map);
    this.sun = new Sunbeams(this, field, this.view);
    this.mood = new Mood(this, map, this.view);
    this.sun.on.beam = q.get('beam') !== '0';
    this.sun.on.dust = q.get('dust') !== '0';
    for (const k of ['smoke', 'embers', 'drips'] as const) this.mood.on[k] = false;

    const put = (frame: string, x: number, y: number, flip = false) =>
      this.add.image(x * TILE, y * TILE, 'atlas', frame).setOrigin(0.5, 1).setFlipX(flip).setDepth(DEPTH.entityBase + y * TILE);
    put('knight_m_idle_anim_f0', 5.5, 8.9);
    put('knight_m_idle_anim_f0', 7.4, 9.3, true);
    put('crate', 8.5, 4.8);
    put('skull', 2.5, 13.6);

    const cam = this.cameras.main;
    const barH = 110;
    cam.setZoom(Math.min(cam.width / ((W - 0.5) * TILE), (cam.height - barH) / ((H - 1) * TILE)));
    cam.centerOn((W * TILE) / 2, 8.8 * TILE + barH / 2 / cam.zoom);
    this.buttons();
    this.events.once('shutdown', () => {
      this.bar?.remove();
      this.mood.destroy();
      this.sun.destroy();
    });
  }

  /** ?shape=straight|widening, ?patch=1.5|2|3, ?slant=0..2, ?from=left|right, ?clouds=0..0.6, ?often=1, ?height=3..6, ?rays=1..3, ?glow=1..2, ?beam=0, ?dust=0. */
  private readParams(q: URLSearchParams): void {
    const num = (k: string) => (q.get(k) !== null && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
    if (q.get('shape') !== null) sunLook.widen = q.get('shape') !== 'straight';
    sunLook.patch = num('patch') ?? sunLook.patch;
    sunLook.slant = num('slant') ?? sunLook.slant;
    if (q.get('from') !== null) sunLook.dir = q.get('from') === 'right' ? 1 : -1;
    sunLook.clouds = num('clouds') ?? sunLook.clouds;
    const height = num('height');
    if (height !== null && HEIGHTS.includes(height)) sunLook.height = height;
    const rays = num('rays');
    if (rays === 1 || rays === 2 || rays === 3) sunLook.rays = rays;
    sunLook.glow = num('glow') ?? sunLook.glow;
    if (q.get('often') !== null) sunLook.gap = q.get('often') === '1' ? OFTEN[1] : OFTEN[0];
  }

  /** Big buttons along the bottom of the page, for a phone. */
  private buttons(): void {
    const bar = (this.bar = document.createElement('div'));
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px;background:rgba(0,0,0,.75);z-index:10;font:600 15px system-ui,sans-serif';
    const add = (label: () => string, act: () => void) => {
      const b = document.createElement('button');
      b.style.cssText = 'padding:10px 12px;border-radius:8px;border:1px solid #777;background:#222;color:#fff;font:inherit;min-width:84px';
      b.textContent = label();
      b.onclick = () => {
        act();
        b.textContent = label();
      };
      bar.appendChild(b);
    };
    /** Index of the value nearest to `v` (so a URL value that is not on the list still cycles on). */
    const near = (list: number[], v: number) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);
    const next = (list: number[], v: number) => list[(near(list, v) + 1) % list.length];
    add(() => `Shape: ${sunLook.widen ? 'widening' : 'straight'}`, () => (sunLook.widen = !sunLook.widen));
    add(() => `Patch: ${sunLook.patch} tiles`, () => (sunLook.patch = next(PATCHES, sunLook.patch)));
    add(() => `Slant: ${sunLook.slant} tiles`, () => (sunLook.slant = next(SLANTS, sunLook.slant)));
    add(() => `From: ${sunLook.dir < 0 ? 'left' : 'right'}`, () => (sunLook.dir = sunLook.dir < 0 ? 1 : -1));
    const cv = CLOUDS.map((c) => c[1]);
    add(() => `Clouds: ${CLOUDS[near(cv, sunLook.clouds)][0]}`, () => (sunLook.clouds = next(cv, sunLook.clouds)));
    add(() => `Often: ${sunLook.gap[0] === OFTEN[1][0] ? 'often' : 'normal'}`, () => (sunLook.gap = sunLook.gap[0] === OFTEN[1][0] ? OFTEN[0] : OFTEN[1]));
    add(() => `Height: ${sunLook.height} tiles`, () => (sunLook.height = next(HEIGHTS, sunLook.height)));
    add(() => `Rays: ${sunLook.rays}`, () => (sunLook.rays = (sunLook.rays % 3 + 1) as 1 | 2 | 3));
    add(() => `Glow: x${sunLook.glow}`, () => (sunLook.glow = next(GLOWS, sunLook.glow)));
    add(() => `Beam: ${this.sun.on.beam ? 'on' : 'off'}`, () => (this.sun.on.beam = !this.sun.on.beam));
    add(() => `Dust: ${this.sun.on.dust ? 'on' : 'off'}`, () => (this.sun.on.dust = !this.sun.on.dust));
    document.body.appendChild(bar);
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    this.fx.update(dt);
    this.layer.update(dt);
    for (const tr of this.torches) tr.view.update(tr.x, tr.y, tr.lit, tr.side, this.t);
    const cam = this.cameras.main;
    this.view.update(cam.worldView, this.viewer.x, this.viewer.y, [], this.t, 0, CONST.FOV_RADIUS);
    this.mask.update(cam.worldView, this.view.view);
    this.sun.update(dt, cam.worldView, this.t);
    this.mood.update(dt, cam.worldView, this.torches.map((tr) => ({ x: tr.x, y: tr.y, side: tr.side, lit: tr.lit })), [], []);
  }
}

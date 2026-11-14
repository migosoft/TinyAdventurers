// Dev page ?sunlight (no server): sunlight through a ceiling crack, to judge the look (#156).
// One tall room with a pillar and one Daylight light in its middle (a pale beam from above onto a soft
// bright floor patch, dust motes in the beam). One knight stands in the patch and one beside it, the
// south-west corner is left dark, the room's wall torch is out, and an open alcove on the east side has
// a lit torch, so warm and daylight can be compared. The viewer sees the whole scene. Mood is on (dust, haze), so beam dust can be judged against normal dust.
// Each sun spot gets its own random look (Vary on, the default; slant, direction and cloud gap are shared).
// Buttons at the bottom (tap or click): Vary (random per sun / the fixed look below), Reroll #n (new ids, so
// new random looks), Second crack (a second Daylight light 3-4 tiles from the first, to compare "one crack
// with uneven rays" with "two cracks in one room"), then Slant (0 / 1 / 1.5 / 2 tiles), From (left / right),
// Often (normal / often: a cloud every 2-4 s instead of 8-25 s), Beam and Dust on / off, and, shown only with
// Vary off: Shape (widening / straight), Patch (1.5 / 2 / 3 tiles), Clouds (off / soft / medium / strong),
// Height (4 / 5 / 6 / 7 tiles, ceiling to floor), Rays (1 / 2 / 3), Style (fan / parallel) and Glow (x1 / x1.5 / x2).
// URL: ?vary=0&second=1&shape=straight&patch=3&slant=2&from=right&clouds=0.3&often=1&height=5&style=parallel&rays=2&glow=1.5&beam=0&dust=0
// (clouds is 0..0.6, the dip; the fixed-look parameters apply with vary=0).
// Zoomed to fit the rooms to the screen, so it reads on a phone.
import Phaser from 'phaser';
import { CONST, LIGHT, LIGHT_KIND } from '../generated/defs';
import { TILE } from '../sim/map';
import { demoBoard } from './contextrestore';
import { Effects, DEPTH } from './effects';
import { LightField } from './light';
import { LightView } from './lightview';
import { Mood } from './mood';
import { Sunbeams } from './sunbeams';
import { sunLook } from './sunmath';
import { TerrainLayer } from './terrain';
import { CLOUDS, GLOWS, HEIGHTS, OFTEN, PATCHES, SECOND, SLANTS, STYLES, SUN, SUNLIGHT_H, SUNLIGHT_KNIGHTS, SUNLIGHT_PROPS, SUNLIGHT_TORCHES, SUNLIGHT_VIEWER, SUNLIGHT_W, SUNLIGHT_WARM, sunlightMap } from './sunlightDemoScript';
import { TorchView } from './torch';
import { VisionMask } from './visionmask';

const W = SUNLIGHT_W;
const H = SUNLIGHT_H;

export class SunlightDemoScene extends Phaser.Scene {
  private t = 0;
  private fx!: Effects;
  private layer!: TerrainLayer;
  private view!: LightView;
  private mask!: VisionMask;
  private mood!: Mood;
  private sun!: Sunbeams;
  private viewer = SUNLIGHT_VIEWER;
  private torches: { view: TorchView; x: number; y: number; side: number; lit: boolean }[] = [];
  private bar?: HTMLDivElement;
  private field!: LightField;
  private roll = 0;
  private second = false;
  private sunIds: number[] = [];

  constructor() {
    super('sunlight-demo');
  }

  create(): void {
    const q = new URLSearchParams(location.search);
    this.readParams(q);
    const map = sunlightMap();
    this.cameras.main.setBackgroundColor('#000000');
    this.fx = new Effects(this);
    demoBoard(this, map);
    this.layer = new TerrainLayer(this, map, this.fx);

    const field = (this.field = new LightField(map));
    this.placeSuns();
    // The sunlit room's torch is out; the small room's torch is lit.
    for (const tc of SUNLIGHT_TORCHES) {
      this.torches.push({ view: new TorchView(this), x: tc.x, y: tc.y, side: tc.side, lit: tc.lit });
      if (tc.light) field.add({ id: tc.light.id, kind: LIGHT_KIND.Torch, colour: SUNLIGHT_WARM, x: tc.light.x, y: tc.light.y, on: true });
    }
    this.view = new LightView(this, map, field);
    this.mask = new VisionMask(this, map);
    this.sun = new Sunbeams(this, field, this.view);
    this.mood = new Mood(this, map, this.view);
    this.sun.on.beam = q.get('beam') !== '0';
    this.sun.on.dust = q.get('dust') !== '0';
    for (const k of ['smoke', 'embers', 'drips'] as const) this.mood.on[k] = false;

    const put = (frame: string, x: number, y: number, flip = false) =>
      this.add.image(x * TILE, y * TILE, 'atlas', frame).setOrigin(0.5, 1).setFlipX(flip).setDepth(DEPTH.entityBase + y * TILE);
    for (const f of [...SUNLIGHT_KNIGHTS, ...SUNLIGHT_PROPS]) put(f.frame, f.x, f.y, f.flip);

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

  /** (Re)places the Daylight lights: ids 1 and 3 (the second crack), plus 1000 per reroll, so a reroll gives each a new random look. */
  private placeSuns(): void {
    for (const id of this.sunIds) this.field.remove(id);
    this.sunIds = [];
    const at = (id: number, x: number, y: number) => {
      this.field.add({ id, kind: LIGHT_KIND.Daylight, colour: LIGHT[LIGHT_KIND.Daylight].colour, x, y, on: true });
      this.sunIds.push(id);
    };
    at(1 + 1000 * this.roll, SUN.x, SUN.y);
    if (this.second) at(3 + 1000 * this.roll, SECOND.x, SECOND.y);
  }

  /** ?shape=straight|widening, ?patch=1.5|2|3, ?slant=0..2, ?from=left|right, ?clouds=0..0.6, ?often=1, ?height=4..7, ?style=fan|parallel, ?rays=1..3, ?glow=1..2, ?beam=0, ?dust=0, ?vary=0 (the fixed look of the buttons), ?second=1. */
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
    if (q.get('style') === 'fan' || q.get('style') === 'parallel') sunLook.style = q.get('style') as 'fan' | 'parallel';
    if (q.get('vary') === '0') sunLook.vary = false;
    this.second = q.get('second') === '1';
    if (q.get('often') !== null) sunLook.gap = q.get('often') === '1' ? OFTEN[1] : OFTEN[0];
  }

  /** Big buttons along the bottom of the page, for a phone. */
  private buttons(): void {
    const bar = (this.bar = document.createElement('div'));
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:8px;background:rgba(0,0,0,.75);z-index:10;font:600 15px system-ui,sans-serif';
    const fixed: HTMLButtonElement[] = [];
    const varied: HTMLButtonElement[] = [];
    const show = () => {
      fixed.forEach((b) => (b.style.display = sunLook.vary ? 'none' : ''));
      varied.forEach((b) => (b.style.display = sunLook.vary ? '' : 'none'));
    };
    /** `only`: shown only with Vary off ('fixed') or on ('varied'). */
    const add = (label: () => string, act: () => void, only?: 'fixed' | 'varied') => {
      const b = document.createElement('button');
      b.style.cssText = 'padding:10px 12px;border-radius:8px;border:1px solid #777;background:#222;color:#fff;font:inherit;min-width:84px';
      b.textContent = label();
      b.onclick = () => {
        act();
        b.textContent = label();
      };
      bar.appendChild(b);
      if (only === 'fixed') fixed.push(b);
      if (only === 'varied') varied.push(b);
    };
    /** Index of the value nearest to `v` (so a URL value that is not on the list still cycles on). */
    const near = (list: number[], v: number) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);
    const next = (list: number[], v: number) => list[(near(list, v) + 1) % list.length];
    add(() => `Vary: ${sunLook.vary ? 'on' : 'off'}`, () => {
      sunLook.vary = !sunLook.vary;
      show();
    });
    add(() => `Reroll #${this.roll}`, () => {
      this.roll++;
      this.placeSuns();
    }, 'varied');
    add(() => `Second crack: ${this.second ? 'on' : 'off'}`, () => {
      this.second = !this.second;
      this.placeSuns();
    });
    add(() => `Shape: ${sunLook.widen ? 'widening' : 'straight'}`, () => (sunLook.widen = !sunLook.widen), 'fixed');
    add(() => `Patch: ${sunLook.patch} tiles`, () => (sunLook.patch = next(PATCHES, sunLook.patch)), 'fixed');
    add(() => `Slant: ${sunLook.slant} tiles`, () => (sunLook.slant = next(SLANTS, sunLook.slant)));
    add(() => `From: ${sunLook.dir < 0 ? 'left' : 'right'}`, () => (sunLook.dir = sunLook.dir < 0 ? 1 : -1));
    const cv = CLOUDS.map((c) => c[1]);
    add(() => `Clouds: ${CLOUDS[near(cv, sunLook.clouds)][0]}`, () => (sunLook.clouds = next(cv, sunLook.clouds)), 'fixed');
    add(() => `Often: ${sunLook.gap[0] === OFTEN[1][0] ? 'often' : 'normal'}`, () => (sunLook.gap = sunLook.gap[0] === OFTEN[1][0] ? OFTEN[0] : OFTEN[1]));
    add(() => `Height: ${sunLook.height} tiles`, () => (sunLook.height = next(HEIGHTS, sunLook.height)), 'fixed');
    add(() => `Rays: ${sunLook.rays}`, () => (sunLook.rays = (sunLook.rays % 3 + 1) as 1 | 2 | 3), 'fixed');
    add(() => `Style: ${sunLook.style}`, () => (sunLook.style = STYLES[(STYLES.indexOf(sunLook.style) + 1) % 2]), 'fixed');
    add(() => `Glow: x${sunLook.glow}`, () => (sunLook.glow = next(GLOWS, sunLook.glow)), 'fixed');
    add(() => `Beam: ${this.sun.on.beam ? 'on' : 'off'}`, () => (this.sun.on.beam = !this.sun.on.beam));
    add(() => `Dust: ${this.sun.on.dust ? 'on' : 'off'}`, () => (this.sun.on.dust = !this.sun.on.dust));
    show();
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

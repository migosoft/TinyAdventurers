// The pure parts of the pixies (#202, #306): each one's path around the cove's tree, its wing flip and its colours. No Phaser,
// so the 2D view (pixies.ts) and the 3D view share them. The path is pure and seeded.

/** Half-axes of the ellipse a pixie wanders in (px). */
export const PIXIE_RX = 56;
export const PIXIE_RY = 32;
/** Vertical bob: peak-to-peak 2.5 px, once every 1.6-2.4 s. */
const BOB_AMP = 1.25;
export const PIXIE_GLOW_ALPHA = 0.6;
export const PIXIE_WING_ALPHA = 0.7;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-pixie path: two sines per axis (angular speed in rad/s, phase), plus the bob. */
function pathFor(i: number, seed: number) {
  const r = rng((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
  // 0.25-0.5 loops per 10 s
  const w = () => 2 * Math.PI * (0.025 + r() * 0.025);
  const ph = () => r() * 2 * Math.PI;
  return { wx1: w(), wx2: w() * 1.7, px1: ph(), px2: ph(), wy1: w(), wy2: w() * 1.3, py1: ph(), py2: ph(), bobW: 2 * Math.PI / (1.6 + r() * 0.8), bobP: ph() };
}

/** Whether the wings of pixie `i` are up on rendered frame `frame`: flips every frame, phase per pixie. */
export function wingUp(i: number, frame: number): boolean {
  return ((frame + i) & 1) === 0;
}

/** Position of pixie `i` at time `t` (s) around `centre`; stays inside the RX x RY ellipse. */
export function pixieAt(i: number, t: number, centre: { x: number; y: number }, seed: number): { x: number; y: number; wingUp: boolean } {
  const p = pathFor(i, seed);
  // each axis is in [-1, 1]; scaled by 1/sqrt(2) the pair stays inside the unit circle
  const u = (0.6 * Math.sin(p.wx1 * t + p.px1) + 0.4 * Math.sin(p.wx2 * t + p.px2)) * Math.SQRT1_2;
  const v = (0.6 * Math.sin(p.wy1 * t + p.py1) + 0.4 * Math.sin(p.wy2 * t + p.py2)) * Math.SQRT1_2;
  const bob = BOB_AMP * Math.sin(p.bobW * t + p.bobP);
  return { x: centre.x + u * PIXIE_RX, y: centre.y + v * (PIXIE_RY - BOB_AMP) + bob, wingUp: wingUp(i, Math.floor(t * 60)) };
}

/** The pixie colours: soft glow, bright core (the second core pixel on every other pixie) and the wings. */
export const PIXIE_COLOURS = { glow: 0xd8ffb0, core: 0xfffbe0, core2: 0xe8ffb0, wing: 0xffffff };
/** How many pixies the cove has. */
export const PIXIE_COUNT = 7;
/** Pixie centre: the canopy middle, above the trunk foot (px). */
export const CANOPY_UP = 50;

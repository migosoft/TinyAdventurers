// Dragon frame poses, shared by the atlas build (scripts/dragon-frames.ts),
// which draws them, and the board (anim/defs.ts), which needs the mouth and
// nostril points of each frame for the breath.
//
// Two kinds of frames:
// - Sheet frames: whole images from the action strips in assets-src/dragon/
//   (walk, claw, bite, tail whip, hover; AI-generated from the base sprite and
//   imported once, placed in base-sprite coordinates). Only the hover frames'
//   jaw moves (fire from the air); `body` moves the whole image.
// - Generated frames (idle, breath, take-off, landing): body parts cut out of
//   the base sprite (assets-src/dragon/dragon_base.png, facing right). A pose
//   moves parts: rotate `a` (radians, clockwise on screen) and scale `sx`/`sy`
//   around the part's pivot, then shift by `dx`/`dy` (base pixels). Children
//   follow their parent (jaw -> head -> body).

export type DragonPart = 'body' | 'head' | 'jaw' | 'nearWing' | 'farWing' | 'tail';
export interface PartMove {
  a?: number;
  sx?: number;
  sy?: number;
  dx?: number;
  dy?: number;
}
export type DragonSheet = keyof typeof DRAGON_SHEETS;
export type DragonPose = Partial<Record<DragonPart, PartMove>> & {
  /** Fire glow inside the open mouth. */
  glow?: boolean;
  /** A whole sheet frame instead of the base sprite's parts. */
  sheet?: { name: DragonSheet; i: number };
};

/**
 * Frame size and where the base sprite (49x43) sits in it. The standing feet
 * are on row `footY` (the figure origin); hanging legs in flight reach below.
 */
export const DRAGON_FRAME = { w: 86, h: 54, baseX: 19, baseY: 7, footY: 50 } as const;

/**
 * The action strips (assets-src/dragon/dragon_<name>.png): `n` cells of size
 * `cell` side by side; a base-sprite point p is at p + shift in each cell.
 * `head`: where the base head is in each frame (offset in base pixels), for
 * the mouth and nostril points. Measured when the strips were imported.
 */
export const DRAGON_SHEETS = {
  walk: { n: 6, cell: [54, 45], shift: [5, 0], head: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] },
  claw: { n: 4, cell: [54, 45], shift: [0, 0], head: [[0, 0], [0, 0], [0, 0], [0, 0]] },
  bite: { n: 4, cell: [67, 44], shift: [0, 1], head: [[-3, -2], [12, 5], [19, 8], [-1, 2]] },
  tail: { n: 6, cell: [65, 44], shift: [16, 1], head: [[0, -1], [0, -1], [0, -1], [-1, 0], [-1, 0], [-1, 0]] },
  hover: { n: 6, cell: [65, 51], shift: [17, 5], head: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] },
} as const satisfies Record<string, { n: number; cell: readonly [number, number]; shift: readonly [number, number]; head: readonly (readonly [number, number])[] }>;

export const PIVOTS: Record<DragonPart, [number, number]> = {
  body: [24, 30],
  head: [31, 15],
  jaw: [36, 15.5],
  nearWing: [19, 19],
  farWing: [24, 19],
  tail: [9, 27],
};
export const PARENT: Partial<Record<DragonPart, DragonPart>> = {
  head: 'body',
  jaw: 'head',
  nearWing: 'body',
  farWing: 'body',
  tail: 'body',
};

/** Base-sprite points: fire leaves between the lips, smoke from the nostril. */
const MOUTH: [number, number] = [47, 16.5];
const NOSTRIL: [number, number] = [46, 12.5];

// Standing wing poses: raised high (taking off), level (seen edge-on).
const RAISED = { nearWing: { sy: 1.08, a: -0.08 }, farWing: { sy: 1.08, a: -0.08 } };
const LEVEL = { nearWing: { sy: 0.45, a: -0.05 }, farWing: { sy: 0.6 } };
const wings = (w: PartMove) => ({ nearWing: w, farWing: w });
const sheet = (name: DragonSheet) => [...Array(DRAGON_SHEETS[name].n).keys()].map((i): DragonPose => ({ sheet: { name, i } }));
// One wing beat (raised, spread, beating down, lowest, folding up, raised);
// the body rises on the down-stroke.
const BOB = [1, 0, -1, -1, 0, 1];
const hover = (i: number): DragonPose => ({ sheet: { name: 'hover', i }, body: { dy: BOB[i] } });

export const DRAGON_ANIMS = {
  idle: [
    {},
    { head: { dy: 1 }, ...wings({ a: -0.04 }) },
    { head: { dy: 1 }, ...wings({ a: -0.07 }), tail: { a: 0.05 } },
    { ...wings({ a: -0.03 }), tail: { a: 0.03 } },
  ],
  walk: sheet('walk'),
  // Attacks: frame 0 is the wind-up pose, the rest play after it.
  claw: sheet('claw'),
  bite: sheet('bite'),
  tail: sheet('tail'),
  breath: [
    { head: { a: -0.15 }, jaw: { a: 0.15 } },
    { head: { a: 0.1, dx: 1 }, jaw: { a: 0.4 }, glow: true },
  ],
  takeoff: [
    // Crouch with the wings up, then one strong beat down lifts it off.
    { body: { dy: 2 }, ...RAISED },
    { body: { dy: 1 }, ...LEVEL },
    hover(3),
    hover(4),
  ],
  hover: [0, 1, 2, 3, 4, 5].map(hover),
  // The hover frames' heads sit where the base head is, so the base jaw opens on them.
  hoverbreath: [0, 1, 2, 3, 4, 5].map((i): DragonPose => ({ ...hover(i), jaw: { a: 0.4 }, glow: true })),
  land: [
    // Glide down with the wings up, touch down in a crouch, settle.
    hover(0),
    { body: { dy: 2 }, ...LEVEL },
    { body: { dy: 1 }, ...wings({ sy: 0.9 }) },
  ],
} satisfies Record<string, DragonPose[]>;
export type DragonAnim = keyof typeof DRAGON_ANIMS;

export const dragonFrameName = (anim: DragonAnim, i: number) => `dragon_${anim}_anim_f${i}`;

/** Moves a base-sprite point by one part's own move (no parent). */
function moveOne(part: DragonPart, m: PartMove | undefined, p: [number, number]): [number, number] {
  if (!m) return p;
  const [px, py] = PIVOTS[part];
  const x = (p[0] - px) * (m.sx ?? 1);
  const y = (p[1] - py) * (m.sy ?? 1);
  const a = m.a ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [px + x * c - y * s + (m.dx ?? 0), py + x * s + y * c + (m.dy ?? 0)];
}

/** The chain of parts whose moves apply to `part`, innermost first. */
function partChain(part: DragonPart): DragonPart[] {
  const chain: DragonPart[] = [part];
  for (let p = PARENT[part]; p; p = PARENT[p]) chain.push(p);
  return chain;
}

/** Where a base-sprite point of `part` lands in the frame. */
export function posePoint(pose: DragonPose, part: DragonPart, p: [number, number]): [number, number] {
  let q = p;
  if (pose.sheet && (part === 'head' || part === 'jaw')) {
    // The sheet frame's head is somewhere else than the base head.
    const [hx, hy] = DRAGON_SHEETS[pose.sheet.name].head[pose.sheet.i];
    q = [p[0] + hx, p[1] + hy];
  }
  for (const c of partChain(part)) q = moveOne(c, pose[c], q);
  return [q[0] + DRAGON_FRAME.baseX, q[1] + DRAGON_FRAME.baseY];
}

/** Inverse of `posePoint` for one part (frame pixel -> base pixel), used to draw the frames. */
export function unposePoint(pose: DragonPose, part: DragonPart, f: [number, number]): [number, number] {
  let q: [number, number] = [f[0] - DRAGON_FRAME.baseX, f[1] - DRAGON_FRAME.baseY];
  for (const c of partChain(part).reverse()) {
    const m = pose[c];
    if (!m) continue;
    const [px, py] = PIVOTS[c];
    const x = q[0] - (m.dx ?? 0) - px;
    const y = q[1] - (m.dy ?? 0) - py;
    const a = -(m.a ?? 0);
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    q = [px + (x * cs - y * sn) / (m.sx ?? 1), py + (x * sn + y * cs) / (m.sy ?? 1)];
  }
  return q;
}

/** Mouth and nostril points (frame pixels) for every dragon frame. */
export function dragonPoints(): { mouth: Record<string, [number, number]>; nostrils: Record<string, [number, number]> } {
  const mouth: Record<string, [number, number]> = {};
  const nostrils: Record<string, [number, number]> = {};
  for (const [anim, poses] of Object.entries(DRAGON_ANIMS) as [DragonAnim, DragonPose[]][])
    poses.forEach((pose, i) => {
      const name = dragonFrameName(anim, i);
      // Between the lips: halfway between the upper snout and the (opened) jaw tip.
      const up = posePoint(pose, 'head', MOUTH);
      const lo = posePoint(pose, 'jaw', MOUTH);
      mouth[name] = [(up[0] + lo[0]) / 2, (up[1] + lo[1]) / 2];
      nostrils[name] = posePoint(pose, 'head', NOSTRIL);
    });
  return { mouth, nostrils };
}

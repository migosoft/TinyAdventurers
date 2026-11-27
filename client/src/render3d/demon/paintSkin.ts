// The paint of the demon's body, horns, claws, tail, strap and wing bones (#442): the look spike's `skinMaterial` (materials.ts there)
// in TSL, line for line with its numbers, every adaptation on but the broken horn. Armour plates of rock with lava in the grooves, horn,
// the leather of the wing bones; painted from each point's place on the resting body, so the paint sticks to the skin when the bones move.
// All colours are the spike's (linear light); nodes.ts turns them into the view's.
import { If, abs, atan, clamp, cos, cross, dFdx, dFdy, dot, exp, float, floor, fract, length, max, min, mix, normalize, pow, select, sign, sin, smoothstep, sqrt, step, vec2, vec3 } from 'three/tsl';
import { CREST, EYE, HORN_PATH, MOUTH, TAIL_BLADE } from './body';
import { fbm, fn, hash1, sstep, voro, type Painted, type PoseUniforms } from './paintNoise';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
type V = readonly number[];

const v3 = (a: V): N => vec3(a[0], a[1], a[2]);
const sq = (x: N): N => x.mul(x);
const one = (x: N): N => float(1).sub(x);
const sub = (a: V, b: V): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): number[] => { const l = len(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const crossJs = (a: V, b: V): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** exp(-|(pa - c) / r|^2): how much a point lies in a soft ball. */
const ball = (pa: N, c: V, r: number | V): N => { const q: N = pa.sub(v3(c)).div(typeof r === 'number' ? r : v3(r)); return exp(dot(q, q).negate()); };
const most = (pa: N, balls: readonly (readonly [V, number | V])[]): N => balls.reduce((m: N, [c, r]) => max(m, ball(pa, c, r)), float(0));

/** How much a point lies in a joint or a hollow (the plates are small scales there). */
const joints = fn('demonJoints', 'float', [['pa', 'vec3']], ([pa]) => most(pa, [
  [[0.69, 1.57, -0.03], 0.16], [[0.87, 1.04, 0], 0.14], [[0.36, 1.95, 0], [0.14, 0.18, 0.18]], [[0.3, 0.72, 0.06], 0.16],
  [[0.3, 0.28, -0.1], 0.14], [[0.2, 1.27, 0.08], [0.2, 0.1, 0.2]], [[0, 2.28, 0.02], [0.22, 0.1, 0.22]], [[0.24, 1.52, 0], [0.1, 0.12, 0.25]],
]));

/** Darker paint (not shadow) where parts meet and in the hollows: armpits, the insides of the joints, the middle line of chest and belly, under the chest muscles, the flanks, the groin, beside the spine, round the eyes. */
const hollows = fn('demonHollows', 'float', [['pa', 'vec3']], ([pa]) => most(pa, [
  [[0.36, 1.93, 0], [0.1, 0.14, 0.14]], [[0.69, 1.57, -0.03], 0.11], [[0.87, 1.04, 0], 0.09],
  [[0, 2.28, 0], [0.2, 0.09, 0.2]], [[0, 1.9, 0.2], [0.035, 0.2, 0.1]], [[0, 1.55, 0.2], [0.03, 0.22, 0.1]],
  [[0.17, 1.86, 0.17], [0.2, 0.035, 0.1]], [[0.2, 1.27, 0.1], [0.16, 0.07, 0.15]], [[0.3, 0.72, 0.02], [0.1, 0.08, 0.08]],
  [[0.3, 0.28, -0.1], 0.09], [[0.13, 1.85, -0.25], [0.05, 0.35, 0.08]], [[0.27, 1.5, 0], [0.08, 0.1, 0.2]],
  [[0, 1.15, -0.25], 0.15], [[0.08, 2.5, 0.3], [0.09, 0.04, 0.06]], [[0, 2.28, 0.2], [0.12, 0.05, 0.12]],
]));

/** How far a point of the body's middle plane (z, y) lies from a blade's rim. */
const rimOf = (name: string, poly: readonly (readonly [number, number])[]): ((q: N) => N) => fn(name, 'float', [['q', 'vec2']], ([q]) => {
  let d: N = float(1e9);
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], e = [b[0] - a[0], b[1] - a[1]], ee = e[0] * e[0] + e[1] * e[1];
    if (ee === 0) return;
    const w: N = q.sub(vec2(a[0], a[1])), r: N = w.sub(vec2(e[0], e[1]).mul(clamp(dot(w, vec2(e[0], e[1])).div(ee), 0, 1)));
    d = min(d, dot(r, r));
  });
  return sqrt(d);
});
const crestRim = rimOf('demonCrestRim', CREST), bladeRim = rimOf('demonBladeRim', TAIL_BLADE);

// The runes cut into the outside of the forearm: the arm's line, and a frame round it.
const RUNE_A = [0.69, 1.57, -0.03], RUNE_AB = sub([0.87, 1.04, 0], RUNE_A), RUNE_LEN = len(RUNE_AB), RUNE_D = unit(RUNE_AB);
const RUNE_X = (() => { const x = [1, 0, -0.25], k = x[0] * RUNE_D[0] + x[1] * RUNE_D[1] + x[2] * RUNE_D[2]; return unit(sub(x, RUNE_D.map((d) => d * k))); })();
const RUNE_B = crossJs(RUNE_D, RUNE_X);
/** How far a point is from the nearest stroke of a rune (m); 1 where there is none. */
const runeDist = fn('demonRune', 'float', [['pa', 'vec3']], ([pa]) => {
  const rel: N = pa.sub(v3(RUNE_A)).toVar(), t: N = dot(rel, v3(RUNE_D)).div(RUNE_LEN).toVar();
  const rv: N = rel.sub(v3(RUNE_D).mul(t.mul(RUNE_LEN))).toVar();
  const lx: N = atan(dot(rv, v3(RUNE_B)), dot(rv, v3(RUNE_X))).mul(0.115), c: N = t.sub(0.12).div(0.76).mul(5).toVar(), i: N = floor(c).toVar();
  // the glyph's own square, the stem upright
  const q: N = vec2(lx, float(0.5).sub(fract(c)).mul((0.76 * RUNE_LEN) / 5)).div(0.03).toVar();
  const seg = (a: [number, number], b: [number, number]): N => {
    const d = [b[0] - a[0], b[1] - a[1]], w: N = q.sub(vec2(a[0], a[1]));
    return length(w.sub(vec2(d[0], d[1]).mul(clamp(dot(w, vec2(d[0], d[1])).div(d[0] * d[0] + d[1] * d[1]), 0, 1))));
  };
  const h1: N = hash1(vec3(i, 3, 7)), h2: N = hash1(vec3(i, 11, 2)), h3: N = hash1(vec3(i, 5, 13));
  let d: N = seg([0, -1], [0, 1]);
  d = min(d, select(h1.lessThan(0.5), seg([0, 1], [0.75, 0.35]), seg([0, 0.25], [0.75, 0.9])));
  d = min(d, select(h2.lessThan(0.6), seg([0, -0.05], [0.75, -0.7]), seg([0, -1], [-0.75, -0.35])));
  d = min(d, select(h3.lessThan(0.5), seg([0, 0.4], [-0.75, -0.25]), float(1e9)));
  return select(t.lessThan(0.12).or(t.greaterThan(0.88)).or(length(rv).greaterThan(0.22)), float(1), d.mul(0.03));
});

/** Where a point is on the great horn: x how far along it (0 base, 1 tip), y the angle round it, z how far outside its skin. */
const hornAt = fn('demonHorn', 'vec3', [['p', 'vec3']], ([p]) => {
  const H = HORN_PATH, seg = H.slice(0, 7).map((h, i) => sub(H[i + 1][0], h[0])), L = seg.map(len), tot = L.reduce((a, b) => a + b, 0);
  const best: N = float(1e9).toVar(), out: N = vec3(0).toVar();
  let acc = 0;
  for (let i = 0; i < 7; i++) {
    const a = H[i][0], ab = seg[i], T = unit(ab), at = acc;
    // the direction turns smoothly from one stretch of the horn into the next, so the ridges do not jump at a bend
    const Tp = i > 0 ? unit(seg[i - 1]) : T, Tn = i < 6 ? unit(seg[i + 1]) : T;
    const t: N = clamp(dot(p.sub(v3(a)), v3(ab)).div(L[i] * L[i]), 0, 1).toVar();
    const d: N = p.sub(v3(a).add(v3(ab).mul(t))).toVar(), dd: N = length(d).toVar();
    If(dd.lessThan(best), () => {
      best.assign(dd);
      const Tm: N = (normalize as N)(select(t.lessThan(0.5), mix(v3(unit([Tp[0] + T[0], Tp[1] + T[1], Tp[2] + T[2]])), v3(T), t.mul(2)), mix(v3(T), v3(unit([T[0] + Tn[0], T[1] + Tn[1], T[2] + Tn[2]])), t.mul(2).sub(1)))).toVar();
      const Nm: N = normalize(vec3(0, 0, 1).sub(Tm.mul(Tm.z))).toVar(), Bm: N = cross(Tm, Nm);
      out.assign(vec3(t.mul(L[i]).add(at).div(tot), atan(dot(d, Bm), dot(d, Nm)), dd.sub(mix(H[i][1], H[i + 1][1], t))));
    });
    acc += L[i];
  }
  return out;
});

/** The plates at a point of the resting body (mirrored left to right, so they read as grown armour): x how far from the nearest groove, y the plate's random number, z its tilt. */
const cells = fn('demonCells', 'vec3', [['p0', 'vec3']], ([p0]) => {
  const p: N = vec3(abs(p0.x), p0.y, p0.z).toVar();
  // the armour proper: the front of the torso, where the plates keep their rows
  const front: N = smoothstep(-0.05, 0.12, p0.z).mul(smoothstep(1.2, 1.4, p0.y)).mul(sstep(2.25, 2.1, p0.y)).mul(sstep(0.5, 0.36, p.x)).toVar();
  // two sizes of plate: big ones on the broad muscles, small scales in the joints and hollows, changing over a narrow band
  const small: N = smoothstep(0.35, 0.6, joints(p)).mul(one(front)).toVar(), at: N = p.mul(vec3(6.2, 7.4, 6.2)).toVar();
  const v: N = voro(at.mul(0.88).add(vec3(0, 0.35, 3)), mix(0.8, 0.3, front)).toVar();
  If(small.greaterThan(0), () => {
    const vs: N = voro(at.mul(1.9).add(vec3(0, 0.35, 3)), float(0.8)).toVar();
    v.assign(mix(v, vec3(vs.x, vs.y, vs.z.mul(0.5)), small));
  });
  return vec3(min(v.x, mix(float(8), p.x.mul(9), front)), v.y, v.z);
});

/** How strongly the great horn's ridges stand at a point (`h` from `hornAt`): x on the horn at all, y the ridges' fade toward the tip, z the ridge. */
const ridges = (p: N, info: N, h: N): { on: N; fade: N; ridge: N } => ({
  on: info.y.mul(step(h.z, 0.04)).mul(step(2.3, p.y)),
  fade: one(smoothstep(0.7, 0.92, h.x)),
  ridge: pow(cos(h.y.mul(9).add(h.x.mul(5))).mul(0.5).add(0.5), 1.6),
});

/** The relief's height at a point, from its plates (`cells`) and its place on the horn (`hornAt` of the mirrored point). */
const height = fn('demonHeight', 'float', [['p0', 'vec3'], ['info', 'vec4'], ['c', 'vec3'], ['h', 'vec3']], ([p0, info, c, h]) => {
  const p: N = vec3(abs(p0.x), p0.y, p0.z).toVar();
  const leather: N = step(1.5, info.x), limb: N = info.w;
  const n: N = fbm(p0.mul(5)).toVar();
  const plate: N = smoothstep(0.015, 0.16, c.x), scale: N = smoothstep(0, 0.3, voro(p.mul(vec3(19, 23, 19)), float(0.7)).x);
  const rock: N = plate.mul(c.y.mul(0.4).add(0.9).add(c.z.mul(1.3))).add(scale.mul(limb.mul(0.3).add(0.1))).add(n.mul(0.3));
  const streak: N = fbm(p0.mul(vec3(26, 9, 26))).toVar(), wr: N = fbm(p0.mul(vec3(46, 12, 46)));
  // the great horns: ridges running their length (with a slow twist), fine ribs across, both dying out toward the hot tip
  const r = ridges(p, info, h), oh: N = r.on.toVar(), fade: N = r.fade.toVar();
  const rib: N = cos(h.x.mul(150).add(sin(h.y.mul(3)).mul(0.6))).mul(0.5).add(0.5);
  const hornH: N = r.ridge.mul(1.5).add(rib.mul(0.3)).mul(fade).add(streak.mul(0.2));
  // the runes are cut into the plates: a groove with a raised, burnt lip
  const rd: N = runeDist(p).mul(n.sub(0.5).mul(0.25).add(1)).toVar();
  const cut: N = one(smoothstep(0.003, 0.0075, rd)).mul(1.6).sub(one(smoothstep(0.0075, 0.016, rd)).mul(0.35));
  const cutRock: N = rock.sub(cut.mul(one(info.y)));
  return mix(mix(mix(cutRock, streak.mul(0.5), info.y.mul(0.55)), hornH, oh), wr.mul(0.7), leather).mul(0.013).mul(one(step(0.9, info.y.mul(info.w))));
});
const mirrored = (p: N): N => vec3(abs(p.x), p.y, p.z);
const relief = fn('demonRelief', 'float', [['p0', 'vec3'], ['info', 'vec4']], ([p0, info]) => height(p0, info, cells(p0), hornAt(mirrored(p0))));

/** The skin's paint at the rest point `p` (`info`: [open, horn, tip, dark], 2 in x for leather; `st`: a tooth's uv). Call at the top level: the relief's steps take screen derivatives. */
export function paintSkin(p: N, info: N, st: N, pose: PoseUniforms): Painted {
  const time: N = (pose.life as N).x, breath: N = (pose.life as N).w, beat: N = pose.beat as N, gaze: N = pose.gaze as N;
  const pa: N = mirrored(p).toVar();
  const c: N = cells(p).toVar(), h: N = hornAt(pa).toVar();
  const h0: N = height(p, info, c, h).toVar();
  const hx: N = relief(p.add(dFdx(p)), info).sub(h0).toVar(), hy: N = relief(p.add(dFdy(p)), info).sub(h0).toVar();

  const edge: N = c.x, plate: N = smoothstep(0.015, 0.16, edge).toVar(), hu: N = h.x;
  const leather: N = step(1.5, info.x).toVar(), limb: N = info.w, n: N = fbm(p.mul(5)).toVar();
  let rock: N = mix(vec3(0.04, 0.033, 0.032), vec3(0.17, 0.105, 0.085), clamp(c.y.mul(plate).mul(0.55).add(0.15).add(n.mul(0.35)), 0, 1));
  rock = rock.mul(mix(0.4, 1, plate)).mul(one(limb.mul(0.75)));
  const streak: N = fbm(p.mul(vec3(26, 9, 26))).toVar();
  let horn: N = mix(mix(vec3(0.035, 0.028, 0.028), vec3(0.2, 0.11, 0.08), sq(streak)), vec3(0.5, 0.36, 0.22), info.z.mul(0.45));
  const wr: N = fbm(p.mul(vec3(46, 12, 46))).toVar();
  const hide: N = mix(vec3(0.05, 0.022, 0.02), vec3(0.2, 0.07, 0.05), sq(wr));
  // the great horns: near black at the base, lighter along the middle, black again toward the tip, and the tip itself hot metal
  const r = ridges(pa, info, h), onHorn: N = r.on.toVar(), ridge: N = mix(0.5, r.ridge, onHorn.mul(r.fade));
  const ramp: N = smoothstep(0.22, 0.4, hu).mul(one(smoothstep(0.46, 0.64, hu))).mul(ridge.mul(0.75).add(0.45));
  horn = mix(horn, mix(vec3(0.01, 0.008, 0.008), vec3(0.19, 0.12, 0.09).mul(streak.mul(0.8).add(0.6)), ramp), onHorn);
  // cooled crust: the middles of the plates greyed with ash, in patches
  rock = mix(rock, vec3(0.115, 0.108, 0.104).mul(n.mul(0.6).add(0.7)), smoothstep(0.1, 0.3, edge).mul(smoothstep(0.35, 0.65, fbm(p.mul(3.1).add(2)))).mul(0.6).mul(one(limb)));
  const alb: N = mix(mix(rock, horn, max(info.y.mul(0.6), onHorn)), hide, leather).toVar();
  // darker where two parts of the body meet
  const open: N = mix(clamp(info.x, 0, 1), 1, leather).toVar();
  alb.mulAssign(mix(0.12, 1, smoothstep(0.3, 0.95, open)));
  alb.mulAssign(one(hollows(pa).mul(0.65).mul(one(onHorn))));
  // the two blades: near black along the rim, paling inward; the crest to dark horn, the tail's blade to old bone, with faint growth
  // lines following the rim
  const isCrest: N = p.y.greaterThanEqual(2.58).and(pa.x.lessThanEqual(0.05)), isBlade: N = p.z.lessThanEqual(-1.3).and(p.y.lessThanEqual(1.2));
  If(isCrest.or(isBlade), () => {
    const bd: N = float(0).toVar();
    If(isCrest, () => { bd.assign(crestRim(vec2(p.z, p.y))); }).Else(() => { bd.assign(bladeRim(vec2(p.z, p.y))); });
    const m: N = smoothstep(0.35, 0.75, info.y), rings: N = cos(bd.mul(330).add(streak.mul(2))).mul(0.14).add(0.86), grain: N = streak.mul(0.5).add(0.75);
    const crestC: N = mix(vec3(0.012, 0.009, 0.009), vec3(0.3, 0.19, 0.13).mul(grain), smoothstep(0.003, 0.045, bd));
    const boneC: N = mix(mix(vec3(0.02, 0.014, 0.012), vec3(0.24, 0.14, 0.085), smoothstep(0.002, 0.022, bd)), vec3(0.62, 0.53, 0.38).mul(grain), smoothstep(0.014, 0.06, bd));
    alb.assign(mix(alb, select(isCrest, crestC, boneC).mul(rings), m));
  });

  // lava in the grooves: hottest on the chest, fading out over belly, hips, shoulders and limbs
  const body: N = one(info.y).mul(one(leather)).toVar();
  const gq: N = p.sub(vec3(0, 1.84, 0.06)).div(vec3(0.5, 0.72, 0.5));
  // the grin is the muzzle's only light
  const glow0: N = max(exp(dot(gq, gq).mul(-1.2)), one(limb).mul(0.07)).mul(body).mul(one(ball(p, [0, 2.4, 0.3], [0.15, 0.1, 0.13]).pow(1.3)));
  const patchy: N = smoothstep(0.3, 0.55, fbm(p.mul(2.6).add(7)).add(glow0.mul(0.75)).sub(0.12)).toVar();
  const crack: N = one(smoothstep(0, mix(0.02, 0.075, glow0), edge)).toVar();
  // a heart beats in the chest: each beat (a double knock) runs outward through the cracks
  const hb: N = fract(beat.x.sub(length(p.sub(vec3(0.06, 1.95, 0.1))).mul(0.55))).toVar();
  const knock: N = exp(sq(hb.sub(0.1).div(0.06)).negate()).add(exp(sq(hb.sub(0.34).div(0.07)).negate()).mul(0.6));
  // before the breath, light climbs from the belly to the throat
  const charge: N = beat.z.mul(exp(sq(p.y.sub(mix(1.3, 2.4, beat.y)).div(0.16)).negate())).mul(smoothstep(-0.05, 0.1, p.z)).toVar();
  const glow: N = max(glow0, charge.mul(body)).toVar(), pulse: N = knock.mul(0.85).add(0.55).add(charge.mul(1.6)).toVar();
  const cc: N = sq(crack).toVar();
  let emit: N = mix(vec3(1, 0.14, 0.01), vec3(1, 0.55, 0.12), cc.mul(glow)).mul(cc.mul(patchy).mul(pow(max(glow, 0), 0.7)).mul(pulse).mul(2.4));
  emit = emit.add(vec3(0.5, 0.06, 0).mul(one(smoothstep(0, 0.2, edge)).mul(patchy).mul(sq(glow))));
  emit = emit.add(vec3(1, 0.3, 0.04).mul(info.z.mul(0.1).mul(one(onHorn))));
  // the runes: scorched round the cut, a dull ember inside that flares with a blow or before the breath, crawling like the lava
  const rd: N = runeDist(pa).mul(n.sub(0.5).mul(0.25).add(1)).toVar(), rune: N = one(smoothstep(0.002, 0.0065, rd)).mul(one(info.y));
  alb.mulAssign(one(one(smoothstep(0.006, 0.022, rd)).mul(0.75)));
  const rfl: N = fbm(p.mul(14).add(vec3(0, time.mul(0.5), 0))).mul(0.4).add(0.6);
  emit = emit.add(mix(vec3(0.9, 0.12, 0.01).mul(0.5), vec3(1, 0.55, 0.16).mul(1.7), beat.w).mul(rune).mul(rfl)).add(vec3(1, 0.22, 0.02).mul(one(smoothstep(0.004, 0.013, rd)).mul(0.22).mul(beat.w)));
  // an old wound across the chest that never closed: the fire shows through it
  const SA = [-0.27, 2.08], SAB = [0.2 + 0.27, 1.72 - 2.08];
  const sp: N = vec2(p.x, p.y).add(vec2(fbm(p.mul(18)), fbm(p.mul(18).add(5))).mul(0.012)).sub(vec2(SA[0], SA[1])).toVar();
  const st1: N = clamp(dot(sp, vec2(SAB[0], SAB[1])).div(SAB[0] * SAB[0] + SAB[1] * SAB[1]), 0, 1).toVar(), sd: N = length(sp.sub(vec2(SAB[0], SAB[1]).mul(st1))).toVar();
  const onChest: N = step(0.05, p.z).mul(step(p.z, 0.4)).mul(step(pa.x, 0.34)).mul(step(1.6, p.y)).mul(step(p.y, 2.15)).mul(one(info.y)).toVar();
  const scar: N = one(smoothstep(0.003, sin(st1.mul(3.14159)).mul(0.011).add(0.004), sd)).mul(onChest);
  emit = emit.add(vec3(1, 0.5, 0.14).mul(scar.mul(1.3).mul(pulse.mul(0.3).add(0.7))));
  alb.mulAssign(one(one(smoothstep(0.015, 0.045, sd)).mul(0.6).mul(onChest)));
  const hot: N = smoothstep(0.8, 1, hu).mul(onHorn);
  emit = emit.add(vec3(1, 0.25, 0.02).mul(sq(hot).mul(1.8)).add(vec3(1, 0.7, 0.3).mul(smoothstep(0.94, 1, hu).mul(onHorn).mul(1.2))).mul(sin(time.mul(2.1).add(p.x.mul(4))).mul(0.15).add(0.85)));

  // the eyes: narrow slanted slits with a bright core that follows the gaze
  const sx: N = sign(p.x), sl: N = sx.mul(0.42), cs: N = cos(sl), sn: N = sin(sl);
  const slant = (e: N): N => vec3(e.x.mul(cs).add(e.y.mul(sn)), e.y.mul(cs).sub(e.x.mul(sn)), e.z);
  const e0: N = p.sub(vec3(sx.mul(EYE[0]), EYE[1], EYE[2])).toVar(), e: N = slant(e0).toVar();
  const ec: N = slant(e0.sub(vec3(gaze.x.mul(0.017), gaze.y.mul(0.004), 0)));
  const eye: N = one(smoothstep(0.55, 1, length(e.div(vec3(0.062, one(gaze.z.mul(0.45)).mul(0.011), 0.03))))).toVar();
  const core: N = one(smoothstep(0.3, 1, length(ec.div(vec3(0.02, 0.012, 0.07))))).mul(eye);
  const halo: N = one(smoothstep(0.5, 2.2, length(e.div(vec3(0.062, 0.018, 0.035)))));
  // the mouth: the glow fills whatever lies inside it, behind the teeth
  const q2: N = p.sub(vec3(MOUTH[0], MOUTH[1] + 0.02, MOUTH[2] - 0.06)).div(vec3(0.125, 0.06, 0.13));
  const maw: N = one(smoothstep(0.6, 1, length(q2))).mul(one(smoothstep(0.2, 0.5, open))).mul(one(info.y)).mul(0.7).toVar();
  emit = emit.add(vec3(1, 0.36, 0.05).mul(eye.mul(3)).add(vec3(1, 0.9, 0.7).mul(core.mul(5))).add(vec3(0.9, 0.12, 0).mul(sq(halo).mul(0.5))).add(vec3(1, 0.4, 0.06).mul(maw.mul(breath.mul(6).add(2)))).mul(sin(time.mul(3.1)).mul(0.15).add(0.85)));
  alb.mulAssign(one(max(eye, maw).mul(0.8)));
  // the teeth: smooth near-black blades, a little paler toward the point
  const tooth: N = step(0.9, info.y.mul(info.w));
  return { albedo: mix(alb, mix(vec3(0.008, 0.006, 0.006), vec3(0.085, 0.065, 0.055), smoothstep(0.45, 1, st.x)), tooth), emit, hx, hy };
}

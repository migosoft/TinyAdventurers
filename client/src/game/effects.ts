// Depth bands and sound text shared by the world-text and effect code.
import { GLOOM } from './fxLooks';

export const DEPTH = {
  map: 0,
  decal: 1,
  /** Sunlight patch on the floor under a skylight (sunbeams.ts): over the decals, under figures. */
  sunPatch: 1.5,
  /** Ground shadows of the woodland's plants (woodland/shadowlayer.ts): over the ground strips and the sun patch, under the trunk shade. */
  plantShadow: 1.55,
  /** The soft shadow behind trunks (shademask.ts): over the ground and decals, under figures and canopies. */
  shade: 1.6,
  hazard: 2,
  entityBase: 10,
  projectile: 5000,
  fx: 6000,
  /** Cloud shadows (woodland/clouds.ts): over figures and plants, under the air and the darkness. */
  cloud: 6488,
  /** Sunbeam from a skylight (sunbeams.ts): over figures and effects, just under the dungeon air; the darkness hides it where unseen. Its dust uses airDust. */
  sunBeam: 6489,
  /** The dungeon air (mood.ts), over figures, shots and effects, under enemy HP bars and numbers and the light pass. Lowest first: haze, dust, smoke, drips, embers. */
  airHaze: 6490,
  airDust: 6491,
  airSmoke: 6492,
  airDrips: 6493,
  airEmbers: 6494,
  /** Enemy HP bars: over figures and effects, under the darkness, so they vanish where it is dark. */
  enemyBars: 6500,
  /** Damage and heal numbers on enemies: under the darkness, so they vanish where it is dark. */
  enemyNumbers: 6501,
  /** The light pass (one MULTIPLY picture: tint × (1 − darkness)). Every figure and shot is under it, heroes too. */
  fog: 7000,
  /** Smoke from torches in sight: just over the darkness (it rises into the dark wall top), only from seen, lit torches. */
  torchSmoke: 7000.6,
  /** Lich drain beams: above the fog, they show even where the hero cannot see. */
  beam: 7001,
  /** Sound text ("grrrr", the sleeper's Z): above the darkness, under the damage numbers. */
  sound: 7500,
  /** Hero and ally HP bars: over the darkness, so they show even when the hero is unlit. */
  heroBars: 7999,
  /** Numbers on heroes and allies, coins, key caps and other top world text: over the darkness. */
  numbers: 8000,
};

/** The depth of a damage or heal number: over the darkness on a hero or ally, under it on an enemy. */
export function numberDepth(onHero: boolean): number {
  return onHero ? DEPTH.numbers : DEPTH.enemyNumbers;
}

/** Sound text (the sleeper's Z): a dark fill with a light outline, readable on black and on lit floors. */
export const SOUND_TEXT = { fill: '#1a1020', stroke: '#d8d0e0' };

/** The lich's magic: dark purple, gloomy, shimmering (the colours live in `fxLooks.ts`, which the 3D view shares). */
export { GLOOM };

// Dev page (?knockback): which melee hits push a hero, and how far, without a
// server. Every hero stands near a chasm or deep water. The push slides and
// slows down (proposed game values; tune them here first):
// - orc warrior 20 px, chort 14 px; imps (and all ranged attacks) do not push
// - the demon's cleave 36 px and swoop 44 px
// - the dragon's tail swipe 44 px and front claw 32 px
// - a dash cannot escape a push: the hero has no control until the slide ends.
import { CLASSES, KIND } from '../generated/defs';
import { TerrainDemo } from './TerrainDemoScene';

const W = 36;
const H = 16;

/** Three columns: four small lanes (x 0-11), two demon lanes (x 13-23), two dragon lanes (x 25-35). */
function board(): string[] {
  const g = Array.from({ length: H }, () => Array<string>(W).fill(' '));
  const fill = (x0: number, x1: number, y0: number, y1: number, c: string): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c;
  };
  for (let k = 0; k < 4; k++) {
    fill(0, 11, 4 * k, 4 * k + 2, '.');
    fill(8, 9, 4 * k, 4 * k + 2, k === 1 ? 'D' : 'C');
  }
  for (const y0 of [0, 8]) {
    fill(13, 23, y0, y0 + 6, '.');
    fill(20, 21, y0, y0 + 6, 'C');
    fill(25, 35, y0, y0 + 6, '.');
    fill(32, 33, y0, y0 + 6, 'C');
  }
  return g.map((r) => r.join(''));
}

export class KnockbackDemoScene extends TerrainDemo {
  protected title = 'knockback: only strong melee pushes (orcs, chorts, demon, dragon); a push into a chasm or deep water kills';
  protected rows = board();

  constructor() {
    super('knockback-demo');
  }

  protected setup(): void {
    const hero = (kind: number, name: string, speed: number, at: [number, number]): void =>
      this.actor(kind, name, speed, [{ to: at }, { wait: 3 }]);
    const mob = (kind: number, name: string, target: string, from: [number, number], to: [number, number], dist: number, demon = false): void =>
      this.actor(kind, name, 40, [{ to: from }, { wait: 0.8 }, { to }, { hit: target, dist }, { wait: 1.2 }, { to: from }], demon);

    // Small enemies: the hero stands 16 px from the edge.
    this.label(0.2, 2.3, 'orc warrior: 20 px');
    hero(KIND.Paladin, 'Paladin', CLASSES.Paladin.speed, [7, 1.7]);
    mob(KIND.OrcWarrior, 'Orc', 'Paladin', [1, 1.7], [5.6, 1.7], 20);

    this.label(0.2, 6.3, 'chort: 14 px (stops at the edge)');
    hero(KIND.Wizard, 'Wizard', CLASSES.Wizard.speed, [7, 5.7]);
    mob(KIND.Chort, 'Chort', 'Wizard', [1, 5.7], [5.8, 5.7], 14, true);

    this.label(0.2, 10.3, 'imp claw: no push');
    hero(KIND.Assassin, 'Assassin', CLASSES.Assassin.speed, [7, 9.7]);
    mob(KIND.Imp, 'Imp', 'Assassin', [1, 9.7], [6, 9.7], 0, true);

    this.label(0.2, 14.3, 'a dash cannot escape a push');
    hero(KIND.Barbarian, 'Barbarian', CLASSES.Barbarian.speed, [7, 13.7]);
    mob(KIND.OrcWarrior, 'Orc 2', 'Barbarian', [1, 13.7], [5.6, 13.7], 20);

    // The demon: the hero stands 24 px (cleave) or 36 px (swoop) from the edge.
    this.label(13.2, 6.3, 'demon cleave: 36 px');
    hero(KIND.Paladin, 'Paladin 2', CLASSES.Paladin.speed, [18.5, 4]);
    this.actor(KIND.Demon, 'Demon', 50, [{ to: [14, 4] }, { wait: 0.8 }, { to: [16.2, 4] }, { hit: 'Paladin 2', dist: 36, reach: 40 }, { wait: 1.2 }, { to: [14, 4] }], true);

    this.label(13.2, 14.3, 'demon swoop: 44 px');
    hero(KIND.Wizard, 'Wizard 2', CLASSES.Wizard.speed, [17.75, 12]);
    this.actor(KIND.Demon, 'Demon 2', 50, [{ to: [14, 12] }, { wait: 1.5 }, { swoop: 'Wizard 2', to: [19.3, 12], dist: 44 }, { wait: 1 }, { to: [14, 12] }], true);

    // The dragon: the hero stands 16 px from the edge, 40 px from the dragon.
    this.label(25.2, 6.3, 'dragon tail (behind it): 44 px');
    hero(KIND.Assassin, 'Assassin 2', CLASSES.Assassin.speed, [31, 4.5]);
    this.actor(KIND.Dragon, 'Dragon', 34, [{ to: [28.5, 4.5] }, { wait: 1.5, face: Math.PI }, { hit: 'Assassin 2', dist: 44, reach: 46, tail: true }, { wait: 1.5, face: Math.PI }]);

    this.label(25.2, 14.3, 'dragon front claw: 32 px');
    hero(KIND.Barbarian, 'Barbarian 2', CLASSES.Barbarian.speed, [30.5, 12.5]);
    this.actor(KIND.Dragon, 'Dragon 2', 34, [{ to: [28, 12.5] }, { wait: 1.5, face: 0 }, { hit: 'Barbarian 2', dist: 32, reach: 42 }, { wait: 1.5 }]);
  }
}

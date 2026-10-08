// Dev page (?ogre): the ogre mini-boss without a server. Its spiked club
// pushes harder than any other enemy (28 px; the orc warrior's 20 px for
// comparison), and its ground slam hits every hero inside the red ring on the
// floor, pushing each straight away from it (24 px). Heroes outside the ring
// are spared. The ring fills up during the wind-up; it shows the real radius.
import { CLASSES, CONST, KIND } from '../generated/defs';
import { TerrainDemo } from './TerrainDemoScene';

const W = 30;
const H = 15;
const SLAM = CONST.OGRE_SLAM_RADIUS;
const SLAM_T = CONST.OGRE_SLAM_WINDUP;

/** Left: two club lanes with a chasm strip. Right: the slam arena, a chasm strip east of the ogre. */
function board(): string[] {
  const g = Array.from({ length: H }, () => Array<string>(W).fill(' '));
  const fill = (x0: number, x1: number, y0: number, y1: number, c: string): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c;
  };
  for (const y0 of [0, 5]) {
    fill(0, 13, y0, y0 + 3, '.');
    fill(10, 11, y0, y0 + 3, 'C');
  }
  fill(15, 29, 0, 14, '.');
  fill(25, 26, 0, 14, 'C');
  return g.map((r) => r.join(''));
}

export class OgreDemoScene extends TerrainDemo {
  protected title = 'ogre: the club pushes hardest; the slam hits everyone inside the ring (red ring = real radius)';
  protected rows = board();

  constructor() {
    super('ogre-demo');
  }

  protected setup(): void {
    const hero = (kind: number, name: string, speed: number, at: [number, number]): void =>
      this.actor(kind, name, speed, [{ to: at }, { wait: 3 }]);

    // Club lanes: the hero stands 26 px from the edge; the orc's push stops short, the ogre's does not.
    this.label(0.2, 3.3, 'orc warrior: 20 px');
    hero(KIND.Paladin, 'Paladin', CLASSES.Paladin.speed, [8.4, 2]);
    this.actor(KIND.OrcWarrior, 'Orc', 40, [{ to: [1, 2] }, { wait: 0.8 }, { to: [7, 2] }, { hit: 'Paladin', dist: 20 }, { wait: 1.2 }, { to: [1, 2] }]);

    this.label(0.2, 8.3, 'ogre club: 28 px');
    hero(KIND.Barbarian, 'Barbarian', CLASSES.Barbarian.speed, [8.4, 7]);
    this.actor(KIND.Ogre, 'Ogre', 40, [{ to: [1, 7] }, { wait: 0.8 }, { to: [6.4, 7] }, { hit: 'Barbarian', dist: 28, reach: 36, windup: 0.5 }, { wait: 1.2 }, { to: [1, 7] }]);

    // Slam arena: three heroes inside the ring (one by the chasm), one just outside.
    this.label(15.2, 13.3, `ground slam: radius ${SLAM} px, 24 px push`);
    hero(KIND.Wizard, 'Wizard', CLASSES.Wizard.speed, [23.7, 7]);
    hero(KIND.Paladin, 'Paladin 2', CLASSES.Paladin.speed, [21.8, 5.1]);
    hero(KIND.Assassin, 'Assassin', CLASSES.Assassin.speed, [20.3, 8.4]);
    hero(KIND.Barbarian, 'Barbarian 2', CLASSES.Barbarian.speed, [18.8, 6.4]);
    this.actor(KIND.Ogre, 'Ogre 2', 40, [{ to: [21.8, 7] }, { wait: 1.5, face: 0 }, { slam: SLAM, dist: 24, windup: SLAM_T }, { wait: 2 }]);
  }
}

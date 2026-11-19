// The Ghost (#359): the Knight's body without the shield and the comb, floating and see-through. The pieces are the Knight's, so the
// two share one build; the spectre look (blended drawing, painted eyes, a halo) is the material's, read from `spectre`.
// First values for the user's eye.

import { GHOST_ALPHA_MAX } from '../../../game/anim/entityAlpha';
import type { TubeDesc } from '../tubeDesc';
import { KNIGHT_PIECES, KNIGHT_SHIELD, npcKnight } from './npcKnight';

export const ghost: TubeDesc = {
  ...npcKnight,
  name: 'Ghost',
  float: true,
  swipe: true,
  pieces: KNIGHT_PIECES.filter((p) => p !== KNIGHT_SHIELD.face && p !== KNIGHT_SHIELD.rim && p.stage !== 'hair').map((p) => ({ ...p, line: 0 })),
  spectre: {
    seeThrough: { peak: GHOST_ALPHA_MAX },
    eyes: { y: 15.0, z: 0.95, front: 1.3, half: [0.6, 0.32], slant: 0.15, core: 0xdbf2ff, ring: 0x99ccff, strength: 0.8 },
    halo: { size: 13, height: 6.5, glow: 0x8cb3ff, k: 0.16, light: 0x1a2438, radius: 2.4 },
    swoosh: { colour: 0xdbeeff },
  },
};

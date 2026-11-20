// The lich's pose (#358). Task 4 adds only the interface and the rest pose; the pose from the snapshot (`lichPose`) comes with Task 6.

export interface LichPose {
  t: number; face: number; headYaw: number; glide: number;
  novaUp: number; novaHit: number; novaChest: number; novaOut: number;
  raiseUp: number; raiseHit: number; raiseLow: number; raiseLift: number;
  flingBack: number; flingOut: number; gaze: number; hurt: number;
  /** The staff's bounce after a strike (builder units). */ strike: number;
  /** Pages riffle. */ casting: number;
  flare: number; /** Levels the builder, the material and the lights share. */ rune: number; staffRune: number; gem: number; wave: number; eye: number;
}

const S = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The spike's pose with the clock at 0, nothing cast, standing: each level is the spike's expression at t = 0 with no action. */
export function restPose(): LichPose {
  const t = 0;
  const beat = (t / 2.6) % 1, since = (beat - 0.78 + 1) % 1; // lichSpike.ts line 695
  return {
    t, face: 0, headYaw: 0, glide: 0,
    novaUp: 0, novaHit: 0, novaChest: 0, novaOut: 0,
    raiseUp: 0, raiseHit: 0, raiseLow: 0, raiseLift: 0,
    flingBack: 0, flingOut: 0, gaze: 0, hurt: 0,
    strike: 0, casting: 0, flare: 0,
    rune: 0.42 + 0.2 * Math.sin(t * 1.7), // line 581 (mats.rune.value)
    staffRune: 0.28, // line 704 (mats.gem.value) with no weight
    gem: 0.5 + 0.55 * Math.exp(-since * 3.2) * S(0, 0.04, since), // line 697 (gemPulse)
    wave: beat * 1.3 - 0.02, // line 696 (mats.wave.value)
    eye: 0.85 + 0.15 * Math.sin(t * 5.1) * Math.sin(t * 1.3), // line 654 (eyeGlow) with gaze and flare 0
  };
}

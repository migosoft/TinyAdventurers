// The demon's wings (#379): what a pose asks of a wing and the chain of lagging parts that follows it.

/** What a pose asks of a wing. `fold`: 0 fully open, 0.42 the approved rest, 1 closed against the back; the others rad: `raise` above the horizontal, `sweep` back from straight out, `pitch` the leading edge up. */
export interface WingTarget { fold: number; raise: number; sweep: number; pitch: number }
export interface WingState { arm: WingTarget; hand: WingTarget; tips: WingTarget; /** The parts' speeds. */ armV: WingTarget; handV: WingTarget; tipsV: WingTarget; billow: number; billowV: number }

/** A wing lying still on `rest`. */
export function newWing(rest: WingTarget): WingState {
  const at = (): WingTarget => ({ ...rest }), still = (): WingTarget => ({ fold: 0, raise: 0, sweep: 0, pitch: 0 });
  return { arm: at(), hand: at(), tips: at(), armV: still(), handV: still(), tipsV: still(), billow: 0, billowV: 0 };
}

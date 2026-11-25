import { logoHero } from './logo';

/** The runes the bar's tip throws off (#405): straight strokes in an 8 x 12 box, drawn for this game. */
const RUNES = [
  'M4 1V11M4 3L7 5.5L4 8',
  'M2 1V11M2 1L6 4M2 5L6 8',
  'M1 1L7 11M7 1L1 11',
  'M4 1V11M1 4L4 1L7 4',
  'M4 2L7 6L4 10L1 6Z',
  'M2 1V11M6 1V11M2 3L6 7',
];
const RUNE_POOL = 24;
const SPARK_POOL = 40;
/** Pieces thrown off by a full bar; at most a quarter of a pool per `set`, so a jump cannot cut short every piece in flight. */
const RUNES_PER_BAR = 70;
const SPARKS_PER_BAR = 160;

/** The pieces' markup: they are children of the bar, not of the fill, so they stay where they were thrown off. */
function piecesMarkup(): string {
  let html = '';
  for (let i = 0; i < RUNE_POOL; i++) {
    const d = RUNES[i % RUNES.length];
    html += `<svg class="loading-rune" aria-hidden="true" viewBox="0 0 8 12"><path d="${d}"/><path d="${d}"/></svg>`;
  }
  return html + '<i class="loading-spark" aria-hidden="true"></i>'.repeat(SPARK_POOL);
}

/** The full-window loading screen: logo, a bar whose tip throws off runes and sparks as it advances, one line. */
export class LoadingScreen {
  private readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly text: HTMLElement;
  private readonly runes: HTMLElement[];
  private readonly sparks: HTMLElement[];
  private last = 0;
  private runeDebt = 0;
  private sparkDebt = 0;
  private nextRune = 0;
  private nextSpark = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'loading-screen';
    this.el.hidden = true;
    this.el.innerHTML = `${logoHero}<div class="loading-bar"><div class="loading-fill"></div>${piecesMarkup()}</div><div class="loading-line"></div>`;
    this.fill = this.el.querySelector('.loading-fill')!;
    this.text = this.el.querySelector('.loading-line')!;
    this.runes = [...this.el.querySelectorAll<HTMLElement>('.loading-rune')];
    this.sparks = [...this.el.querySelectorAll<HTMLElement>('.loading-spark')];
    parent.appendChild(this.el);
  }

  show(): void {
    this.set(0, 'Loading assets…');
    this.el.hidden = false;
  }

  set(fraction: number, line: string): void {
    const f = Math.max(0, Math.min(1, fraction));
    this.fill.style.width = `${Math.round(f * 100)}%`;
    this.text.textContent = line;
    if (f > this.last) this.throwOff(this.last, f);
    this.last = f;
  }

  hide(): void {
    this.el.hidden = true;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /** Progress from `from` to `to` throws off pieces along that stretch, like a fuse burning. */
  private throwOff(from: number, to: number): void {
    this.runeDebt = Math.min(RUNE_POOL / 4, this.runeDebt + (to - from) * RUNES_PER_BAR);
    this.sparkDebt = Math.min(SPARK_POOL / 4, this.sparkDebt + (to - from) * SPARKS_PER_BAR);
    for (; this.runeDebt >= 1; this.runeDebt--) {
      fly(this.runes[this.nextRune++ % RUNE_POOL], from + Math.random() * (to - from), 30 + Math.random() * 40, 1800 + Math.random() * 1100, Math.random() * 80 - 40);
    }
    for (; this.sparkDebt >= 1; this.sparkDebt--) {
      fly(this.sparks[this.nextSpark++ % SPARK_POOL], from + Math.random() * (to - from), 14 + Math.random() * 30, 700 + Math.random() * 800, 0);
    }
  }
}

/** Puts a piece on the bar at `at` (0 to 1) and lets it fly `dist` px outward and fade. A Web Animation of
 *  transform and opacity: the compositor plays it while the main thread builds the level. */
function fly(el: HTMLElement, at: number, dist: number, ms: number, turn: number): void {
  el.style.left = `${(at * 100).toFixed(1)}%`;
  const a = Math.random() * 2 * Math.PI;
  const end = `translate(${(Math.cos(a) * dist).toFixed(1)}px, ${(Math.sin(a) * dist).toFixed(1)}px) scale(1) rotate(${turn.toFixed(0)}deg)`;
  // jsdom (the tests) has no Web Animations; the piece then just stays invisible.
  el.animate?.(
    [
      { transform: 'translate(0, 0) scale(0.3) rotate(0deg)', opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { opacity: 0.85, offset: 0.6 },
      { transform: end, opacity: 0 },
    ],
    { duration: ms, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
  );
}

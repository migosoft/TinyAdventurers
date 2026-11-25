import { logoHero } from './logo';

/** The runes that fly from the bar's tip (#405): straight strokes in an 8 x 12 box, drawn for this game. */
const RUNES = [
  'M4 1V11M4 3L7 5.5L4 8',
  'M2 1V11M2 1L6 4M2 5L6 8',
  'M1 1L7 11M7 1L1 11',
  'M4 1V11M1 4L4 1L7 4',
  'M4 2L7 6L4 10L1 6Z',
  'M2 1V11M6 1V11M2 3L6 7',
];

/** One flying piece: where it ends (`deg` from the bar's direction, `dist` px), its turn, its time. */
function flight(deg: number, dist: number, turn: number, dur: number, delay: number): string {
  const a = (deg * Math.PI) / 180;
  return `--dx:${(Math.cos(a) * dist).toFixed(1)}px;--dy:${(Math.sin(a) * dist).toFixed(1)}px;--r:${turn}deg;animation-duration:${dur.toFixed(2)}s;animation-delay:-${delay.toFixed(2)}s`;
}

/** The tip's markup: a glint, 9 runes and 8 sparks. Every motion is a CSS animation of transform and
 *  opacity, so it costs no script time while the level is built behind the screen. */
function tipMarkup(): string {
  let html = '';
  for (let i = 0; i < 9; i++) {
    const d = RUNES[i % RUNES.length];
    const dur = 1.8 + ((i * 7) % 5) * 0.22;
    const style = flight(-110 + ((i * 4) % 9) * 27.5, 44 + ((i * 17) % 30), ((i * 53) % 80) - 40, dur, (i * 0.61) % dur);
    html += `<svg class="loading-rune" viewBox="0 0 8 12" style="${style}"><path d="${d}"/><path d="${d}"/></svg>`;
  }
  for (let i = 0; i < 8; i++) {
    html += `<i class="loading-spark" style="${flight(-130 + ((i * 97) % 260), 18 + ((i * 13) % 26), 0, 0.9 + (i % 4) * 0.2, i * 0.29)}"></i>`;
  }
  return `<span class="loading-tip" aria-hidden="true">${html}</span>`;
}

/** The full-window loading screen: logo, a bar with runes sparkling from its tip, one line. */
export class LoadingScreen {
  private readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly text: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'loading-screen';
    this.el.hidden = true;
    this.el.innerHTML = `${logoHero}<div class="loading-bar"><div class="loading-fill">${tipMarkup()}</div></div><div class="loading-line"></div>`;
    this.fill = this.el.querySelector('.loading-fill')!;
    this.text = this.el.querySelector('.loading-line')!;
    parent.appendChild(this.el);
  }

  show(): void {
    this.set(0, 'Loading assets…');
    this.el.hidden = false;
  }

  set(fraction: number, line: string): void {
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    this.text.textContent = line;
  }

  hide(): void {
    this.el.hidden = true;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }
}

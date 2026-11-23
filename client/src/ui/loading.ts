import { logoHero } from './logo';

/** The full-window loading screen: logo, a bar, one line. Plain for now. */
export class LoadingScreen {
  private readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly text: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'loading-screen';
    this.el.hidden = true;
    this.el.innerHTML = `${logoHero}<div class="loading-bar"><div class="loading-fill"></div></div><div class="loading-line"></div>`;
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

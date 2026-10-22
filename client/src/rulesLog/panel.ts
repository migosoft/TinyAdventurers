import './rulesLog.css';
import type { Row } from './buffer';

export const FONT_HREF = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap';

/** True when the JetBrains Mono stylesheet is not among the page's link hrefs yet. */
export function fontLinkNeeded(hrefs: string[]): boolean {
  return !hrefs.includes(FONT_HREF);
}

/** The log panel: bottom-left, newest line at the bottom, sticking there unless the player scrolled up. */
export class LogPanel {
  private root = document.createElement('div');
  private body = document.createElement('div');
  private toggle = document.createElement('button');
  private details = true;

  constructor(parent: HTMLElement, private onDetails: (on: boolean) => void) {
    const hrefs = Array.from(document.head.querySelectorAll('link')).map((l) => l.href || l.getAttribute('href') || '');
    if (fontLinkNeeded(hrefs)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONT_HREF;
      document.head.append(link);
    }
    this.root.className = 'rules-log';
    const head = document.createElement('div');
    head.className = 'rl-head';
    const title = document.createElement('span');
    title.textContent = 'Rules log';
    this.toggle.className = 'rl-toggle';
    this.toggle.type = 'button';
    this.toggle.textContent = 'details';
    this.toggle.title = 'Shift+L';
    this.toggle.addEventListener('click', () => this.onDetails(!this.details));
    head.append(title, this.toggle);
    this.body.className = 'rl-body';
    this.root.append(head, this.body);
    parent.append(this.root);
    this.setDetails(this.details);
  }

  show(on: boolean): void {
    this.root.classList.toggle('open', on);
  }

  render(rows: Row[]): void {
    const stick = this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 4;
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const d = document.createElement('div');
      d.className = `rl-row k${r.kind}${r.detail ? ' detail' : ''}`;
      d.textContent = r.text;
      frag.append(d);
    }
    this.body.replaceChildren(frag);
    if (stick) this.body.scrollTop = this.body.scrollHeight;
  }

  setDetails(on: boolean): void {
    this.details = on;
    this.toggle.classList.toggle('on', on);
    this.toggle.setAttribute('aria-pressed', String(on));
  }

  destroy(): void {
    this.root.remove();
  }
}

// The mouse of a 3D run (#311): the two attack buttons, the middle-button camera drag and the pointer. The listeners sit on the
// host element (it survives a canvas rebuild after a lost device) and on the window (a release or a blur outside the page).
import type { CamTurn } from './turn';

/** The labels of the Z, X and C keys on the player's layout (the keys are used by position), else the plain letters. */
export async function turnKeyLabels(): Promise<[z: string, x: string, c: string]> {
  const plain: [string, string, string] = ['Z', 'X', 'C'];
  try {
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    const map = await kb?.getLayoutMap?.();
    if (!map) return plain;
    return [map.get('KeyZ')?.toUpperCase() ?? 'Z', map.get('KeyX')?.toUpperCase() ?? 'X', map.get('KeyC')?.toUpperCase() ?? 'C'];
  } catch {
    return plain;
  }
}

/** Only a press on the 3D canvas counts: not the dev panel, the HUD or a menu over it. */
const onCanvas = (t: EventTarget | null): boolean => t instanceof HTMLCanvasElement && t.classList.contains('r3d');

export class RunMouse {
  private primaryHeld = false;
  private secondaryHeld = false;
  private primaryClick = false;
  private secondaryClick = false;
  private pos: { x: number; y: number } | null = null;

  constructor(private readonly el: HTMLElement, private readonly turn: CamTurn) {
    el.addEventListener('mousedown', this.onDown);
    el.addEventListener('contextmenu', this.onMenu);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('blur', this.release);
    window.addEventListener('mousemove', this.onMove);
    document.addEventListener('mouseleave', this.onLeave);
  }

  /**
   * Canvas device px of the pointer over `canvas` (whose backing size is w x h), or null: outside it, none yet, or dragging.
   * `r`: the canvas's client rect, if the caller has one from this frame (reading it forces a layout).
   */
  at(canvas: HTMLCanvasElement, w: number, h: number, rect?: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): { px: number; py: number } | null {
    if (!this.pos || this.turn.dragging) return null;
    const r = rect ?? canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const x = this.pos.x - r.left;
    const y = this.pos.y - r.top;
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) return null;
    return { px: (x * w) / r.width, py: (y * h) / r.height };
  }

  /** Held, or clicked since the last call (the click latch is cleared). */
  takePrimary(): boolean {
    const v = this.primaryHeld || this.primaryClick;
    this.primaryClick = false;
    return v;
  }

  takeSecondary(): boolean {
    const v = this.secondaryHeld || this.secondaryClick;
    this.secondaryClick = false;
    return v;
  }

  dispose(): void {
    this.el.removeEventListener('mousedown', this.onDown);
    this.el.removeEventListener('contextmenu', this.onMenu);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('blur', this.release);
    window.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mouseleave', this.onLeave);
    this.release();
  }

  private readonly onDown = (e: MouseEvent): void => {
    if (!onCanvas(e.target)) return;
    this.pos = { x: e.clientX, y: e.clientY };
    if (e.button === 0) {
      this.primaryHeld = this.primaryClick = true;
    } else if (e.button === 2) {
      this.secondaryHeld = this.secondaryClick = true;
    } else if (e.button === 1) {
      e.preventDefault(); // not the browser's autoscroll
      this.turn.dragStart();
    }
  };

  private readonly onMenu = (e: Event): void => {
    if (onCanvas(e.target)) e.preventDefault();
  };

  private readonly onUp = (e: MouseEvent): void => {
    if (e.button === 0) this.primaryHeld = false;
    else if (e.button === 2) this.secondaryHeld = false;
    else if (e.button === 1) this.turn.dragEnd();
  };

  private readonly onMove = (e: MouseEvent): void => {
    this.pos = { x: e.clientX, y: e.clientY };
    if (this.turn.dragging) this.turn.drag(e.movementX || 0);
  };

  private readonly onLeave = (): void => {
    this.pos = null;
  };

  /** The window lost focus, or the run ends: no button stays held and a drag ends (and snaps). */
  private readonly release = (): void => {
    this.primaryHeld = this.secondaryHeld = false;
    this.turn.dragEnd();
  };
}

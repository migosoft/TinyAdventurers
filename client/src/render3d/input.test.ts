// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunMouse } from './input';
import { CamTurn } from './turn';

let el: HTMLElement;
let canvas: HTMLCanvasElement;
let turn: CamTurn;
let mouse: RunMouse;

const fire = (target: EventTarget, type: string, init: MouseEventInit & { movementX?: number } = {}): MouseEvent => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  if (init.movementX !== undefined) Object.defineProperty(e, 'movementX', { value: init.movementX });
  target.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  el = document.createElement('div');
  document.body.appendChild(el);
  canvas = document.createElement('canvas');
  canvas.className = 'r3d';
  el.appendChild(canvas);
  turn = new CamTurn();
  mouse = new RunMouse(el, turn);
});
afterEach(() => {
  mouse.dispose();
  el.remove();
});

describe('RunMouse', () => {
  it('a left click on the 3D canvas fires the primary once, a held button keeps firing', () => {
    fire(canvas, 'mousedown', { button: 0 });
    expect(mouse.takePrimary()).toBe(true);
    expect(mouse.takePrimary()).toBe(true); // still held
    fire(window, 'mouseup', { button: 0 });
    expect(mouse.takePrimary()).toBe(false);
    fire(canvas, 'mousedown', { button: 0 });
    fire(window, 'mouseup', { button: 0 }); // a click shorter than a step still fires once
    expect(mouse.takePrimary()).toBe(true);
    expect(mouse.takePrimary()).toBe(false);
  });

  it('a click on the panel does nothing', () => {
    const panel = document.createElement('div');
    panel.className = 'r3d-panel';
    el.appendChild(panel);
    fire(panel, 'mousedown', { button: 0 });
    fire(panel, 'mousedown', { button: 2 });
    fire(panel, 'mousedown', { button: 1 });
    expect(mouse.takePrimary()).toBe(false);
    expect(mouse.takeSecondary()).toBe(false);
    expect(turn.dragging).toBe(false);
  });

  it('the right button is the secondary and the context menu is prevented', () => {
    fire(canvas, 'mousedown', { button: 2 });
    expect(mouse.takeSecondary()).toBe(true);
    expect(mouse.takePrimary()).toBe(false);
    expect(fire(canvas, 'contextmenu', { button: 2 }).defaultPrevented).toBe(true);
    const other = document.createElement('div');
    el.appendChild(other);
    expect(fire(other, 'contextmenu', { button: 2 }).defaultPrevented).toBe(false);
    fire(window, 'mouseup', { button: 2 });
    expect(mouse.takeSecondary()).toBe(false);
  });

  it('the middle button drags the camera and pauses the pointer', () => {
    fire(window, 'mousemove', { clientX: 10, clientY: 10 });
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    expect(mouse.at(canvas, 100, 100)).not.toBeNull();
    expect(fire(canvas, 'mousedown', { button: 1 }).defaultPrevented).toBe(true);
    expect(turn.dragging).toBe(true);
    expect(mouse.at(canvas, 100, 100)).toBeNull();
    const yaw = turn.shown;
    fire(window, 'mousemove', { clientX: 20, clientY: 10, movementX: 10 });
    expect(turn.shown).toBeGreaterThan(yaw);
    fire(window, 'mouseup', { button: 1 });
    expect(turn.dragging).toBe(false);
    expect(mouse.at(canvas, 100, 100)).not.toBeNull();
  });

  it('releasing outside the window ends the drag and the buttons', () => {
    fire(canvas, 'mousedown', { button: 1 });
    fire(canvas, 'mousedown', { button: 0 });
    fire(window, 'mouseup', { button: 1 }); // the release came on the window, not the canvas
    expect(turn.dragging).toBe(false);
    fire(canvas, 'mousedown', { button: 1 });
    fire(canvas, 'mousedown', { button: 2 });
    window.dispatchEvent(new Event('blur'));
    expect(turn.dragging).toBe(false);
    mouse.takePrimary();
    mouse.takeSecondary();
    expect(mouse.takePrimary()).toBe(false);
    expect(mouse.takeSecondary()).toBe(false);
  });

  it('the pointer maps client px to canvas device px', () => {
    canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 450 }) as DOMRect;
    expect(mouse.at(canvas, 1600, 900)).toBeNull(); // no pointer yet
    fire(window, 'mousemove', { clientX: 500, clientY: 275 });
    expect(mouse.at(canvas, 1600, 900)).toEqual({ px: 800, py: 450 });
    fire(window, 'mousemove', { clientX: 50, clientY: 275 });
    expect(mouse.at(canvas, 1600, 900)).toBeNull(); // outside the canvas
    fire(window, 'mousemove', { clientX: 500, clientY: 275 });
    document.dispatchEvent(new Event('mouseleave'));
    expect(mouse.at(canvas, 1600, 900)).toBeNull();
  });

  it('after dispose nothing is heard', () => {
    mouse.dispose();
    fire(canvas, 'mousedown', { button: 0 });
    expect(mouse.takePrimary()).toBe(false);
  });
});

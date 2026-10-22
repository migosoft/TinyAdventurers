import { describe, expect, it } from 'vitest';
import { KeyCap } from './keycap';

/** A chainable stand-in for a Phaser game object that records visibility, text and position. */
function fakeObject() {
  const o: Record<string, unknown> = { visible: false, text: '', x: 0, y: 0 };
  const self: any = new Proxy(o, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'setVisible') return (v: boolean) => ((t.visible = v), self);
      if (k === 'setText') return (v: string) => ((t.text = v), self);
      if (k === 'setPosition') return (x: number, y: number) => ((t.x = x), (t.y = y), self);
      if (k === 'destroy') return () => (t.destroyed = true);
      return () => self; // every other setter chains
    },
  });
  return self;
}

function fakeScene() {
  const made: any[] = [];
  const mk = () => (made.push(fakeObject()), made[made.length - 1]);
  return { made, scene: { add: { graphics: mk, text: mk } } as any };
}

describe('KeyCap', () => {
  it('shows the bare cap, shows a label, and hides', () => {
    const { made, scene } = fakeScene();
    const cap = new KeyCap(scene);
    const [g, e, label] = made;
    expect([g.visible, e.visible, label.visible]).toEqual([false, false, false]);

    cap.set(null, 50, 40);
    expect([g.visible, e.visible, label.visible]).toEqual([true, true, false]);
    expect([g.x, g.y]).toEqual([50, 40]);

    cap.set('Wake', 50, 40);
    expect(label.visible).toBe(true);
    expect(label.text).toBe('Wake');
    expect(label.x).toBeGreaterThan(50);

    cap.hide();
    expect([g.visible, e.visible, label.visible]).toEqual([false, false, false]);
  });

  it('destroys all its objects', () => {
    const { made, scene } = fakeScene();
    new KeyCap(scene).destroy();
    expect(made.every((o) => o.destroyed)).toBe(true);
  });
});

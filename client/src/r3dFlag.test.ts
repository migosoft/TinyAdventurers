import { describe, expect, it } from 'vitest';
import { isR3dDemo, r3dPage } from './r3dFlag';

describe('r3dPage', () => {
  it('names the cove page', () => {
    expect(r3dPage('?r3d=cove')).toBe('cove');
    expect(isR3dDemo('?r3d=cove')).toBe(true);
  });
});

describe('r3dPage liquids', () => {
  it('names the liquids page', () => {
    expect(r3dPage('?r3d=liquids')).toBe('liquids');
    expect(isR3dDemo('?r3d=liquids')).toBe(true);
  });
});

describe('r3dFlag', () => {
  it('isR3dDemo is true for a named dev page', () => {
    expect(isR3dDemo('?r3d=demo')).toBe(true);
  });
  it('isR3dDemo is false for a bare ?r3d, other pages and unknown names', () => {
    expect(isR3dDemo('?r3d')).toBe(false);
    expect(isR3dDemo('?gallery')).toBe(false);
    expect(isR3dDemo('?lights')).toBe(false);
    expect(isR3dDemo('?r3d=nope')).toBe(false);
  });
});

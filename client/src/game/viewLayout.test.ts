import { describe, expect, it } from 'vitest';
import { requestedResolution, viewLayout } from './viewLayout';

describe('viewLayout', () => {
  it('puts the zoom on the camera at screen resolution', () => {
    expect(viewLayout(1280, 720, 'screen')).toEqual({ canvasW: 1280, canvasH: 720, cssZoom: 1, camZoom: 2 });
    expect(viewLayout(2560, 1440, 'screen')).toEqual({ canvasW: 2560, canvasH: 1440, cssZoom: 1, camZoom: 4 });
  });

  it('puts the zoom on the CSS scale at world resolution, showing the same world area', () => {
    expect(viewLayout(1280, 720, 'world')).toEqual({ canvasW: 640, canvasH: 360, cssZoom: 2, camZoom: 1 });
    expect(viewLayout(3840, 2160, 'world')).toEqual({ canvasW: 640, canvasH: 360, cssZoom: 6, camZoom: 1 });
  });

  it('rounds the world size up so the canvas covers the window', () => {
    expect(viewLayout(1281, 721, 'screen')).toEqual({ canvasW: 1282, canvasH: 722, cssZoom: 1, camZoom: 2 });
    expect(viewLayout(1281, 721, 'world')).toEqual({ canvasW: 641, canvasH: 361, cssZoom: 2, camZoom: 1 });
  });
});

describe('requestedResolution', () => {
  it('is world only with ?res=world on a debug account', () => {
    expect(requestedResolution('?res=world', true)).toBe('world');
    expect(requestedResolution('?res=world', false)).toBe('screen');
    expect(requestedResolution('', true)).toBe('screen');
    expect(requestedResolution('?res=screen', true)).toBe('screen');
  });
});

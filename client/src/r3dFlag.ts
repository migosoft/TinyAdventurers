/** The server-free dev pages of `?r3d=`: the demo (#301) and the gallery (#303). */
export function r3dPage(search: string): 'demo' | 'gallery' | null {
  const p = new URLSearchParams(search).get('r3d');
  return p === 'demo' || p === 'gallery' ? p : null;
}

/** `?r3d=demo` or `?r3d=gallery`: a dev scene of the 3D view, no server and no login needed. */
export function isR3dDemo(search: string): boolean {
  return r3dPage(search) !== null;
}

/** `?r3d` on a debug account: a run is shown in 3D (the demo and the gallery are separate pages). */
export function wants3d(search: string, debug: boolean): boolean {
  const q = new URLSearchParams(search);
  return q.has('r3d') && !isR3dDemo(search) && debug;
}

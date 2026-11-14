/** The server-free dev pages of `?r3d=`: the demo (#301), the gallery (#303), the lights (#304), the woodland (#306) and the cove (#329). */
export function r3dPage(search: string): 'demo' | 'gallery' | 'lights' | 'woodland' | 'cove' | null {
  const p = new URLSearchParams(search).get('r3d');
  return p === 'demo' || p === 'gallery' || p === 'lights' || p === 'woodland' || p === 'cove' ? p : null;
}

/** `?r3d=demo`, `?r3d=gallery`, `?r3d=lights`, `?r3d=woodland` or `?r3d=cove`: a dev scene of the 3D view, no server and no login needed. */
export function isR3dDemo(search: string): boolean {
  return r3dPage(search) !== null;
}

/** `?r3d` on a debug account: a run is shown in 3D (the dev pages are separate). */
export function wants3d(search: string, debug: boolean): boolean {
  const q = new URLSearchParams(search);
  return q.has('r3d') && !isR3dDemo(search) && debug;
}

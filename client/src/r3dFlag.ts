/** `?r3d=demo`: the 3D dev scene, no server needed. */
export function isR3dDemo(search: string): boolean {
  return new URLSearchParams(search).get('r3d') === 'demo';
}

/** `?r3d` on a debug account: a run is shown in 3D (the demo is a separate page). */
export function wants3d(search: string, debug: boolean): boolean {
  const q = new URLSearchParams(search);
  return q.has('r3d') && !isR3dDemo(search) && debug;
}

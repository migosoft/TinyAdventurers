/** The server-free dev pages of `?r3d=`: the demo (#301), the gallery (#303), the lights (#304), the woodland (#306), the cove (#329), the mood (#307), the sunlight (#307) the effects (#308), the liquids (#324) and the lich (#358). */
export function r3dPage(search: string): 'demo' | 'gallery' | 'lights' | 'woodland' | 'cove' | 'mood' | 'sunlight' | 'fx' | 'liquids' | 'lich' | null {
  const p = new URLSearchParams(search).get('r3d');
  return p === 'demo' || p === 'gallery' || p === 'lights' || p === 'woodland' || p === 'cove' || p === 'mood' || p === 'sunlight' || p === 'fx' || p === 'liquids' || p === 'lich' ? p : null;
}

/** `?r3d=demo`, `?r3d=gallery`, `?r3d=lights`, `?r3d=woodland`, `?r3d=cove`, `?r3d=mood`, `?r3d=sunlight`, `?r3d=fx`, `?r3d=liquids` or `?r3d=lich`: a dev scene of the 3D view, no server and no login needed. */
export function isR3dDemo(search: string): boolean {
  return r3dPage(search) !== null;
}

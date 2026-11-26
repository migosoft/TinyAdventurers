import { renderGroup, uniformArray } from 'three/tsl';

/**
 * A uniform array in the shared `renderGroup` (#433). The default `objectGroup` gives every draw its own copy of the array and
 * three's WebGL backend re-uploads an array buffer whole (`bufferData`) for each draw each frame; in `renderGroup` one buffer
 * serves every draw of a render call. Only for arrays every draw sees alike (all of ours are one node with one value list).
 */
export const sharedArray = (values: Parameters<typeof uniformArray>[0], type: string) => uniformArray(values, type).setGroup(renderGroup);

import { LUT3dlLoader, LUTCubeLoader, type LookupTexture } from 'postprocessing';

/**
 * Load a color-grading LUT (`.cube` or `.3dl`) as a `LookupTexture`,
 * ready for postprocessing's `LUT3DEffect`:
 *
 *   const lut = await loadLUT('/grades/teal-orange.cube');
 *   createComposer(renderer, scene, camera, {
 *     effects: [new LUT3DEffect(lut, { tetrahedralInterpolation: true })],
 *   });
 *
 * On devices without float 3D textures, call `lut.convertToUint8()`
 * first. A LUT is a grade, not a look — the material identity still has
 * to come from the shaders.
 */
export function loadLUT(url: string): Promise<LookupTexture> {
  const loader = /\.3dl(\?|#|$)/i.test(url) ? new LUT3dlLoader() : new LUTCubeLoader();
  return loader.loadAsync(url);
}

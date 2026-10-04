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
 *
 * Rejects on an HTTP error or a file that does not parse as a LUT (an
 * SPA fallback page served for a missing path, for one).
 */
export async function loadLUT(url: string): Promise<LookupTexture> {
  const loader = /\.3dl(\?|#|$)/i.test(url) ? new LUT3dlLoader() : new LUTCubeLoader();
  // Fetched here because postprocessing's loadAsync never settles on an
  // HTTP or parse error.
  const response = await fetch(url);
  if (!response.ok) throw new Error(`loadLUT: ${response.status} at ${url}`);
  let lut: LookupTexture;
  try {
    lut = loader.parse(await response.text());
  } catch (error) {
    throw new Error(`loadLUT: ${url} is not a LUT (${(error as Error).message})`);
  }
  // The .3dl parser takes any line of digits and spaces as its grid, so an
  // HTML page can come back as a one-entry LUT full of NaN.
  if (lut.image.width < 2) throw new Error(`loadLUT: ${url} is not a LUT`);
  return lut;
}

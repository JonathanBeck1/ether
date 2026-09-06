import * as THREE from 'three';
import { tracked, type TrackOptions } from './progress';

export interface LoadTextureOptions extends TrackOptions {
  /** `THREE.SRGBColorSpace` for color maps; leave unset for data maps
   *  (normals, roughness) — the wrong space here is the most common
   *  "why is my model washed out" bug. */
  colorSpace?: THREE.ColorSpace;
}

export function loadTexture(url: string, options: LoadTextureOptions = {}): Promise<THREE.Texture> {
  const load = new THREE.TextureLoader().loadAsync(url).then((texture) => {
    if (options.colorSpace) texture.colorSpace = options.colorSpace;
    return texture;
  });
  return tracked(load, options);
}

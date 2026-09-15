import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { tracked, type TrackOptions } from './progress';

export interface LoadHDROptions extends TrackOptions {
  /** Pass the renderer to also prefilter a PMREM environment map — the
   *  texture `MeshStandardMaterial` / `MeshPhysicalMaterial` want as
   *  `envMap` (and `scene.environment`). Without it you get the raw
   *  equirectangular texture, good for `scene.background`. */
  renderer?: THREE.WebGLRenderer;
}

export interface HDRResult {
  /** Equirectangular radiance texture, mapping already set. */
  texture: THREE.DataTexture;
  /** PMREM-prefiltered environment — only when a renderer was given. */
  envMap?: THREE.Texture;
  dispose(): void;
}

export function loadHDR(url: string, options: LoadHDROptions = {}): Promise<HDRResult> {
  const load = new RGBELoader().loadAsync(url).then((texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    if (!options.renderer) return { texture, dispose: () => texture.dispose() };
    const pmrem = new THREE.PMREMGenerator(options.renderer);
    // Dispose the cubeUV target, not just its texture: three never marks a
    // PMREM target's texture initialised, so disposing that alone frees
    // nothing and the half-float target leaks on every route change.
    const target = pmrem.fromEquirectangular(texture);
    return {
      texture,
      envMap: target.texture,
      dispose: () => {
        texture.dispose();
        target.dispose();
        pmrem.dispose();
      },
    };
  });
  return tracked(load, options);
}

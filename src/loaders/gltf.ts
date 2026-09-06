import type * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { tracked, type TrackOptions } from './progress';

export interface LoadGLTFOptions extends TrackOptions {
  /** Folder you serve the Draco decoder from, for Draco-compressed
   *  meshes: `cp -r node_modules/three/examples/jsm/libs/draco public/draco`
   *  then `'/draco/'`. No CDN default — a premium site serves its own. */
  dracoDecoderPath?: string;
  /** KTX2 / Basis textures: the transcoder folder (`.../libs/basis` →
   *  `'/basis/'`) plus the renderer, which decides the target GPU format. */
  ktx2?: { transcoderPath: string; renderer: THREE.WebGLRenderer };
}

// One decoder per path: each DRACOLoader spins up a worker pool and each
// KTX2Loader a transcoder — sharing them across models is the point.
const dracoLoaders = new Map<string, DRACOLoader>();
const ktx2Loaders = new Map<string, KTX2Loader>();

function dracoFor(decoderPath: string): DRACOLoader {
  let loader = dracoLoaders.get(decoderPath);
  if (!loader) {
    loader = new DRACOLoader().setDecoderPath(decoderPath);
    dracoLoaders.set(decoderPath, loader);
  }
  return loader;
}

function ktx2For(transcoderPath: string, renderer: THREE.WebGLRenderer): KTX2Loader {
  let loader = ktx2Loaders.get(transcoderPath);
  if (!loader) {
    loader = new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(renderer);
    ktx2Loaders.set(transcoderPath, loader);
  }
  return loader;
}

/** Load a `.glb` / `.gltf`, with Draco and KTX2 support when you serve the decoders. */
export function loadGLTF(url: string, options: LoadGLTFOptions = {}): Promise<GLTF> {
  const loader = new GLTFLoader();
  if (options.dracoDecoderPath) loader.setDRACOLoader(dracoFor(options.dracoDecoderPath));
  if (options.ktx2) loader.setKTX2Loader(ktx2For(options.ktx2.transcoderPath, options.ktx2.renderer));
  return tracked(loader.loadAsync(url), options);
}

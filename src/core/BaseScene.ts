import * as THREE from 'three';
import type { EffectComposer } from 'postprocessing';
import type { Scene } from './types';

/**
 * Convenience base class implementing the {@link Scene} contract — handles
 * disposable tracking and camera setup. Subclass and override the lifecycle
 * methods.
 *
 * The defaults here match TakeTwo's first site. They're cheap to override
 * in the subclass — either by passing options to `super({...})` or by
 * setting `this.camera.position` directly after `super()`.
 *
 * Defaults: fov 50, near 0.1, far 100, cameraZ 4.
 */
export interface BaseSceneOptions {
  /** Vertical field of view, degrees. Default 50. */
  fov?: number;
  /** Near plane. Default 0.1. */
  near?: number;
  /** Far plane. Default 100. */
  far?: number;
  /** Initial camera z. Default 4. */
  cameraZ?: number;
}

export abstract class BaseScene implements Scene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer?: EffectComposer;

  protected disposables: { dispose(): void }[] = [];

  constructor(options: BaseSceneOptions = {}) {
    const fov = options.fov ?? 50;
    const near = options.near ?? 0.1;
    const far = options.far ?? 100;
    const cameraZ = options.cameraZ ?? 4;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      fov,
      window.innerWidth / window.innerHeight,
      near,
      far,
    );
    this.camera.position.set(0, 0, cameraZ);
  }

  /** Register a disposable for automatic cleanup in `dispose()`. */
  protected track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  async preload(): Promise<void> { /* override */ }

  abstract enterTransition(): Promise<void>;
  abstract exitTransition(): Promise<void>;
  abstract tick(time: number, deltaTime: number): void;

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.composer?.dispose();
  }
}

// Re-export Scene from types so consumers can `import { Scene } from
// '@taketwo/kit/core'` directly without reaching into ./types.
export type { Scene } from './types';

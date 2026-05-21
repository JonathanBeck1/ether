import * as THREE from 'three';
import {
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  CAMERA_Z_START,
} from './constants';
import type { Scene } from './types';
import type { EffectComposer } from 'postprocessing';

/**
 * Base class implementing the Scene contract — handles disposable
 * tracking and camera setup. Subclass and override the lifecycle methods.
 *
 * The Scene interface itself lives in `./types`. This file is just the
 * convenience base class.
 */
export abstract class BaseScene implements Scene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer?: EffectComposer;

  protected disposables: { dispose(): void }[] = [];

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_NEAR,
      CAMERA_FAR
    );
    this.camera.position.set(0, 0, CAMERA_Z_START);
  }

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

// Re-export Scene from types so existing imports from './BaseScene'
// continue to work without churn.
export type { Scene } from './types';

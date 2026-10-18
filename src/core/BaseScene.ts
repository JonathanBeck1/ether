import * as THREE from 'three';
import type { EffectComposer } from 'postprocessing';
import type { Scene } from './types.js';

/**
 * Convenience base class implementing the {@link Scene} contract — handles
 * disposable tracking and camera setup. Subclass and override the lifecycle
 * methods.
 *
 * The defaults suit a centered hero subject. They're cheap to override
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

/** What `track()` accepts; `dispose()` calls the first teardown method the value has. */
export type Trackable =
  | { dispose(): void }
  | { kill(): void }
  | { destroy(): void }
  | { disconnect(): void }
  | { revert(): void }
  | (() => void);

function toDisposable(d: Trackable): { dispose(): void } {
  if (typeof d === 'function') return { dispose: d };
  if ('dispose' in d) return d;
  if ('kill' in d) return { dispose: () => d.kill() };
  if ('destroy' in d) return { dispose: () => d.destroy() };
  if ('disconnect' in d) return { dispose: () => d.disconnect() };
  return { dispose: () => d.revert() };
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

  /** Register a resource, tween, trigger, observer or teardown function for `dispose()`. */
  protected track<T extends Trackable>(d: T): T {
    this.disposables.push(toDisposable(d));
    return d;
  }

  /** Add an event listener that `dispose()` removes. */
  protected listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  protected listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  protected listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  protected listen(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  protected listen(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.track(() => target.removeEventListener(type, handler, options));
  }

  async preload(): Promise<void> { /* override */ }

  abstract enterTransition(): Promise<void>;
  abstract exitTransition(): Promise<void>;
  abstract tick(time: number, deltaTime: number): void;

  /** Tears down tracked values newest first, then the composer; rethrows teardown errors afterwards. Safe to call twice. */
  dispose(): void {
    const disposables = this.disposables;
    this.disposables = [];
    const errors: unknown[] = [];
    for (let i = disposables.length - 1; i >= 0; i--) {
      try {
        disposables[i].dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.composer?.dispose();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, `${errors.length} teardowns threw`);
  }
}

// Re-export Scene from types so consumers can `import { Scene } from
// 'ether/core'` directly without reaching into ./types.
export type { Scene } from './types.js';

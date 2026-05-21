import type * as THREE from 'three';
import type { EffectComposer } from 'postprocessing';

/**
 * Shared TypeScript types for `@taketwo/kit/core`.
 *
 * Anything in here is engine-level — site code consumes these, the engine
 * never reaches into site types. Brand-specific types (LetterMesh, drift
 * motion, etc.) stay in each site's local `types.ts`.
 */

// ─── SCENE CONTRACT ──────────────────────────────────────────────────

/**
 * Contract every page-specific Scene must satisfy. `SceneManager` only
 * knows about this interface — it never reaches into concrete scene
 * implementations directly.
 */
export interface Scene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** If set, replaces direct `renderer.render` with `composer.render`. */
  composer?: EffectComposer;

  preload?(): Promise<void>;
  enterTransition(): Promise<void>;
  exitTransition(): Promise<void>;
  tick(time: number, deltaTime: number): void;
  /** Optional resize hook called from SceneManager when viewport changes. */
  onResize?(width: number, height: number): void;
  dispose(): void;
}

import type * as THREE from 'three';
import type { EffectComposer } from 'postprocessing';

/**
 * Shared TypeScript types for `aether/core`.
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
  /** Set false for park scenes (routes where the canvas is hidden behind
   *  an opaque DOM world): tick still runs, but no GPU render is issued —
   *  a full-DPR framebuffer behind an opaque page is pure waste. */
  readonly renders?: boolean;

  preload?(): Promise<void>;
  /**
   * Play the scene's entrance. May be INTERRUPTED mid-animation by a
   * navigation: the manager does not await it, and `dispose()` can run
   * while it plays — kill intro timelines in `dispose()` so their
   * onComplete callbacks can't fire against a dead scene.
   */
  enterTransition(): Promise<void>;
  /**
   * Play the scene's exit. Called inside the `astro:before-swap`
   * dispatch — everything BEFORE the first `await` runs ahead of the
   * DOM swap and Astro's scroll handling. Detach scroll/DOM-coupled
   * state (ScrollTriggers, Lenis bridge) synchronously there; the
   * awaited remainder (e.g. a fade to dark) overlaps the swap on the
   * persistent canvas. Leave the framebuffer dark: the last rendered
   * frame holds until the next scene's first render.
   */
  exitTransition(): Promise<void>;
  tick(time: number, deltaTime: number): void;
  /** Optional resize hook called from SceneManager when viewport changes. */
  onResize?(width: number, height: number): void;
  /**
   * Same-world navigation. When the destination route resolves to the SAME
   * factory as the current one and this hook exists, the manager calls it
   * INSTEAD of exit/dispose/rebuild — the scene stays alive across the DOM
   * swap and plays its own continuous transition (the basement.studio
   * move). Runs inside the `astro:before-swap` dispatch: the new DOM is
   * not in yet — defer DOM-coupled wiring to `astro:page-load`.
   */
  retarget?(route: string): void;
  dispose(): void;
}

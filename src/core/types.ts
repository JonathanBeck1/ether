import type * as THREE from 'three';
import type { EffectComposer } from 'postprocessing';
import type { QualityProfile } from '../quality/quality';

/**
 * Shared TypeScript types for `ether/core`.
 *
 * Anything in here is engine-level — site code consumes these, the engine
 * never reaches into site types. Site-specific types (LetterMesh, drift
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
   * navigation: the manager does not await it, so `exitTransition()` runs
   * against a scene still entering, and `dispose()` follows — kill intro
   * timelines in `dispose()` so their onComplete callbacks can't fire
   * against a dead scene.
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

// ─── RUNTIME DIAGNOSTICS ─────────────────────────────────────────────

/**
 * JSON-safe snapshot from `SceneManager.getDiagnostics()`: finite numbers,
 * strings, booleans, null, plain objects/arrays. Built fresh per call.
 */
export interface RuntimeDiagnostics {
  scene: {
    /**
     * exiting: outgoing scene still live, awaiting exitTransition. loading:
     * nothing live, incoming scene constructing/preloading (incl. cold boot).
     * empty: no live scene and no hop. destroyed: after destroy(); detach also
     * removes the canvas tag, so only a held manager reference sees it.
     */
    phase: 'empty' | 'exiting' | 'loading' | 'active' | 'destroyed';
    /**
     * The manager's current normalized pathname (the real path, also for '*'
     * matches). Still the departed route while exiting/loading; null before
     * the first hop and after a failed one.
     */
    route: string | null;
    /** route resolved to the '*' factory, not an exact registration. */
    fallback: boolean;
    /** Destination of the hop in flight; null when no hop is running. */
    target: string | null;
    /**
     * Serial of the live scene: new on every rebuild, unchanged by retarget().
     * null when nothing is live.
     */
    id: number | null;
    /**
     * The live scene's enterTransition() has settled (resolved or rejected).
     * Unchanged by retarget().
     */
    entered: boolean;
    /** Hops and enterTransitions that threw since construction. */
    failures: number;
    /** "<route>: <message>" of the latest failure. */
    lastError: string | null;
  };
  performance: {
    /**
     * Loop ticks since start(). Monotonic; frozen while the tab is hidden or
     * if the loop died.
     */
    frames: number;
    /**
     * Ticks per second over the last closed >=500 ms window. null until one
     * closes, and again after a >1 s gap between ticks (hidden tab, debugger,
     * or a main-thread stall) until the next one does; stalls over 1 s are
     * excluded, not averaged in.
     */
    fps: number | null;
    /**
     * Mean main-thread ms per tick (scene.tick + render submission) over the
     * same window. Not GPU time; timer resolution is coarse (~0.1 ms), so
     * light scenes can read 0.
     */
    cpuMs: number | null;
  };
  rendering: {
    /** Why the last tick issued no scene render; null when it rendered. */
    skipped: 'no-scene' | 'context-lost' | 'renders-false' | 'zero-size' | null;
    /**
     * renderer.render() calls in the last tick: one per composer pass (bloom
     * mip passes included), plus renders made inside scene.tick.
     */
    renderCalls: number;
    /** Last-tick totals across all of those calls, shadow maps included. */
    drawCalls: number;
    triangles: number;
    /** Live renderer-wide counts; composer render targets count as textures. */
    geometries: number;
    textures: number;
    programs: number;
    /**
     * renderer.getPixelRatio(): the DPR applied at boot, not quality.dprCap.
     */
    dpr: number;
    contextLost: boolean;
  };
  /** Observed on the live scene's composer (not quality.enablePostFX). */
  postFX: {
    enabled: boolean;
    /**
     * composer.multisampling: samples requested on the composer targets (three
     * clamps to the GPU max at allocation); null without a composer.
     */
    msaa: number | null;
    /**
     * Names of the enabled passes, in order, e.g. ['RenderPass','EffectPass'].
     */
    passes: string[];
  };
  /** Intent: copy of the profile the manager was built with. */
  quality: QualityProfile;
}

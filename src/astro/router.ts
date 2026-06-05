import type * as THREE from 'three';
import { SceneManager } from '../core/SceneManager';
import type { Scene } from '../core/types';
import { detectQuality, type QualityProfile } from '../quality/quality';

/**
 * Factory the caller supplies — receives the live `WebGLRenderer` and the
 * resolved `QualityProfile`, returns the initial scene to mount.
 *
 * @example
 *   initSceneRouter(canvas, (renderer, quality) => new HomeScene(renderer, quality));
 */
export type SceneFactory<S extends Scene> = (
  renderer: THREE.WebGLRenderer,
  quality: QualityProfile,
) => S;

/**
 * Persistent-canvas Astro router.
 *
 * Owns the single-canvas pattern: a persistent `<canvas>` element
 * survives Astro client-side navigations via `transition:persist`, and
 * this initializer keeps exactly one `SceneManager` attached to it. If a
 * previous manager is still alive (HMR, double-init, weird reload path),
 * we tear it down BEFORE creating the new one — two render loops drawing
 * into the same canvas presents as ghost-doubled letters and
 * frame-to-frame jitter.
 *
 * The manager is tagged onto the canvas element itself (not module-scope
 * state), which makes it robust to HMR module-instance churn.
 *
 * Quality is resolved BEFORE the renderer is constructed so we never have
 * to recreate the WebGLRenderer at runtime with different antialias / DPR
 * settings — you can't change MSAA on a live WebGL context. One-shot.
 */
type ManagedCanvas = HTMLCanvasElement & {
  __sceneManager?: SceneManager;
  /** In-flight init promise — present while an init is mid-await. Lets a
   *  second overlapping call return the same manager instead of spawning a
   *  duplicate render loop. Cleared on teardown so post-navigation re-init runs. */
  __sceneManagerInit?: Promise<SceneManager>;
};
const SCENE_MANAGER_KEY = '__sceneManager' as const;

export interface InitSceneRouterOptions {
  /** Route name to register + transition into. Default '/'. */
  routeName?: string;
  /**
   * Override the quality profile (skip auto-detection). Useful for tests
   * or sites that want to force LOW for QA.
   */
  quality?: QualityProfile;
}

export async function initSceneRouter<S extends Scene>(
  canvas: HTMLCanvasElement,
  sceneFactory: SceneFactory<S>,
  options: InitSceneRouterOptions = {},
): Promise<SceneManager> {
  const tagged = canvas as ManagedCanvas;

  // Single-flight guard. initSceneRouter is async (it awaits detectQuality),
  // so two overlapping boot() calls — Astro's ClientRouter re-running the page
  // script on a transition, the requestIdleCallback trigger, HMR — would BOTH
  // clear the teardown check below before either tagged a manager, leaving N
  // concurrent SceneManagers + render loops on one persistent canvas. That
  // presents as the letters teleporting between layouts every frame. If an
  // init is already in flight for this canvas, hand back the same one.
  if (tagged.__sceneManagerInit) return tagged.__sceneManagerInit;

  const run = (async (): Promise<SceneManager> => {
    const { routeName = '/', quality: forcedQuality } = options;

    // Defensive teardown — see SceneManager docs for why this matters.
    if (tagged[SCENE_MANAGER_KEY]) {
      try {
        tagged[SCENE_MANAGER_KEY]!.destroy();
      } catch (err) {
        console.warn('[kit/astro/router] prior manager destroy threw:', err);
      }
      delete tagged[SCENE_MANAGER_KEY];
    }

    const quality = forcedQuality ?? (await detectQuality());
    // Surface tier on <body> for any non-JS consumer (CSS hooks, debug
    // overlays, analytics). Reads as `data-gpu-tier="LOW|MID|HIGH"`.
    document.body.setAttribute('data-gpu-tier', quality.tier);

    const manager = new SceneManager(canvas, quality);
    tagged[SCENE_MANAGER_KEY] = manager;
    manager.registerScene(routeName, (r) => sceneFactory(r, quality));

    manager.start();
    manager.transitionTo(routeName).catch((err) => {
      console.error('[kit/astro/router] transitionTo failed:', err);
    });

    // Proactive cleanup hooks. astro:before-swap fires before a client-side
    // navigation swaps the DOM (canvas persists, but JS context may re-init).
    // beforeunload covers hard reload / tab close. Clearing __sceneManagerInit
    // lets the next page's boot() build a fresh manager instead of being handed
    // this (now torn-down) one.
    const cleanup = () => {
      if (tagged[SCENE_MANAGER_KEY] === manager) {
        manager.destroy();
        delete tagged[SCENE_MANAGER_KEY];
      }
      delete tagged.__sceneManagerInit;
    };
    document.addEventListener('astro:before-swap', cleanup, { once: true });
    window.addEventListener('beforeunload', cleanup, { once: true });

    return manager;
  })();

  tagged.__sceneManagerInit = run;
  return run;
}

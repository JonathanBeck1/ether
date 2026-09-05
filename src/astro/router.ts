import type * as THREE from 'three';
import { SceneManager } from '../core/SceneManager';
import type { Scene } from '../core/types';
import { detectQuality, type QualityProfile } from '../quality/quality';

/**
 * Factory the caller supplies per route — receives the live
 * `WebGLRenderer` and the resolved `QualityProfile`, returns that
 * route's scene.
 */
export type SceneFactory<S extends Scene> = (
  renderer: THREE.WebGLRenderer,
  quality: QualityProfile,
  route?: string,
) => S;

/**
 * Route table: pathname → scene factory.
 *
 * @example
 *   initSceneRouter(canvas, {
 *     '/': (r, q) => new HomeScene(r, q),
 *     '/web': (r, q) => new WebScene(r, q),
 *   });
 */
export type SceneRoutes = Record<string, SceneFactory<Scene>>;

/**
 * Persistent-canvas Astro router.
 *
 * Owns the single-canvas pattern: a persistent `<canvas>` element
 * survives Astro client-side navigations via `transition:persist`, and
 * this initializer keeps exactly one `SceneManager` attached to it — for
 * the LIFETIME OF THE TAB, not per page. Navigation is a scene
 * transition (`astro:before-swap` → `manager.transitionTo`), never a
 * manager teardown; the renderer and its GL context are reused across
 * every route. If a previous manager is still alive (HMR, double-init,
 * weird reload path), we tear it down BEFORE creating the new one — two
 * render loops drawing into the same canvas presents as ghost-doubled
 * letters and frame-to-frame jitter.
 *
 * The manager is tagged onto the canvas element itself (not module-scope
 * state), which makes it robust to HMR module-instance churn.
 *
 * Quality is resolved BEFORE the renderer is constructed so we never have
 * to recreate the WebGLRenderer at runtime with different antialias / DPR
 * settings — you can't change MSAA on a live WebGL context. One-shot.
 *
 * Browsers without View Transitions get Astro's full-page-load fallback:
 * fresh document, fresh boot, fresh manager — degraded but correct, no
 * special handling.
 */
type ManagedCanvas = HTMLCanvasElement & {
  __sceneManager?: SceneManager;
  /** In-flight init promise — present while an init is mid-await. Lets a
   *  second overlapping call return the same manager instead of spawning a
   *  duplicate render loop. Cleared on teardown so a re-init can run. */
  __sceneManagerInit?: Promise<SceneManager>;
};
const SCENE_MANAGER_KEY = '__sceneManager' as const;

export interface InitSceneRouterOptions {
  /**
   * Override the quality profile (skip auto-detection). Useful for tests
   * or sites that want to force LOW for QA.
   */
  quality?: QualityProfile;
}

/**
 * Trailing-slash-insensitive route key. Astro's default directory build
 * serves `/web/` in prod and preview while dev serves `/web`; both must
 * resolve to the same registered scene. Root stays `/`.
 */
export function normalizeRoute(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, '') || '/';
}

export async function initSceneRouter(
  canvas: HTMLCanvasElement,
  routes: SceneRoutes,
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
    const { quality: forcedQuality } = options;

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
    // One wrapper per UNIQUE factory: two routes sharing a factory must
    // register the same function object, or the manager's same-world
    // comparison (the retarget path) can never match.
    const wrappers = new Map<SceneFactory<Scene>, (r: THREE.WebGLRenderer, route?: string) => Scene>();
    for (const [route, factory] of Object.entries(routes)) {
      let wrapped = wrappers.get(factory);
      if (!wrapped) {
        wrapped = (r, routeName) => factory(r, quality, routeName);
        wrappers.set(factory, wrapped);
      }
      manager.registerScene(normalizeRoute(route), wrapped);
    }

    manager.start();
    // Initial route from the address bar — deep loads on any registered
    // route mount that route's scene directly.
    manager.transitionTo(normalizeRoute(location.pathname)).catch((err) => {
      console.error('[kit/astro/router] transitionTo failed:', err);
    });

    // Navigation = scene transition, not teardown. before-swap (never
    // after-swap): the event dispatch runs the outgoing scene's
    // exitTransition synchronously up to its first await, so scroll- and
    // DOM-coupled state (ScrollTriggers, Lenis) detaches BEFORE Astro
    // mutates the DOM and resets scroll. `e.to` carries the destination
    // (location.pathname is still the OLD path at dispatch time).
    const onBeforeSwap = (e: Event) => {
      // If a defensive teardown ever displaced this manager, its
      // listener must not drive transitions on the corpse.
      if (tagged[SCENE_MANAGER_KEY] !== manager) return;
      const swap = e as Event & { to: URL; newDocument: Document };
      // Astro swaps <body> wholesale, wiping attributes the router set
      // at init — re-apply the tier on the incoming document.
      swap.newDocument.body.setAttribute('data-gpu-tier', quality.tier);
      // force: Astro full-swaps even same-path clicks (logo while on
      // home), detaching every node the live scene's triggers hold —
      // same-route must still exit and re-enter against the fresh DOM.
      manager
        .transitionTo(normalizeRoute(swap.to.pathname), { force: true })
        .catch((err) => {
          console.error('[kit/astro/router] transitionTo failed:', err);
        });
    };
    document.addEventListener('astro:before-swap', onBeforeSwap);

    // Real teardown only on hard unload / tab close. (Pre-multi-route
    // this cleanup also ran on astro:before-swap — which is exactly why
    // the router couldn't route.)
    const cleanup = () => {
      document.removeEventListener('astro:before-swap', onBeforeSwap);
      if (tagged[SCENE_MANAGER_KEY] === manager) {
        manager.destroy();
        delete tagged[SCENE_MANAGER_KEY];
      }
      delete tagged.__sceneManagerInit;
    };
    window.addEventListener('beforeunload', cleanup, { once: true });

    return manager;
  })();

  tagged.__sceneManagerInit = run;
  return run;
}

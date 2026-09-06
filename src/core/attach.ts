import type * as THREE from 'three';
import { SceneManager } from './SceneManager';
import type { Scene } from './types';
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
 * Route table: pathname → scene factory. `'*'` is the fallback for
 * unregistered routes.
 *
 * @example
 *   attachSceneManager(canvas, {
 *     '/': (r, q) => new HomeScene(r, q),
 *     '/work': (r, q) => new WorkScene(r, q),
 *   });
 */
export type SceneRoutes = Record<string, SceneFactory<Scene>>;

export interface AttachOptions {
  /**
   * Override the quality profile (skip auto-detection). Useful for tests
   * or sites that want to force LOW for QA.
   */
  quality?: QualityProfile;
  /**
   * Runs once the manager is live. Wire your framework's navigation
   * events to `attachment.transitionTo` here and return the unbind — it
   * runs on detach. Both adapters the kit ships (`ether/astro`,
   * `ether/vanilla`) are a dozen lines of this.
   */
  bind?: (attachment: Attachment) => (() => void) | void;
}

export interface Attachment {
  readonly manager: SceneManager;
  readonly quality: QualityProfile;
  /** False once a later attach displaced this one (HMR, double boot). */
  isCurrent(): boolean;
  /** Normalizes the pathname, drives the manager, logs a failure. */
  transitionTo(pathname: string, options?: { force?: boolean }): Promise<void>;
  /** Unbinds, destroys the manager if still current, frees the canvas. */
  detach(): void;
}

/**
 * The manager is tagged onto the canvas element itself (not module-scope
 * state), which makes it robust to HMR module-instance churn.
 */
type ManagedCanvas = HTMLCanvasElement & {
  __sceneManager?: SceneManager;
  /** In-flight init promise — present while an init is mid-await. Lets a
   *  second overlapping call return the same attachment instead of
   *  spawning a duplicate render loop. Cleared on detach so a re-init
   *  can run. */
  __sceneManagerInit?: Promise<Attachment>;
};
const SCENE_MANAGER_KEY = '__sceneManager' as const;

/**
 * Trailing-slash-insensitive route key. Static hosts serve `/web/` in
 * prod while dev servers serve `/web`; both must resolve to the same
 * registered scene. Root stays `/`.
 */
export function normalizeRoute(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Framework-agnostic half of the persistent-canvas pattern.
 *
 * Keeps exactly one `SceneManager` attached to a canvas — for the
 * LIFETIME OF THE TAB, not per page. Navigation is a scene transition
 * (`attachment.transitionTo`), never a manager teardown; the renderer and
 * its GL context are reused across every route. If a previous manager is
 * still alive (HMR, double-init, weird reload path), it is torn down
 * BEFORE the new one is created — two render loops drawing into the same
 * canvas presents as ghost-doubled geometry and frame-to-frame jitter.
 *
 * Quality is resolved BEFORE the renderer is constructed so the
 * WebGLRenderer never has to be recreated at runtime with different
 * antialias / DPR settings — you can't change MSAA on a live WebGL
 * context. One-shot.
 *
 * What it does NOT know: how your framework announces a navigation.
 * That is the `bind` option — see `ether/astro` and `ether/vanilla`.
 */
export function attachSceneManager(
  canvas: HTMLCanvasElement,
  routes: SceneRoutes,
  options: AttachOptions = {},
): Promise<Attachment> {
  const tagged = canvas as ManagedCanvas;

  // Single-flight guard. Attaching is async (it awaits detectQuality), so
  // two overlapping boot() calls — a client router re-running the page
  // script on a transition, a requestIdleCallback trigger, HMR — would
  // BOTH clear the teardown check below before either tagged a manager,
  // leaving N concurrent SceneManagers + render loops on one persistent
  // canvas. If an init is already in flight for this canvas, hand back
  // the same one.
  if (tagged.__sceneManagerInit) return tagged.__sceneManagerInit;

  const run = (async (): Promise<Attachment> => {
    // Defensive teardown — see SceneManager docs for why this matters.
    if (tagged[SCENE_MANAGER_KEY]) {
      try {
        tagged[SCENE_MANAGER_KEY]!.destroy();
      } catch (err) {
        console.warn('[ether/core] prior manager destroy threw:', err);
      }
      delete tagged[SCENE_MANAGER_KEY];
    }

    const quality = options.quality ?? (await detectQuality());
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

    const transitionTo = (pathname: string, transition: { force?: boolean } = {}) =>
      manager.transitionTo(normalizeRoute(pathname), transition).catch((err) => {
        console.error('[ether/core] transitionTo failed:', err);
      });

    let unbind: (() => void) | void;
    let detached = false;
    const attachment: Attachment = {
      manager,
      quality,
      isCurrent: () => tagged[SCENE_MANAGER_KEY] === manager,
      transitionTo,
      detach() {
        if (detached) return;
        detached = true;
        window.removeEventListener('beforeunload', attachment.detach);
        unbind?.();
        if (tagged[SCENE_MANAGER_KEY] === manager) {
          manager.destroy();
          delete tagged[SCENE_MANAGER_KEY];
        }
        delete tagged.__sceneManagerInit;
      },
    };

    // Initial route from the address bar — deep loads on any registered
    // route mount that route's scene directly.
    transitionTo(location.pathname);
    unbind = options.bind?.(attachment);
    // Real teardown only on hard unload / tab close.
    window.addEventListener('beforeunload', attachment.detach, { once: true });

    return attachment;
  })();

  tagged.__sceneManagerInit = run;
  return run;
}

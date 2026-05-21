import { SceneManager } from './SceneManager';
import { HomeScene } from './scenes/home/HomeScene';

// Tag the canvas itself with the manager. The canvas is the persistent DOM
// element (Astro's transition:persist), so this survives whatever surrounds it
// and gives us a single source of truth for "is there already a live scene
// rendering into this canvas?". Avoids module-scoped state that can desync
// across Vite HMR or unusual reload paths.
type ManagedCanvas = HTMLCanvasElement & { __sceneManager?: SceneManager };

const SCENE_MANAGER_KEY = '__sceneManager' as const;

/**
 * Single-page architecture: one HomeScene drives the entire site.
 *
 * Defensive teardown: if a previous SceneManager is still attached to the
 * canvas (Astro client-side nav, HMR, etc.), we dispose it BEFORE creating
 * the new one. Two concurrent render loops on the same canvas → ghosting +
 * frame-to-frame jitter, which is what we're guarding against.
 */
export function initSceneRouter(canvas: HTMLCanvasElement): void {
  const tagged = canvas as ManagedCanvas;

  // If a previous manager is alive on this canvas, tear it down first.
  // Forced context-loss inside destroy() ensures the next WebGLRenderer
  // gets a clean GL context.
  if (tagged[SCENE_MANAGER_KEY]) {
    try {
      tagged[SCENE_MANAGER_KEY]!.destroy();
    } catch (err) {
      console.warn('[SceneRouter] prior manager destroy threw:', err);
    }
    delete tagged[SCENE_MANAGER_KEY];
  }

  const manager = new SceneManager(canvas);
  tagged[SCENE_MANAGER_KEY] = manager;
  manager.registerScene('/', (r) => new HomeScene(r));

  manager.start();
  manager.transitionTo('/').catch((err) => {
    console.error('[SceneRouter] transitionTo failed:', err);
  });

  // Proactive cleanup hooks. astro:before-swap fires before a client-side
  // navigation swaps the DOM (canvas persists, but JS context may re-init).
  // beforeunload covers hard reload / tab close.
  const cleanup = () => {
    if (tagged[SCENE_MANAGER_KEY] === manager) {
      manager.destroy();
      delete tagged[SCENE_MANAGER_KEY];
    }
  };
  document.addEventListener('astro:before-swap', cleanup, { once: true });
  window.addEventListener('beforeunload', cleanup, { once: true });
}

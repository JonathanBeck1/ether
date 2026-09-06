import type { SceneManager } from '../core/SceneManager';
import { attachSceneManager, type SceneRoutes } from '../core/attach';
import type { QualityProfile } from '../quality/quality';

export type { SceneFactory, SceneRoutes } from '../core/attach';

export interface InitSceneRouterOptions {
  /**
   * Override the quality profile (skip auto-detection). Useful for tests
   * or sites that want to force LOW for QA.
   */
  quality?: QualityProfile;
}

/**
 * Persistent-canvas Astro router.
 *
 * A persistent `<canvas>` element survives Astro client-side navigations
 * via `transition:persist`; `attachSceneManager` keeps exactly one
 * `SceneManager` on it for the lifetime of the tab, and this adapter
 * turns `astro:before-swap` into scene transitions.
 *
 * Browsers without View Transitions get Astro's full-page-load fallback:
 * fresh document, fresh boot, fresh manager — degraded but correct, no
 * special handling.
 */
export async function initSceneRouter(
  canvas: HTMLCanvasElement,
  routes: SceneRoutes,
  options: InitSceneRouterOptions = {},
): Promise<SceneManager> {
  const attachment = await attachSceneManager(canvas, routes, {
    quality: options.quality,
    bind(attached) {
      // Navigation = scene transition, not teardown. before-swap (never
      // after-swap): the event dispatch runs the outgoing scene's
      // exitTransition synchronously up to its first await, so scroll- and
      // DOM-coupled state (ScrollTriggers, Lenis) detaches BEFORE Astro
      // mutates the DOM and resets scroll. `e.to` carries the destination
      // (location.pathname is still the OLD path at dispatch time).
      const onBeforeSwap = (e: Event) => {
        // If a defensive teardown ever displaced this manager, its
        // listener must not drive transitions on the corpse.
        if (!attached.isCurrent()) return;
        const swap = e as Event & { to: URL; newDocument: Document };
        // Astro swaps <body> wholesale, wiping attributes the router set
        // at init — re-apply the tier on the incoming document.
        swap.newDocument.body.setAttribute('data-gpu-tier', attached.quality.tier);
        // force: Astro full-swaps even same-path clicks (logo while on
        // home), detaching every node the live scene's triggers hold —
        // same-route must still exit and re-enter against the fresh DOM.
        attached.transitionTo(swap.to.pathname, { force: true });
      };
      document.addEventListener('astro:before-swap', onBeforeSwap);
      return () => document.removeEventListener('astro:before-swap', onBeforeSwap);
    },
  });
  return attachment.manager;
}

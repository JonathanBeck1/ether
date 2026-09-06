import type { SceneManager } from '../core/SceneManager';
import { attachSceneManager, type Attachment, type SceneRoutes } from '../core/attach';
import type { QualityProfile } from '../quality/quality';

export type { SceneFactory, SceneRoutes } from '../core/attach';

export interface VanillaRouterOptions {
  /** Override the quality profile (skip auto-detection). */
  quality?: QualityProfile;
  /**
   * Route same-origin `<a>` clicks through `navigate` (pushState + scene
   * transition). Off by default — most apps already own link handling.
   */
  interceptLinks?: boolean;
}

export interface VanillaRouter {
  readonly manager: SceneManager;
  /** pushState (or replaceState) to `to`, then transition the scene. */
  navigate(to: string, options?: { replace?: boolean }): Promise<void>;
  /** Tear the manager down and free the canvas for a fresh init. */
  destroy(): void;
}

/**
 * Persistent-canvas router for plain Vite sites (no framework). The
 * History API is the navigation source: `popstate` drives back/forward,
 * `navigate()` drives programmatic moves, and `interceptLinks` opts
 * same-origin anchors in. The engine swaps scenes — your app swaps
 * whatever DOM it owns.
 */
export async function initSceneRouter(
  canvas: HTMLCanvasElement,
  routes: SceneRoutes,
  options: VanillaRouterOptions = {},
): Promise<VanillaRouter> {
  const attachment = await attachSceneManager(canvas, routes, {
    quality: options.quality,
    bind(attached) {
      const onPopState = () => {
        if (attached.isCurrent()) attached.transitionTo(location.pathname);
      };
      window.addEventListener('popstate', onPopState);

      const onClick = options.interceptLinks
        ? (e: MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const anchor = (e.target as Element | null)?.closest?.('a[href]');
            if (!(anchor instanceof HTMLAnchorElement)) return;
            if (anchor.target || anchor.hasAttribute('download')) return;
            const url = new URL(anchor.href, location.href);
            if (url.origin !== location.origin) return;
            e.preventDefault();
            navigate(attached, url, false);
          }
        : null;
      if (onClick) document.addEventListener('click', onClick);

      return () => {
        window.removeEventListener('popstate', onPopState);
        if (onClick) document.removeEventListener('click', onClick);
      };
    },
  });

  return {
    manager: attachment.manager,
    navigate: (to, { replace = false } = {}) =>
      navigate(attachment, new URL(to, location.href), replace),
    destroy: () => attachment.detach(),
  };
}

function navigate(attachment: Attachment, url: URL, replace: boolean): Promise<void> {
  if (replace) history.replaceState(history.state, '', url);
  else history.pushState(null, '', url);
  return attachment.transitionTo(url.pathname);
}

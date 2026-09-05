// ether/astro — Astro-specific integration.
//
// `initSceneRouter(canvas, routes)` wires a persistent `<canvas>`
// (Astro `transition:persist`) to a `SceneManager` for the lifetime of
// the tab. Pass a route table of factories ({ '/': (renderer, quality)
// => scene, ... }); the router resolves the initial route from the
// address bar, and `astro:before-swap` drives scene transitions on
// client-side navigation — the manager and GL context survive every
// swap. Defensive teardown handles HMR/double-boot; real cleanup only
// on `beforeunload`.
export {
  initSceneRouter,
  type SceneFactory,
  type SceneRoutes,
  type InitSceneRouterOptions,
} from './router';

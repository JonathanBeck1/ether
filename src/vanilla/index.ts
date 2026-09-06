// ether/vanilla — plain Vite integration (no framework).
//
// `initSceneRouter(canvas, routes)` keeps one `SceneManager` on a
// persistent `<canvas>` and drives scene transitions from the History
// API: `popstate` for back/forward, `router.navigate()` for programmatic
// moves, `interceptLinks` for same-origin anchors. Your app owns the DOM
// it swaps; the engine owns the canvas.
export {
  initSceneRouter,
  type SceneFactory,
  type SceneRoutes,
  type VanillaRouter,
  type VanillaRouterOptions,
} from './router';

// aether/astro — Astro-specific integration.
//
// `initSceneRouter(canvas, sceneFactory)` wires a persistent `<canvas>`
// (Astro `transition:persist`) to a `SceneManager`. Pass a factory that
// receives the live renderer + resolved `QualityProfile` and returns
// your initial scene. Defensive teardown handles HMR + Astro view
// transitions; cleanup on `astro:before-swap` + `beforeunload`.
export {
  initSceneRouter,
  type SceneFactory,
  type InitSceneRouterOptions,
} from './router';

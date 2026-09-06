// ether/core — engine primitives.
//
// `SceneManager` owns the renderer + the rAF loop + per-route Scene
// lifecycle. `BaseScene` is the convenience base class implementing the
// `Scene` contract. Build your hero scene by extending `BaseScene` and
// overriding the lifecycle methods (`preload`, `enterTransition`,
// `tick`, `dispose`).
//
// `attachSceneManager` is the framework-agnostic persistent-canvas
// pattern — one manager per canvas for the lifetime of the tab. The
// framework adapters (`ether/astro`, `ether/vanilla`) are thin `bind`
// callbacks over it; write your own the same way.
export { SceneManager } from './SceneManager';
export { BaseScene, type BaseSceneOptions } from './BaseScene';
export type { Scene } from './types';
export {
  attachSceneManager,
  normalizeRoute,
  type Attachment,
  type AttachOptions,
  type SceneFactory,
  type SceneRoutes,
} from './attach';

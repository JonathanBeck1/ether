// ether/core — engine primitives.
//
// `SceneManager` owns the renderer + the rAF loop + per-route Scene
// lifecycle. `BaseScene` is the convenience base class implementing the
// `Scene` contract. Build your hero scene by extending `BaseScene` and
// overriding the lifecycle methods (`preload`, `enterTransition`,
// `tick`, `dispose`).
export { SceneManager } from './SceneManager';
export { BaseScene, type BaseSceneOptions } from './BaseScene';
export type { Scene } from './types';

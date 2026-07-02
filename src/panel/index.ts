// aether/panel — small IntersectionObserver-gated WebGL viewports for
// DOM-driven pages (the /web world's "control screens"). Independent of
// the persistent-canvas SceneManager: each panel owns a tiny renderer
// and renders only while visible, capped at two concurrent panels.
export {
  createPanel,
  type PanelHandle,
  type PanelScene,
  type PanelSceneFactory,
  type PanelOptions,
} from './Panel';

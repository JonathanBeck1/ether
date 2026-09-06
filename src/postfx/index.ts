// ether/postfx — postprocessing building blocks + composer presets.
//
// `createComposer(renderer, scene, camera, opts?)` is the one composer
// shape: render → your effects → (ACES when hdr) → (dither), fused into
// a single fullscreen pass. The presets are tunings of it:
//
//   createHeroComposer   dark scene, one bright accent — restrained LDR bloom
//   createNightComposer  emissive-heavy scene — hotter bloom, optional HDR/ACES
//   createLightComposer  pale ground — dither only (bloom would lift the field)
//
// `DitherEffect` is the 8x8-Bayer-seeded grain that kills gradient
// banding; every preset ends with it. `loadLUT` loads a `.cube`/`.3dl`
// grade for postprocessing's `LUT3DEffect`.
//
// Pass `multisampling: quality.msaaSamples` from `ether/quality` — the
// composer's targets are where edge AA actually happens once a composer
// runs.
export { DitherEffect } from './DitherEffect';
export { createComposer, type Composer, type ComposerOptions } from './composer';
export {
  createHeroComposer,
  createNightComposer,
  createLightComposer,
  type BloomComposer,
  type NightComposerOptions,
  type PresetOptions,
} from './heroComposer';
export { loadLUT } from './lut';

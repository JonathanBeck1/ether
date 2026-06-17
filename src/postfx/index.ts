// aether/postfx — postprocessing effects + composer presets.
//
// `DitherEffect` ships an 8x8 Bayer dither — the cheapest fix for the
// gradient banding that becomes visible in dark scenes (canvas is mostly
// near-black). Use as the last effect in any EffectPass to deband the
// composited output.
//
// `createHeroComposer(renderer, scene, camera, opts?)` returns the
// canonical TakeTwo bloom+dither composer. Tuned for dark premium hero
// scenes with one bright accent color. Skip on LOW tier, drop dither on
// MID. See heroComposer.ts for the rationale on bloom values.
export { DitherEffect } from './DitherEffect';
export {
  createHeroComposer,
  type HeroComposerOptions,
  type HeroComposer,
} from './heroComposer';

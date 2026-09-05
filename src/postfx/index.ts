// ether/postfx — postprocessing effects + composer presets.
//
// `DitherEffect` ships an 8x8 Bayer dither — the cheapest fix for the
// gradient banding that becomes visible in dark scenes (canvas is mostly
// near-black). Use as the last effect in any EffectPass to deband the
// composited output.
//
// `createHeroComposer(renderer, scene, camera, opts?)` returns the
// canonical bloom+dither composer. Tuned for dark premium hero
// scenes with one bright accent color. Runs on EVERY quality tier (the
// the glow is the look); tiers differ via the `multisampling`
// option, not by dropping passes. See heroComposer.ts for the rationale
// on bloom values.
export { DitherEffect } from './DitherEffect';
export {
  createHeroComposer,
  createNightComposer,
  type HeroComposerOptions,
  type HeroComposer,
} from './heroComposer';

import type * as THREE from 'three';
import { HalfFloatType } from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  KernelSize,
  ToneMappingEffect,
  ToneMappingMode,
  type Effect,
} from 'postprocessing';
import { DitherEffect } from './DitherEffect';

export interface HeroComposerOptions {
  /** Include the dither effect. It merges into the SAME fullscreen
   *  pass as bloom (a few ALU ops — effectively free) and kills the
   *  dark-gradient banding that reads as posterized color on OLED. */
  enableDither?: boolean;
  /** MSAA sample count for the composer's internal render targets
   *  (WebGL2). This is the antialiasing that actually reaches the
   *  screen — the renderer's context `antialias` flag is bypassed the
   *  moment passes render into textures. 0 disables. */
  multisampling?: number;
  /** HDR pipeline: half-float buffers + an ACES pass in the composer.
   *  Render-to-target bypasses the renderer's own tone mapping, so
   *  without this `toneMappingExposure` is a dead knob and highlights
   *  hard-clip at 1.0. With it, exposure works and emitters get a
   *  filmic shoulder. */
  hdr?: boolean;
}

export interface HeroComposer {
  composer: EffectComposer;
  bloom: BloomEffect;
  dither?: DitherEffect;
}

/**
 * Canonical TakeTwo hero postprocessing chain. Suitable for any dark
 * premium hero scene with a single bright accent color (the violet
 * text core, in TakeTwo's case).
 * Order: render → bloom → (optional dither).
 *
 * LDR composer (no frameBufferType: HalfFloatType) — values clip at 1.0
 * which keeps bloom restrained without needing a ToneMappingEffect.
 * Suggested wiring with the kit's quality module: pass
 * `{ enableDither: quality.enableDither, multisampling:
 * quality.msaaSamples }` — all tiers run the composer; the per-tier
 * differences live in the profile, not at call sites. Bloom is tuned
 * for "felt not seen" — if you need a different mood, write a second
 * preset rather than parameterising this one beyond recognition.
 */
export function createHeroComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: HeroComposerOptions = {},
): HeroComposer {
  const { enableDither = true, multisampling = 0 } = options;
  const composer = new EffectComposer(renderer, { multisampling });

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 0.06,             // very restrained — bloom should be sensed, not seen
    luminanceThreshold: 0.65,    // only the violet text core triggers it
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    kernelSize: KernelSize.MEDIUM,
  });

  const dither = enableDither ? new DitherEffect() : undefined;
  const effects: Effect[] = dither ? [bloom, dither] : [bloom];

  composer.addPass(new EffectPass(camera, ...effects));

  return { composer, bloom, dither };
}

/**
 * Night-city preset: same chain as the hero composer, tuned for scenes
 * whose light IS emissive geometry (neon signage, lit windows, lamp
 * heads). Bloom here is the halo those emitters physically need — the
 * hero preset's "felt not seen" tuning reads as dead neon in a scene
 * with hundreds of emitters against near-black.
 */
export function createNightComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: HeroComposerOptions = {},
): HeroComposer {
  const { enableDither = true, multisampling = 0, hdr = false } = options;
  const composer = new EffectComposer(
    renderer,
    hdr ? { multisampling, frameBufferType: HalfFloatType } : { multisampling },
  );

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 0.38,
    luminanceThreshold: 0.62,
    luminanceSmoothing: 0.25,
    mipmapBlur: true,
    kernelSize: KernelSize.LARGE,
  });

  const dither = enableDither ? new DitherEffect() : undefined;
  const effects: Effect[] = [bloom];
  if (hdr) effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
  if (dither) effects.push(dither);

  composer.addPass(new EffectPass(camera, ...effects));

  return { composer, bloom, dither };
}

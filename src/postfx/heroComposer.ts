import type * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  KernelSize,
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

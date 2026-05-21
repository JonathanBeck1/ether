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
  /** Include the dither pass. Off on MID-tier — bloom is cheaper. */
  enableDither?: boolean;
}

/**
 * Canonical TakeTwo hero postprocessing chain. Suitable for any dark
 * premium hero scene with a single bright accent color (the violet
 * text core, in TakeTwo's case).
 * Order: render → bloom → (optional dither).
 *
 * LDR composer (no frameBufferType: HalfFloatType) — values clip at 1.0
 * which keeps bloom restrained without needing a ToneMappingEffect.
 * Suggested wiring with the kit's quality module: skip this entirely
 * on LOW; pass `{ enableDither: false }` on MID; defaults on HIGH.
 * Bloom is tuned for "felt not seen" — if you need a different mood,
 * write a second preset rather than parameterising this one beyond
 * recognition.
 *
 * On LOW tier the caller skips this entirely (SceneManager falls back to
 * `renderer.render(scene, camera)` directly when `scene.composer` is
 * undefined). On MID we keep bloom but drop dither — dither's an
 * extra fullscreen pass and the LOW->MID transition is meaningful
 * enough without it.
 */
export function createHeroComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: HeroComposerOptions = {},
): EffectComposer {
  const { enableDither = true } = options;
  const composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 0.06,             // very restrained — bloom should be sensed, not seen
    luminanceThreshold: 0.65,    // only the violet text core triggers it
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    kernelSize: KernelSize.MEDIUM,
  });

  const effects: Effect[] = [bloom];
  if (enableDither) effects.push(new DitherEffect());

  composer.addPass(new EffectPass(camera, ...effects));

  return composer;
}

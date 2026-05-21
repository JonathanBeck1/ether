import type * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  KernelSize,
} from 'postprocessing';
import { DitherEffect } from './DitherEffect';

/**
 * Create the canonical TakeTwo postprocessing chain.
 * Order: render → bloom → dither.
 *
 * LDR composer (no frameBufferType: HalfFloatType) — values clip at 1.0
 * which keeps bloom restrained without needing a ToneMappingEffect.
 * Tuned per art-direction.md and slop-checklist.md.
 */
export function createHeroComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): EffectComposer {
  const composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 0.06,             // very restrained — bloom should be sensed, not seen
    luminanceThreshold: 0.65,    // only the violet text core triggers it
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    kernelSize: KernelSize.MEDIUM,
  });

  const dither = new DitherEffect();

  composer.addPass(new EffectPass(camera, bloom, dither));

  return composer;
}

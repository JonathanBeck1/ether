import type * as THREE from 'three';
import { BloomEffect, KernelSize } from 'postprocessing';
import { createComposer, type Composer } from './composer';

export interface PresetOptions {
  /** Include the dither effect — see `ComposerOptions.enableDither`. Default true. */
  enableDither?: boolean;
  /** Composer-target MSAA samples — see `ComposerOptions.multisampling`. Default 0. */
  multisampling?: number;
}

export interface NightComposerOptions extends PresetOptions {
  /** HDR pipeline (half-float + ACES) — see `ComposerOptions.hdr`. Default false. */
  hdr?: boolean;
}

export interface BloomComposer extends Composer {
  bloom: BloomEffect;
}

/**
 * Canonical hero postprocessing chain for a dark scene with a single
 * bright accent (luminous type, a lit mark).
 * Order: render → bloom → (optional dither).
 *
 * LDR by design — values clip at 1.0, which keeps bloom restrained
 * without a tone-mapping pass. Suggested wiring with the kit's quality
 * module: pass `{ enableDither: quality.enableDither, multisampling:
 * quality.msaaSamples }` — all tiers run the composer; the per-tier
 * differences live in the profile, not at call sites. Bloom is tuned
 * for "felt not seen" — if you need a different mood, write a second
 * preset on `createComposer` rather than parameterising this one
 * beyond recognition.
 */
export function createHeroComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: PresetOptions = {},
): BloomComposer {
  const bloom = new BloomEffect({
    intensity: 0.06,             // very restrained — bloom should be sensed, not seen
    luminanceThreshold: 0.65,    // only the bright accent core triggers it
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    kernelSize: KernelSize.MEDIUM,
  });
  return { ...createComposer(renderer, scene, camera, { ...options, effects: [bloom] }), bloom };
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
  options: NightComposerOptions = {},
): BloomComposer {
  const bloom = new BloomEffect({
    intensity: 0.38,
    luminanceThreshold: 0.62,
    luminanceSmoothing: 0.25,
    mipmapBlur: true,
    kernelSize: KernelSize.LARGE,
  });
  return { ...createComposer(renderer, scene, camera, { ...options, effects: [bloom] }), bloom };
}

/**
 * Light-ground preset: render → dither, nothing else. Bloom on a pale
 * field blooms the field — the whole frame lifts and the accent
 * disappears — so a light page's postprocessing is the deband alone
 * (pale gradients band too). Add a LUT via `createComposer` when the
 * grade needs it.
 */
export function createLightComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: PresetOptions = {},
): Composer {
  return createComposer(renderer, scene, camera, options);
}

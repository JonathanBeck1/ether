import type * as THREE from 'three';
import { HalfFloatType } from 'three';
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  type Effect,
} from 'postprocessing';
import { DitherEffect } from './DitherEffect';

export interface ComposerOptions {
  /** Your effects, in order. They merge with the ACES pass (`hdr`) and
   *  the dither into ONE fullscreen `EffectPass` — postprocessing fuses
   *  them into a single shader, so adding an effect costs ALU, not a
   *  render target. Default none. */
  effects?: Effect[];
  /** Include the dither effect. It merges into the SAME fullscreen
   *  pass as everything else (a few ALU ops — effectively free) and
   *  kills the dark-gradient banding that reads as posterized color on
   *  OLED. Default true. */
  enableDither?: boolean;
  /** MSAA sample count for the composer's internal render targets
   *  (WebGL2). This is the antialiasing that actually reaches the
   *  screen — the renderer's context `antialias` flag is bypassed the
   *  moment passes render into textures. 0 disables. Default 0. */
  multisampling?: number;
  /** HDR pipeline: half-float buffers + an ACES pass in the composer.
   *  Render-to-target bypasses the renderer's own tone mapping, so
   *  without this `toneMappingExposure` is a dead knob and highlights
   *  hard-clip at 1.0. With it, exposure works and emitters get a
   *  filmic shoulder. Default false — LDR clipping is bloom containment
   *  for the restrained presets. */
  hdr?: boolean;
}

export interface Composer {
  composer: EffectComposer;
  /** The effects you passed, in order — keep handles to tune them live. */
  effects: Effect[];
  dither?: DitherEffect;
}

/**
 * The composer every preset is built on: render → your effects →
 * (ACES when `hdr`) → (dither). One `RenderPass`, one `EffectPass`.
 * Reach for it when the presets' tuning is wrong for your scene; reach
 * for a preset when it isn't.
 */
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: ComposerOptions = {},
): Composer {
  const { effects = [], enableDither = true, multisampling = 0, hdr = false } = options;
  const composer = new EffectComposer(
    renderer,
    hdr ? { multisampling, frameBufferType: HalfFloatType } : { multisampling },
  );

  composer.addPass(new RenderPass(scene, camera));

  const dither = enableDither ? new DitherEffect() : undefined;
  const chain: Effect[] = [...effects];
  if (hdr) chain.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
  if (dither) chain.push(dither);
  if (chain.length > 0) composer.addPass(new EffectPass(camera, ...chain));

  return { composer, effects, dither };
}

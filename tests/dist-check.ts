// Consumes the BUILT declarations the way an npm install does — every
// sub-path, every public type — under skipLibCheck: false, so a broken
// emitted .d.ts fails here rather than in a consumer's project.
// `npm run test:dist` (after `npm run build`).
import type { Attachment, Scene, SceneManager, SceneRoutes } from '@jonathanbeck1/ether/core';
import type { InitSceneRouterOptions } from '@jonathanbeck1/ether/astro';
import type { VanillaRouter } from '@jonathanbeck1/ether/vanilla';
import type { QualityProfile, QualityTier } from '@jonathanbeck1/ether/quality';
import type { BloomComposer, Composer, ComposerOptions, PresetOptions } from '@jonathanbeck1/ether/postfx';
import type { ScrollBridgeOptions, ScrollProgressTrigger } from '@jonathanbeck1/ether/scroll';
import type { ExtrudedLetter } from '@jonathanbeck1/ether/text';
import type { MSDFText, MSDFTextOptions } from '@jonathanbeck1/ether/text/msdf';
import type { ShaderQuadOptions } from '@jonathanbeck1/ether/primitives';
import type { HDRResult, LoadGLTFOptions, Progress } from '@jonathanbeck1/ether/loaders';
import type { TweaksConfig, TweaksTheme } from '@jonathanbeck1/ether/dev';
import { initCardTilt } from '@jonathanbeck1/ether/interactions';
import { attachSceneManager, BaseScene, normalizeRoute } from '@jonathanbeck1/ether/core';
import { createComposer, createHeroComposer } from '@jonathanbeck1/ether/postfx';
import { createProgress, loadGLTF } from '@jonathanbeck1/ether/loaders';
import { msdfText } from '@jonathanbeck1/ether/text/msdf';
import { dither } from '@jonathanbeck1/ether/shaders';

class Probe extends BaseScene {
  async enterTransition() {}
  async exitTransition() {}
  tick() {}
}

// Type-level only: never executed, only compiled.
export async function shape(canvas: HTMLCanvasElement, routes: SceneRoutes, quality: QualityProfile) {
  const attachment: Attachment = await attachSceneManager(canvas, routes, { quality });
  const manager: SceneManager = attachment.manager;
  const scene: Scene = new Probe();
  const route: string = normalizeRoute('/work/');
  const composer: Composer = createComposer(manager.renderer, scene.scene, scene.camera, {
    enableDither: quality.enableDither,
  } satisfies ComposerOptions);
  const bloom: BloomComposer = createHeroComposer(manager.renderer, scene.scene, scene.camera, {
    multisampling: quality.msaaSamples,
  } satisfies PresetOptions);
  const progress: Progress = createProgress();
  const gltf = await loadGLTF('/model.glb', { progress, weight: 2 } satisfies LoadGLTFOptions);
  const text: MSDFText = await msdfText({ text: route, font: '/font.woff' } satisfies MSDFTextOptions);
  const tier: QualityTier = quality.tier;
  initCardTilt();
  const glsl: string = dither;
  return { composer, bloom, gltf, text, tier, glsl };
}

export type Surface = {
  astro: InitSceneRouterOptions;
  vanilla: VanillaRouter;
  scroll: [ScrollBridgeOptions, ScrollProgressTrigger];
  text: ExtrudedLetter;
  primitives: ShaderQuadOptions;
  loaders: HDRResult;
  dev: [TweaksConfig, TweaksTheme];
};

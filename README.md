# @taketwo/kit

TakeTwo's internal WebGL framework. **Not for public consumption — yet.**

Extracted from `clients/taketwo-media/site/` as patterns proved reusable.
Goal: when client #2 lands, `npm i @taketwo/kit` (or `file:../kit` in a
sibling repo) is a 6-month head start.

## Status

**All six extraction phases shipped.** The kit owns the engine; the site
owns the brand. Behavior between the site and the pre-extraction version
is byte-equivalent.

## Consumption

The site links the kit via `file:../kit` in its `package.json`:

```json
"@taketwo/kit": "file:../kit"
```

`npm install` symlinks `site/node_modules/@taketwo/kit → ../../../kit`.
The package exports raw `.ts` from `src/` — Vite compiles on demand.
**No build step required for local dev.**

Two Vite config knobs make the symlinked + raw-`.ts` consumption work
(see `site/astro.config.ts` for the why):

```ts
resolve: {
  // Kit imports e.g. `postprocessing` — without this, Vite resolves
  // those through kit's REAL path on disk and fails to find peer deps.
  preserveSymlinks: true,
},
optimizeDeps: {
  // Kit uses Vite-only `?raw` GLSL imports which esbuild's depscan
  // can't parse. Excluding skips pre-bundling and lets Vite's full
  // plugin pipeline handle each request.
  exclude: ['@taketwo/kit'],
},
```

## API surface (entry points)

Each sub-module is reached via its own entry point so bundlers
tree-shake reliably:

| Module | Exports | What it does |
|---|---|---|
| `@taketwo/kit/core` | `SceneManager`, `BaseScene`, `BaseSceneOptions`, `Scene` | Renderer + rAF loop + per-route scene lifecycle. Subclass `BaseScene` for your hero. |
| `@taketwo/kit/astro` | `initSceneRouter`, `SceneFactory`, `InitSceneRouterOptions` | Persistent-canvas Astro router with `transition:persist` teardown. Pass a scene factory; get a `SceneManager` back. |
| `@taketwo/kit/quality` | `detectQuality`, `getQuality`, `QualityProfile`, `QualityTier` | GPU tier detection (LOW/MID/HIGH) — DPR cap, MSAA on/off, composer on/off, smooth-scroll on/off. |
| `@taketwo/kit/postfx` | `DitherEffect`, `createHeroComposer`, `HeroComposerOptions` | 8×8 Bayer dither effect + the canonical bloom+dither composer preset (tuned for dark premium hero scenes). |
| `@taketwo/kit/text` | `extrudedWord`, `ExtrudedLetter`, `ExtrudedWordOptions`, `ExtrudeProfile` | opentype → SVGLoader → ExtrudeGeometry pipeline, returns per-letter geometries + canonical rest poses. Caller supplies material. |
| `@taketwo/kit/primitives` | `ShaderQuad`, `ShaderQuadOptions` | Fullscreen shader-plane with auto-wired `uTime` + `uAspect`. Build animated backdrops on it. |
| `@taketwo/kit/shaders` | `dither.glsl` (via `?raw`) | Reusable GLSL chunks consumed via Vite's `?raw` import. Files are the API. |
| `@taketwo/kit/interactions` | `initCardTilt` | Resn-style 3D card-tilt with snap-to-zero idle, fine-pointer gate, Astro view-transition rebind. |
| `@taketwo/kit/loaders` | (empty) | Reserved for KTX2 / Draco / GLB / HDR wrappers when the first GLB-consuming site lands. |
| `@taketwo/kit/scroll` | (empty) | Reserved for the Lenis ↔ GSAP ScrollTrigger bridge — currently inline in site code; lifts on next site. |

## Typical wiring

```ts
// site-level boot.ts
import { initSceneRouter } from '@taketwo/kit/astro';
import { HomeScene } from './scenes/home/HomeScene';

export function boot(canvas: HTMLCanvasElement) {
  return initSceneRouter(
    canvas,
    (renderer, quality) => new HomeScene(renderer, quality),
  );
}

// site-level HomeScene.ts
import { BaseScene } from '@taketwo/kit/core';
import type { QualityProfile } from '@taketwo/kit/quality';
import { createHeroComposer } from '@taketwo/kit/postfx';
import { ShaderQuad } from '@taketwo/kit/primitives';
import { extrudedWord } from '@taketwo/kit/text';

export class HomeScene extends BaseScene {
  constructor(renderer: THREE.WebGLRenderer, quality: QualityProfile) {
    super(); // BaseScene defaults match TakeTwo's first site
    this.composer = quality.enablePostFX
      ? createHeroComposer(renderer, this.scene, this.camera, { enableDither: quality.enableDither })
      : undefined;
    // ...
  }
  // override preload(), enterTransition(), tick(), dispose()
}

// Layout.astro — lazy-load behind requestIdleCallback
const canvas = document.getElementById('scene-canvas');
requestIdleCallback(
  () => import('../scene/boot').then(m => m.boot(canvas)),
  { timeout: 1500 },
);
```

## What NEVER moves into the kit

Brand-specific files stay in each site:

- `constants.ts` (brand palette, hero word, animation timings)
- Hero shaders (sculpture rim lighting, caustics hint mixing)
- Per-scene wiring (e.g. site's HeroDrift bespoke scatter, scroll-trigger
  selectors like `.projects`)
- The hero scene class itself (e.g. `HomeScene`) — it composes kit pieces

Kit provides the engine. Each site provides the art direction.

## What kit explicitly DOES NOT do

- **No new wrapper around three.js itself.** Three.js is the renderer;
  kit is connective tissue.
- **No reimplementation of existing libs.** Consume `postprocessing`,
  `troika-three-text` (when text wraps it), `lenis`, `detect-gpu`,
  `three/examples/jsm/loaders/*` via peer deps. Don't rewrite what npm
  already does well.
- **No R3F integration.** The site's renderer is imperative three; R3F
  would force a rewrite.
- **No editor / GUI layer.** Active Theory's Hydra GUI is a year of
  work for a team — solo, not worth it. Skip.

## Roadmap

Add as real needs surface, not speculatively:

- `kit/scroll` — Lenis ↔ GSAP bridge primitive (lift on site #2)
- `kit/text` — `troika-three-text` MSDF wrapper for crisp display type
- `kit/loaders` — `KTX2` / `Draco` / `GLB` wrapped loaders + branded
  progress UI
- `kit/postfx` — second preset(s) for non-dark briefs (editorial, light)
- `kit/transitions` — held-input / slam / shatter primitives (the
  scroll-stop interaction patterns)
- `kit/audio` — Howler wrapper + iOS unlock + mute toggle when a site
  ships with audio

When `@taketwo/kit` has been consumed by two paying client sites
unchanged, promote it to its own private GitHub repo and ship via
GitHub Packages. Until then, `file:../kit` keeps the round-trip instant.

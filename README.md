# aether

TakeTwo's internal WebGL framework. **Not for public consumption — yet.**

Extracted from `clients/taketwo-media/site/` as patterns proved reusable.
Goal: when client #2 lands, `npm i aether` (or `file:../kit` in a
sibling repo) is a 6-month head start.

## Status

**All six extraction phases shipped.** The kit owns the engine; the site
owns the brand. Behavior between the site and the pre-extraction version
is byte-equivalent.

## Consumption

The site links the kit via `file:../kit` in its `package.json`:

```json
"aether": "file:../kit"
```

`npm install` symlinks `site/node_modules/aether → ../../../kit`.
The package exports raw `.ts` from `src/` — Vite compiles on demand.
**No build step required for local dev.**

Two Vite config knobs make the symlinked + raw-`.ts` consumption work
(see `site/astro.config.ts` for the why):

```ts
resolve: {
  // Force single instances of the kit's peer deps (the site's copies).
  // Deliberately NOT preserveSymlinks — that pinned the kit at its
  // node_modules path, which Vite ignores for file-watching, so kit
  // edits were served stale in dev (no HMR).
  dedupe: ['three', 'postprocessing', 'opentype.js', 'detect-gpu', 'gsap', 'lenis'],
},
optimizeDeps: {
  // Kit uses Vite-only `?raw` GLSL imports which esbuild's depscan
  // can't parse. Excluding skips pre-bundling and lets Vite's full
  // plugin pipeline handle each request.
  exclude: ['aether'],
},
```

## API surface (entry points)

Each sub-module is reached via its own entry point so bundlers
tree-shake reliably:

| Module | Exports | What it does |
|---|---|---|
| `aether/core` | `SceneManager`, `BaseScene`, `BaseSceneOptions`, `Scene` | Renderer + rAF loop + per-route scene lifecycle. Subclass `BaseScene` for your hero. |
| `aether/astro` | `initSceneRouter`, `SceneFactory`, `SceneRoutes`, `InitSceneRouterOptions` | Persistent-canvas Astro router. Pass a routes map (`{ '/': factory, '/web': factory }`); it resolves the initial route from the address bar and drives scene transitions on `astro:before-swap` — the manager and GL context survive every swap (teardown only on `beforeunload`). Every internal page must have a registered scene: an unknown route keeps the previous scene rendering (and its scroll coupling) across the swap. |
| `aether/quality` | `detectQuality`, `getQuality`, `QualityProfile`, `QualityTier` | GPU tier detection (LOW/MID/HIGH) — DPR cap, composer-target MSAA samples (`msaaSamples` — the AA that actually reaches the screen; the context `antialias` flag is dead once a composer runs), dither (all tiers — it's free and kills OLED banding), smooth-scroll on/off. |
| `aether/postfx` | `DitherEffect`, `createHeroComposer`, `HeroComposerOptions` | 8×8 Bayer dither effect + the canonical bloom+dither composer preset (tuned for dark premium hero scenes). Pass `multisampling: quality.msaaSamples` for real edge AA on the composer's render targets (WebGL2). |
| `aether/text` | `extrudedWord`, `ExtrudedLetter`, `ExtrudedWordOptions`, `ExtrudeProfile` | opentype → SVGLoader → ExtrudeGeometry pipeline, returns per-letter geometries + canonical rest poses. Caller supplies material. |
| `aether/primitives` | `ShaderQuad`, `ShaderQuadOptions` | Fullscreen shader-plane with auto-wired `uTime` + `uAspect`. Build animated backdrops on it. |
| `aether/shaders` | `dither.glsl` (via `?raw`) | Reusable GLSL chunks consumed via Vite's `?raw` import. Files are the API. |
| `aether/interactions` | `initCardTilt` | Resn-style 3D card-tilt with snap-to-zero idle, fine-pointer gate, Astro view-transition rebind. |
| `aether/loaders` | (empty) | Reserved for KTX2 / Draco / GLB / HDR wrappers when the first GLB-consuming site lands. |
| `aether/scroll` | `ScrollBridge`, `ScrollBridgeOptions`, `createScrollProgress`, `ScrollProgressOptions`, `ScrollProgressTrigger` | Lenis ↔ GSAP ScrollTrigger bridge: a lifecycle wrapper (brand-tuned Lenis options, the `ScrollTrigger.update` wiring, idempotent plugin registration, s→ms raf) + a scroll-progress→callback trigger factory. Construct the bridge only when smooth scroll is enabled. |

## Typical wiring

```ts
// site-level boot.ts
import { initSceneRouter } from 'aether/astro';
import { HomeScene } from './scenes/home/HomeScene';
import { WebScene } from './scenes/web/WebScene';

export function boot(canvas: HTMLCanvasElement) {
  // All routes register up front — a new page's own scripts run after
  // the swap, too late to register the factory the transition needs.
  // Navigation is a scene transition (exit → dispose → preload →
  // enter), never a manager teardown.
  return initSceneRouter(canvas, {
    '/': (renderer, quality) => new HomeScene(renderer, quality),
    '/web': (renderer, quality) => new WebScene(renderer, quality),
  });
}

// site-level HomeScene.ts
import { BaseScene } from 'aether/core';
import type { QualityProfile } from 'aether/quality';
import { createHeroComposer } from 'aether/postfx';
import { ShaderQuad } from 'aether/primitives';
import { extrudedWord } from 'aether/text';

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
- **No full editor / scene-graph GUI.** Active Theory's Hydra is a year
  of team work — not worth it solo. The kit DOES ship a lightweight,
  `?tweak`-gated live-parameter panel (`aether/dev` → `Tweaks`) for
  art-direction: bind uniforms/effects, tune live, export a paste-ready
  `constants.ts` block. A tweak panel, not a Hydra.

## Roadmap

Add as real needs surface, not speculatively:

- `kit/text` — `troika-three-text` MSDF wrapper for crisp display type
- `kit/loaders` — `KTX2` / `Draco` / `GLB` wrapped loaders + branded
  progress UI
- `kit/postfx` — second preset(s) for non-dark briefs (editorial, light)
- `kit/transitions` — held-input / slam / shatter primitives (the
  scroll-stop interaction patterns)
- `kit/audio` — Howler wrapper + iOS unlock + mute toggle when a site
  ships with audio

When `aether` has been consumed by two paying client sites
unchanged, promote it to its own private GitHub repo and ship via
GitHub Packages. Until then, `file:../kit` keeps the round-trip instant.

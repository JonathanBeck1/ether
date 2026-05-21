# @taketwo/kit

TakeTwo's internal WebGL framework. **Not for public consumption — yet.**

Extracted from `clients/taketwo-media/site/` as patterns prove reusable.
Goal: when client #2 lands, `npm i @taketwo/kit` gets a 6-month head start.

## Status

**Phase 1 — scaffolded.** No code migrated yet. The site does not import
from this package. Empty barrels per sub-module.

## Consumption

The site links this package via `file:../kit` in its `package.json`:

```json
"@taketwo/kit": "file:../kit"
```

`npm install` symlinks `site/node_modules/@taketwo/kit -> ../../../kit`.
The package exports raw `.ts` from `src/` — Vite compiles on demand. No
build step required for local dev.

## Sub-module map

Each sub-module is reached via its own entry point so bundlers tree-shake
reliably:

| Module | Will hold | Sourced from |
|---|---|---|
| `@taketwo/kit/core` | `BaseScene`, `SceneManager`, `Scene` contract | `site/src/scene/{BaseScene,SceneManager,types}.ts` |
| `@taketwo/kit/astro` | Persistent-canvas router with `transition:persist` teardown | `site/src/scene/router.ts` |
| `@taketwo/kit/postfx` | Composer presets (hero, editorial) | `site/src/scene/scenes/home/HeroPostprocessing.ts` |
| `@taketwo/kit/postfx` (effects) | `DitherEffect` | `site/src/scene/scenes/home/DitherEffect.ts` |
| `@taketwo/kit/shaders` | GLSL chunks (`dither`, future `noise`, `fresnel`, `fbm`) | `site/src/shaders/dither.glsl` |
| `@taketwo/kit/quality` | `QualityProfile` + `detectQuality()` | `site/src/scene/quality.ts` |
| `@taketwo/kit/scroll` | Lenis ↔ GSAP ScrollTrigger bridge | inline in `HomeScene.ts` (lines 114-122) |
| `@taketwo/kit/text` | `extrudedWord()` opentype → ExtrudeGeometry helper; future MSDF wrapper | `site/src/scene/scenes/home/HeroSculpture.ts` (lines 69-189) |
| `@taketwo/kit/primitives` | `ShaderQuad` fullscreen-quad helper, `Disposables`, single-rAF `Ticker` | inline in `HeroCaustics.ts` (lines 30-75) |
| `@taketwo/kit/loaders` | KTX2 / Draco / GLB / HDR wrapped loaders w/ progress | — (deferred until first GLB consumer) |
| `@taketwo/kit/interactions` | `cardTilt` (snap-to-zero, fine-pointer gate, view-transition rebind) | `site/src/scripts/projectTilt.ts` |

## Migration plan

Six phases. Site stays live throughout — each phase is one PR-shaped step.

1. **Scaffold workspace** ✅ (this commit) — no code moved
2. **Pure leaves**: `dither.glsl`, `DitherEffect`, `projectTilt` (zero coupling)
3. **`BaseScene` + `SceneManager` + `router` as a unit** (they're inseparable)
4. **Extract `createComposer` as `heroPreset()`**
5. **Extract `extrudedWord()`** from HeroSculpture (site keeps its bespoke shader)
6. **`ShaderQuad` primitive** — refactor `HeroCaustics` on top

After Phase 6, kit can ship to a second client untouched.

## What NEVER moves

Brand-specific files stay in `site/`:

- `src/scene/constants.ts` (TAKETWO word, brand palette, drift ranges)
- `src/scene/scenes/home/HeroDrift.ts` (bespoke per-letter scatter)
- `src/shaders/hero/sculpture.{vert,frag}.glsl` (brand-tinted rim)
- `src/shaders/hero/caustics.frag.glsl` hint mixing (brand-coded)
- All section-name scroll-trigger wiring in `HomeScene.setupScrollTrigger`

Kit provides the engine. Each site provides the art direction.

## What kit explicitly DOES NOT do

- **No new wrapper around three.js itself.** Three.js is the renderer; kit
  is connective tissue.
- **No reimplementation of existing libs.** Consume `postprocessing`,
  `troika-three-text`, `lenis`, `detect-gpu`, `three/examples/jsm/loaders/*`
  via peer deps. Don't rewrite what npm already does well.
- **No R3F integration.** The site's renderer is imperative three; R3F
  would force a rewrite.
- **No editor / GUI layer.** Active Theory's Hydra GUI is a year of work
  for a team — solo, not worth it. Skip.

# ether

A small WebGL engine for premium Astro sites. One persistent `<canvas>` that
survives client-side navigation, GPU-tier quality detection, a Lenis ↔ GSAP
ScrollTrigger bridge, a bloom + dither postprocessing preset, an
opentype → ExtrudeGeometry pipeline for dimensional type, and a live
tweaks panel for art direction.

The engine owns the plumbing. Your site owns the art direction — palette,
shaders, hero word, choreography. Nothing in here knows what your brand
looks like.

Extracted from the production site of a design studio, where it runs
today. See [Provenance](#provenance).

## Requirements

- A **Vite-based bundler** (Astro, or Vite directly). The package ships raw
  `.ts` from `src/` and uses Vite's `?raw` import for GLSL — there is no
  build step and no plain-Node entry point.
- `three ^0.184`, `postprocessing ^6.39` (peer dependencies).
- Optional peers, pulled in only by the modules that need them: `lenis`
  and `gsap` (`ether/scroll`), `detect-gpu` (`ether/quality`),
  `opentype.js` (`ether/text`).

## Install

As a sibling folder (fastest inner loop — Vite watches and HMRs kit edits
like first-party code):

```json
"ether": "file:../ether"
```

Or straight from git:

```bash
npm i github:JonathanBeck1/ether
```

Two Vite knobs make raw-`.ts` consumption work:

```ts
// astro.config.ts (or vite.config.ts)
vite: {
  resolve: {
    // One instance of each peer, resolved from YOUR node_modules —
    // whether the kit is symlinked or installed.
    dedupe: ['three', 'postprocessing', 'opentype.js', 'detect-gpu', 'gsap', 'lenis'],
  },
  optimizeDeps: {
    // The kit's `?raw` GLSL imports are Vite-only; esbuild's dep scan
    // can't parse them. Excluding routes every kit file through Vite's
    // full plugin pipeline instead of pre-bundling.
    exclude: ['ether'],
  },
},
```

Do not set `resolve.preserveSymlinks` for the `file:` layout — it pins the
kit at its `node_modules` path, which Vite does not watch, so edits are
served stale.

## Module map

The root export is deliberately empty. Import from sub-paths so bundlers
tree-shake reliably:

| Module | Exports | What it does |
|---|---|---|
| `ether/core` | `SceneManager`, `BaseScene`, `BaseSceneOptions`, `Scene` | Renderer + rAF loop + per-route scene lifecycle (preload → enter → tick → exit → dispose). Subclass `BaseScene` for your hero. |
| `ether/astro` | `initSceneRouter`, `SceneFactory`, `SceneRoutes`, `InitSceneRouterOptions` | Persistent-canvas router. Pass a routes map; it resolves the initial route from the address bar and drives scene transitions on `astro:before-swap`. The manager and GL context live for the lifetime of the tab. Register a scene for every route (`'*'` is the fallback). |
| `ether/quality` | `detectQuality`, `getQuality`, `QualityProfile`, `QualityTier` | One-shot GPU tier (LOW / MID / HIGH) via `detect-gpu`, folded into the knobs the engine can toggle cheaply: DPR cap, composer MSAA samples, dither, smooth scroll, reduced-motion. |
| `ether/postfx` | `DitherEffect`, `createHeroComposer`, `createNightComposer`, `HeroComposerOptions`, `HeroComposer` | 8×8 Bayer dither (kills OLED banding on dark gradients) + two composer presets: a restrained LDR bloom for a dark scene with one bright accent, and a hotter HDR/ACES variant for emissive-heavy scenes. Pass `multisampling: quality.msaaSamples` — the composer's targets are where edge AA actually happens. |
| `ether/scroll` | `ScrollBridge`, `ScrollBridgeOptions`, `createScrollProgress`, `ScrollProgressOptions`, `ScrollProgressTrigger` | Lenis ↔ ScrollTrigger bridge that owns the three things a site shouldn't: plugin registration, `lenis.on('scroll', ScrollTrigger.update)`, and the seconds → ms `raf` conversion. Plus a scroll-progress → callback trigger factory. Construct the bridge only on tiers that enable smooth scroll. |
| `ether/text` | `extrudedWord`, `ExtrudedLetter`, `ExtrudedWordOptions`, `ExtrudeProfile` | opentype.js → SVG path → `SVGLoader` (glyph holes handled) → beveled `ExtrudeGeometry`, per letter, with canonical rest poses. You supply the material. |
| `ether/primitives` | `ShaderQuad`, `ShaderQuadOptions` | Fullscreen shader plane with `uTime` + `uAspect` wired. Backdrops live here. |
| `ether/interactions` | `initCardTilt` | Pointer-driven 3D card tilt with snap-to-rest idle, fine-pointer gate, and view-transition rebind. |
| `ether/shaders` | `dither.glsl` (via `?raw`) | Reusable GLSL chunks. Files are the API. |
| `ether/dev` | `Stats`, `Tweaks`, `TweaksConfig`, `TweaksTheme`, `GroupConfig`, descriptor types | URL-gated diagnostics: a perf overlay (FPS / ms / tier / DPR / composer) and a live-parameter panel — sliders, colors, toggles, selects, intervals, vectors, monitors; undo/redo; URL + localStorage persistence; named presets; export as a paste-ready constants block. Both ship zero bytes until mounted. |

## Wiring

```ts
// boot.ts — imported lazily from your layout behind requestIdleCallback
import { initSceneRouter } from 'ether/astro';
import { HeroScene } from './scenes/HeroScene';
import { CalmScene } from './scenes/CalmScene';

export function boot(canvas: HTMLCanvasElement) {
  // Every route registers up front: a new page's own scripts run after
  // the swap, too late to register the factory the transition needs.
  return initSceneRouter(canvas, {
    '/': (renderer, quality) => new HeroScene(renderer, quality),
    '/work': (renderer, quality) => new CalmScene(renderer, quality),
    '*': (renderer, quality) => new CalmScene(renderer, quality),
  });
}
```

```ts
// scenes/HeroScene.ts
import * as THREE from 'three';
import { BaseScene } from 'ether/core';
import type { QualityProfile } from 'ether/quality';
import { createHeroComposer } from 'ether/postfx';
import { extrudedWord } from 'ether/text';

export class HeroScene extends BaseScene {
  constructor(renderer: THREE.WebGLRenderer, quality: QualityProfile) {
    super(); // fov 50, near 0.1, far 100, camera at z = 4 — override via options
    this.composer = createHeroComposer(renderer, this.scene, this.camera, {
      enableDither: quality.enableDither,
      multisampling: quality.msaaSamples,
    }).composer;
  }

  async preload() {
    const letters = await extrudedWord('HELLO', '/fonts/display.ttf', { targetCapHeight: 1 });
    for (const l of letters) {
      const mesh = new THREE.Mesh(l.geometry, this.material);
      mesh.position.copy(l.assembledPosition);
      mesh.scale.setScalar(l.assembledScale);
      this.scene.add(mesh);
    }
  }
  // enterTransition(), tick(time, delta), exitTransition(), dispose()
}
```

```ts
// A live tweaks panel, mounted only when the URL carries ?tweak
import { Tweaks } from 'ether/dev';

const panel = new Tweaks({
  storageKey: 'mysite:tweaks:home',
  title: 'TWEAKS',
  theme: { primary: '#6e9fff', swatches: ['#6e9fff', '#9bd8ff'] },
});
panel.group('Bloom', { accent: '#6e9fff' }).addSlider({
  path: 'bloomIntensity',
  min: 0, max: 1, step: 0.01,
  get: () => bloom.intensity,
  set: (v) => { bloom.intensity = v; },
  default: 0.06,
  export: { constant: 'BLOOM_INTENSITY', shape: 'number' },
});
panel.mount();
```

## What stays in your site

The engine never learns your brand. These belong to each site:

- `constants.ts` — palette, hero word, timings.
- Hero shaders — the material identity.
- Per-scene choreography and DOM-bound scroll triggers.
- The hero scene class itself — it composes kit pieces.

## What the kit deliberately does not do

- **No wrapper around three.js.** three.js is the renderer; the kit is
  connective tissue.
- **No reimplementation of libraries.** `postprocessing`, `lenis`,
  `detect-gpu`, `three/examples/jsm/loaders/*` are consumed as peers.
- **No React Three Fiber.** The renderer is imperative three.
- **No scene-graph editor.** The tweaks panel binds parameters you
  declare; it is not an authoring tool.

## Development

```bash
npm install
npm run typecheck   # tsc over src + tests
npm test            # vitest over the pure modules
```

## Provenance

Extracted from the private monorepo behind
[TakeTwo Media's site](https://taketwo-media.vercel.app), where the engine
runs in production (built May–September 2026). That monorepo stays the
working home; this repository is a filtered mirror of its `kit/` folder,
published with a deterministic `git filter-repo` split. The commits are the
real ones; their messages are reduced to the subject line because the bodies
narrate the private site the engine was built for.

## License

MIT — see [LICENSE](./LICENSE).

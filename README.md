# ether

A WebGL engine for premium Astro sites, built on three.js. It owns the layer
a studio site needs above the renderer — one persistent `<canvas>` that
survives client-side navigation, GPU-tier quality detection, a Lenis ↔ GSAP
ScrollTrigger bridge, a bloom + dither postprocessing preset, an
opentype → ExtrudeGeometry pipeline for dimensional type, and a live tweaks
panel for art direction — and nothing three.js already does. No renderer of
its own, no asset pipeline, no physics, no editor: deliberate omissions, not
gaps.

The engine owns the plumbing. Your site owns the art direction — palette,
shaders, hero word, choreography. Nothing in here knows what your brand
looks like.

Extracted from the production site of a design studio, where it runs
today. See [Provenance](#provenance).

## Requirements

- A browser bundler. The npm package is plain ESM + `.d.ts` and works
  with any of them; the git / `file:` install ships raw `.ts` and needs a
  **Vite-based** one (Astro, or Vite directly) for its `?raw` GLSL
  imports. There is no plain-Node entry point — the engine lives in a
  page.
- `three ^0.184`, `postprocessing ^6.39` (peer dependencies).
- Optional peers, pulled in only by the modules that need them: `lenis`
  and `gsap` (`ether/scroll`), `detect-gpu` (`ether/quality`),
  `opentype.js` (`ether/text`), `troika-three-text` (`ether/text/msdf`).

## Install

From npm — built ESM + types, import from `@jonathanbeck1/ether/<module>`:

```bash
npm i @jonathanbeck1/ether three postprocessing
```

```ts
import { initSceneRouter } from '@jonathanbeck1/ether/astro';
```

Or as raw `.ts`, which the rest of this README uses under the package
name `ether` — a sibling folder is the fastest inner loop (Vite watches
and HMRs kit edits like first-party code):

```json
"ether": "file:../ether"
```

Or straight from git:

```bash
npm i github:JonathanBeck1/ether
```

Two Vite knobs make raw-`.ts` consumption work (the npm build needs
neither):

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
| `ether/core` | `SceneManager`, `BaseScene`, `BaseSceneOptions`, `Scene`, `attachSceneManager`, `Attachment`, `AttachOptions`, `SceneFactory`, `SceneRoutes`, `normalizeRoute` | Renderer + rAF loop + per-route scene lifecycle (preload → enter → tick → exit → dispose). Subclass `BaseScene` for your hero. `attachSceneManager` is the framework-agnostic persistent-canvas pattern — one manager per canvas for the lifetime of the tab, single-flight guarded, with a `bind` hook where a framework adapter wires its navigation events. |
| `ether/astro` | `initSceneRouter`, `InitSceneRouterOptions` | Persistent-canvas router for Astro. Pass a routes map; it resolves the initial route from the address bar and drives scene transitions on `astro:before-swap`. The manager and GL context live for the lifetime of the tab. Register a scene for every route (`'*'` is the fallback). |
| `ether/vanilla` | `initSceneRouter`, `VanillaRouter`, `VanillaRouterOptions` | The same pattern for plain Vite sites: `popstate` drives back/forward, `router.navigate()` drives programmatic moves, `interceptLinks` opts same-origin anchors in. Your app swaps the DOM it owns; the engine swaps scenes. |
| `ether/quality` | `detectQuality`, `getQuality`, `QualityProfile`, `QualityTier` | One-shot GPU tier (LOW / MID / HIGH) via `detect-gpu`, folded into the knobs the engine can toggle cheaply: DPR cap, composer MSAA samples, dither, smooth scroll, reduced-motion. |
| `ether/postfx` | `createComposer`, `Composer`, `ComposerOptions`, `createHeroComposer`, `createNightComposer`, `createLightComposer`, `BloomComposer`, `PresetOptions`, `NightComposerOptions`, `DitherEffect`, `loadLUT` | One composer shape — render → your effects → (ACES when `hdr`) → dither, fused into a single fullscreen pass — and three tunings of it: restrained LDR bloom for a dark scene with one bright accent, hotter HDR/ACES bloom for emissive-heavy scenes, dither-only for pale grounds. `loadLUT` loads a `.cube`/`.3dl` grade for postprocessing's `LUT3DEffect`. Pass `multisampling: quality.msaaSamples` — the composer's targets are where edge AA actually happens. |
| `ether/scroll` | `ScrollBridge`, `ScrollBridgeOptions`, `createScrollProgress`, `ScrollProgressOptions`, `ScrollProgressTrigger` | Lenis ↔ ScrollTrigger bridge that owns the three things a site shouldn't: plugin registration, `lenis.on('scroll', ScrollTrigger.update)`, and the seconds → ms `raf` conversion. Plus a scroll-progress → callback trigger factory. Construct the bridge only on tiers that enable smooth scroll. |
| `ether/text` | `extrudedWord`, `ExtrudedLetter`, `ExtrudedWordOptions`, `ExtrudeProfile` | Type as form: opentype.js → SVG path → `SVGLoader` (glyph holes handled) → beveled `ExtrudeGeometry`, per letter, with canonical rest poses. You supply the material. |
| `ether/text/msdf` | `msdfText`, `MSDFText`, `MSDFTextOptions` | Type as text: an MSDF mesh via `troika-three-text`, resolved once its atlas is ready — crisp at any distance. Its own entry so the optional peer is only pulled in by sites that import it. Serve your own font file; no CDN fallback. |
| `ether/loaders` | `createProgress`, `Progress`, `loadGLTF`, `loadTexture`, `loadHDR`, option types | Promise wrappers over three's `GLTFLoader` (+ Draco / KTX2 when you serve the decoders), `TextureLoader`, and `RGBELoader` (+ PMREM env map), all feeding one weighted progress value. No asset pipeline — compress offline, load here. |
| `ether/primitives` | `ShaderQuad`, `ShaderQuadOptions` | Fullscreen shader plane with `uTime` + `uAspect` wired. Backdrops live here. |
| `ether/interactions` | `initCardTilt` | Pointer-driven 3D card tilt with snap-to-rest idle, fine-pointer gate, and view-transition rebind. |
| `ether/shaders` | `dither` (string), `dither.glsl` (via `?raw`) | Reusable GLSL chunks — each file is also exported as a named string, so they compose into your shader sources from any bundler. |
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
// Plain Vite, no framework: same routes, History-API navigation.
import { initSceneRouter } from 'ether/vanilla';

const router = await initSceneRouter(canvas, routes, { interceptLinks: true });
router.navigate('/work'); // pushState + scene transition
```

Another framework? Both adapters are a dozen lines over
`attachSceneManager` from `ether/core` — pass a `bind` that turns your
router's navigation event into `attachment.transitionTo(pathname)`.

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

## Stability

1.0 means the sub-path exports in the module map are the public API and
follow semver: a breaking change to any of them is a major. Not the API:
file paths under `src/`, the chunk layout of the npm build, and the
`__sceneManager` tag on the canvas (read it in tests; don't build on
it). Deprecations ship with a console warning for at least one minor
before removal. Peer ranges widen in minors when the peer's release is
non-breaking for how the kit uses it. See [CHANGELOG](./CHANGELOG.md).

## Development

```bash
npm install
npm run typecheck      # tsc over src + tests
npm test               # vitest over the pure modules
npm run test:e2e       # Playwright over a plain-Vite fixture: the persistent-canvas guarantees
npm run build          # dist/: Vite ESM per module + tsc declarations + the npm package.json
npm run test:dist      # consume the built .d.ts under skipLibCheck: false; npm pack --dry-run
npm run test:e2e:dist  # the e2e suite again, fixture aliased to dist/
```

Publishing is `npm publish ./dist --access public` from a logged-in
account, after the build and both dist checks are green.

The e2e suite (`tests/e2e`) is the engine's contract in executable form:
one manager per canvas across boots, one render loop, scene swaps that
dispose the outgoing scene and reuse the GL context, History-API
navigation, the `'*'` fallback, resize propagation, and a clean detach.
It runs on every CI push (`npx playwright install chromium` first,
locally).

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

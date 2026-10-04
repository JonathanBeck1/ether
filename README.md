# ether

[![CI](https://github.com/JonathanBeck1/ether/actions/workflows/ci.yml/badge.svg)](https://github.com/JonathanBeck1/ether/actions/workflows/ci.yml)
[![npm: coming soon](https://img.shields.io/badge/npm-coming%20soon-555)](#install)

A WebGL engine for premium Astro sites, built on three.js. It owns the layer
a studio site needs above the renderer — one persistent `<canvas>` that
survives client-side navigation (Astro or plain Vite), so the renderer and
its GL context are built once per tab and never per page; GPU-tier quality
detection, one LOW / MID / HIGH reading of the device taken at boot; a
Lenis ↔ GSAP ScrollTrigger bridge; composable bloom / dither / LUT
postprocessing; loaders with one progress value; extruded and MSDF type;
and a live tweaks panel for art direction — and nothing three.js
already does. No renderer of its own, no asset pipeline, no physics, no
editor: deliberate omissions, not gaps.

The engine owns the plumbing. Your site owns the art direction — palette,
shaders, hero word, choreography. Nothing in here knows what your brand
looks like.

Every WebGL studio site rebuilds that plumbing, and the expensive bugs
live there, not in the art. A renderer built per page pays for a new GL
context on every navigation. A re-boot that misses one piece of teardown
leaves two render loops drawing into one canvas, which reads as ghosted,
jittering geometry. Smooth scroll needs Lenis, ScrollTrigger and the
render loop wired to each other. ether is that layer, written once and
held to an executable contract (see [Development](#development)).

Why it is shaped this way — the persistent canvas, LDR bloom, dither on
every tier, exit-before-swap (the outgoing scene's exit runs before the
framework replaces the DOM, not after) — is written up in
[docs/design-notes.md](https://github.com/JonathanBeck1/ether/blob/master/docs/design-notes.md).
See also [Provenance](#provenance).

Extracted from the production site of a design studio, where it runs
today: [taketwo-media.vercel.app](https://taketwo-media.vercel.app). The
frames below are that site, captured from the live build — the extruded
mark at rest after the intro, then mid-way through its scroll-driven
dispersal. The header and the scroll cue are DOM; the mark and the
backdrop are the scene.

![The TakeTwo hero at rest: the extruded mark with its iridescent rim over the caustics backdrop](https://raw.githubusercontent.com/JonathanBeck1/ether/master/docs/hero-rest.jpg)

![The same mark mid-scroll: letters tumbling out of formation](https://raw.githubusercontent.com/JonathanBeck1/ether/master/docs/hero-mid.jpg)

## Requirements

- A browser bundler. The npm package is plain ESM + `.d.ts` and works
  with any of them; the git / `file:` install ships raw `.ts` and needs a
  **Vite-based** one (Astro, or Vite directly) for its `?raw` GLSL
  imports. There is no plain-Node entry point — the engine lives in a
  page — but importing any entry on the server (Astro frontmatter, a
  SvelteKit component) is safe: the engine does nothing until a page
  attaches.
- `three`, `postprocessing` and `detect-gpu` as peer dependencies, in
  the ranges under [Compatibility](#compatibility). `ether/core` resolves
  the quality tier on attach, so `detect-gpu` is required even by
  consumers that never import `ether/quality` directly.
- Optional peers, pulled in only by the modules that need them: `lenis`
  and `gsap` (`ether/scroll`), `opentype.js` (`ether/text`),
  `troika-three-text` (`ether/text/msdf`).
- `@types/three` matching your `three`, as a dev dependency. The git /
  `file:` install typechecks the kit's own `.ts` sources as part of your
  project, and they import three's types.

### Compatibility

Declared is what `package.json` enforces (`peerDependencies`, `engines`).
Tested is the exact version the lockfiles pin, on Node 24 and Chromium.
This repository's CI runs the kit's unit and e2e suites over a plain-Vite
fixture, against the sources and the built package. The "(site)"
versions come from the production site that consumes the kit, which is
built, typechecked and smoke-tested on each CI run of the private
monorepo this repository is mirrored from (see [Provenance](#provenance)).

| | 1.0.0 | 1.1.0 and Unreleased | Tested |
|---|---|---|---|
| `three` | `^0.184.0` | `^0.184.0` | 0.184.0 |
| `postprocessing` | `^6.39.0` | `^6.39.0` | 6.39.4 (kit), 6.39.1 (site) |
| `detect-gpu` | `^5.0.0` (optional) | `^5.0.0` | 5.0.70 |
| `gsap` (optional) | `^3.15.0` | `^3.15.0` | 3.15.0 |
| `lenis` (optional) | `^1.3.0` | `^1.3.0` | 1.3.26 (kit), 1.3.23 (site) |
| `opentype.js` (optional) | `^1.3.0` | `^1.3.0` | 1.3.4 |
| `troika-three-text` (optional) | `^0.52.0` | `^0.52.0` | 0.52.5 (kit only) |
| Node | `>=22.12.0` | `>=24.0.0` | 24 |
| Vite | not declared | not declared | 8.2.2 (kit fixture), 7.3.2 (site, via Astro) |
| Astro | not declared | not declared | 6.1.10 (site) |

1.1.0 made `detect-gpu` required and raised the Node floor to 24. Node
only runs the toolchain (install, build, tests); the engine itself runs
in the browser. A version outside the Tested column may work, but
nothing here has run it.

## Install

Straight from git — raw `.ts`, which the rest of this README uses under
the package name `ether`:

```bash
npm i github:JonathanBeck1/ether three@0.184 postprocessing detect-gpu
```

Pin `three`: npm otherwise resolves the newest release, which is outside
the `^0.184` peer range, and every `npm i` after that fails with
`ERESOLVE`.

Or as a sibling folder — the fastest inner loop (Vite watches and HMRs
kit edits like first-party code):

```json
"ether": "file:../ether"
```

The npm package — built ESM + types, imported from
`@jonathanbeck1/ether/<module>` — is not published yet. `npm run build`
produces it; the install will be:

```bash
npm i @jonathanbeck1/ether three@0.184 postprocessing detect-gpu
```

```ts
import { initSceneRouter } from '@jonathanbeck1/ether/astro';
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

Those same `?raw` imports need Vite's ambient types on your side, or `tsc`
reports them as untyped modules. Add the directive once, in any `.d.ts`
your `tsconfig` already includes:

```ts
/// <reference types="vite/client" />
```

Do not set `resolve.preserveSymlinks` for the `file:` layout — it pins the
kit at its `node_modules` path, which Vite does not watch, so edits are
served stale.

## Module map

The root export is deliberately empty. Import from sub-paths so bundlers
tree-shake reliably:

| Module | Exports | What it does |
|---|---|---|
| `ether/core` | `SceneManager`, `BaseScene`, `BaseSceneOptions`, `Scene`, `RuntimeDiagnostics`, `attachSceneManager`, `Attachment`, `AttachOptions`, `SceneFactory`, `SceneRoutes`, `normalizeRoute` | Renderer + rAF loop + per-route scene lifecycle (preload → enter → tick → exit → dispose). Subclass `BaseScene` for your hero. `attachSceneManager` is the framework-agnostic persistent-canvas pattern — one manager per canvas for the lifetime of the tab, single-flight guarded, with a `bind` hook where a framework adapter wires its navigation events. `manager.getDiagnostics()` returns a JSON-safe snapshot of what the runtime is actually doing: scene lifecycle, frame rate, whole-frame draw counts, GPU resource counts, applied DPR and the composer actually running. |
| `ether/astro` | `initSceneRouter`, `InitSceneRouterOptions` | Persistent-canvas router for Astro. Pass a routes map; it resolves the initial route from the address bar and drives scene transitions on `astro:before-swap`. The manager and GL context live for the lifetime of the tab. Register a scene for every route (`'*'` is the fallback). |
| `ether/vanilla` | `initSceneRouter`, `VanillaRouter`, `VanillaRouterOptions`, `SceneFactory`, `SceneRoutes` | The same pattern for plain Vite sites: `popstate` drives back/forward, `router.navigate()` drives programmatic moves, `interceptLinks` opts same-origin anchors in. Your app swaps the DOM it owns; the engine swaps scenes. |
| `ether/quality` | `detectQuality`, `configureQuality`, `getQuality`, `QualityOptions`, `QualityProfile`, `QualityTier` | One-shot GPU tier (LOW / MID / HIGH) via `detect-gpu`, folded into the knobs the engine can toggle cheaply: DPR cap, composer MSAA samples, smooth scroll, reduced-motion. `configureQuality` (before the first detect) points the probe at self-hosted benchmark tables and caps how long it may take. |
| `ether/postfx` | `createComposer`, `Composer`, `ComposerOptions`, `createHeroComposer`, `createNightComposer`, `createLightComposer`, `BloomComposer`, `PresetOptions`, `NightComposerOptions`, `DitherEffect`, `loadLUT` | One composer shape — render → your effects → (ACES when `hdr`) → dither, fused into a single fullscreen pass — and three tunings of it: restrained LDR bloom for a dark scene with one bright accent, hotter HDR/ACES bloom for emissive-heavy scenes, dither-only for pale grounds. `loadLUT` loads a `.cube`/`.3dl` grade for postprocessing's `LUT3DEffect`, and rejects on an HTTP error or a file that is not a LUT (an SPA fallback page, say). Pass `multisampling: quality.msaaSamples` — the composer's targets are where edge AA actually happens. |
| `ether/scroll` | `ScrollBridge`, `ScrollBridgeOptions`, `createScrollProgress`, `ScrollProgressOptions`, `ScrollProgressTrigger` | Lenis ↔ ScrollTrigger bridge that owns the three things a site shouldn't: plugin registration, `lenis.on('scroll', ScrollTrigger.update)`, and the seconds → ms `raf` conversion. Plus a scroll-progress → callback trigger factory. Construct the bridge only when the quality profile enables smooth scroll (never under reduced motion). |
| `ether/text` | `extrudedWord`, `ExtrudedLetter`, `ExtrudedWordOptions`, `ExtrudeProfile` | Type as form: opentype.js → SVG path → `SVGLoader` (glyph holes handled) → beveled `ExtrudeGeometry`, per letter, with canonical rest poses. You supply the material. |
| `ether/text/msdf` | `msdfText`, `MSDFText`, `MSDFTextOptions` | Type as text: an MSDF mesh via `troika-three-text`, resolved once its atlas is ready — crisp at any distance. Its own entry so the optional peer is only pulled in by sites that import it. Serve your own `.ttf`, `.otf` or `.woff` — the URL is preflighted and its first bytes checked, so an unreachable URL, a woff2 (troika cannot parse one) or an HTML page served in its place rejects instead of hanging. Characters your font does not cover still fall back to troika's unicode-font-resolver, whose data comes from jsDelivr: set `unicodeFontsURL` to your own copy, or keep the text inside the font's coverage. If the atlas is not ready within `timeoutMs` (default 10000), most often because that fallback fetch is blocked, the call rejects naming the font. |
| `ether/loaders` | `createProgress`, `Progress`, `loadGLTF`, `loadTexture`, `loadHDR`, option types | Promise wrappers over three's `GLTFLoader` (+ Draco / KTX2 when you serve the decoders), `TextureLoader`, and `RGBELoader` (+ PMREM env map), all feeding one weighted progress value. Register every load with `progress.track` before awaiting the first, so the total is known up front. No asset pipeline — compress offline, load here. |
| `ether/primitives` | `ShaderQuad`, `ShaderQuadOptions` | Fullscreen shader plane with `uTime` + `uAspect` wired. `aspect` (default 1) seeds `uAspect` for the frames before the first `resize()`, which owns it from then on — set it when the quad is built outside a live manager. Backdrops live here. |
| `ether/interactions` | `initCardTilt` | Pointer-driven 3D card tilt with snap-to-rest idle, fine-pointer gate, and view-transition rebind. Returns its teardown — call it on unmount. |
| `ether/shaders` | `dither` (string), `dither.glsl` (via `?raw`) | Reusable GLSL chunks — each file is also exported as a named string, so they compose into your shader sources from any bundler. |
| `ether/dev` | `Stats`, `Tweaks`, `TweaksConfig`, `TweaksTheme`, `GroupConfig`, `ExportSection`, descriptor types | URL-gated dev overlays: a perf overlay (FPS / ms / tier / DPR / composer) and a live-parameter panel — sliders, colors, toggles, selects, intervals, vectors, monitors; undo/redo; URL + localStorage persistence; named presets; export as a paste-ready constants block. `exportSections` banners that block and fixes the emit order (constants matching no section trail in one unbannered block); `exportPromotionBanner` heads the constants a control flagged `needsPromotion`. Both ship zero bytes until dynamically imported. |

## Wiring

In Astro, the canvas lives in the layout, outside any page, and
`transition:persist` carries it — and its GL context — across
`<ClientRouter />` navigations:

```astro
---
// layouts/Layout.astro
import { ClientRouter } from 'astro:transitions';
---
<html lang="en">
  <head>
    <ClientRouter />
  </head>
  <body>
    <canvas id="scene" transition:persist aria-hidden="true"></canvas>
    <slot />
    <script>
      // Bundled module script: it runs once, not on every navigation.
      const canvas = document.querySelector<HTMLCanvasElement>('#scene');
      if (canvas) {
        const start = () => import('../boot').then((m) => m.boot(canvas));
        if ('requestIdleCallback' in window) requestIdleCallback(start);
        else setTimeout(start);
      }
    </script>
  </body>
</html>
```

Size the canvas in CSS (a fixed, full-viewport box). The engine sizes its
drawing buffer to the canvas's CSS box and never writes inline styles.
Browsers without View Transitions still navigate client-side under
`<ClientRouter />`'s default `fallback="animate"`, so the canvas
persists the same way. Only `fallback="none"` turns navigations into
full page loads, where each page boots a fresh manager: slower but
correct.

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
import { initSceneRouter, type SceneRoutes } from 'ether/vanilla';
import { HeroScene } from './scenes/HeroScene';
import { CalmScene } from './scenes/CalmScene';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const routes: SceneRoutes = {
  '/': (renderer, quality) => new HeroScene(renderer, quality),
  '*': (renderer, quality) => new CalmScene(renderer, quality),
};

const router = await initSceneRouter(canvas, routes, { interceptLinks: true });
router.navigate('/work'); // pushState + scene transition
```

`interceptLinks` leaves same-page `#hash` links to the browser so they
still scroll; `rel="external"` opts any other anchor out of the router.

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
  // Stand-in. Your material is the art direction; the kit has no opinion.
  private readonly material = new THREE.MeshStandardMaterial({ color: '#c8d0ff' });

  constructor(renderer: THREE.WebGLRenderer, quality: QualityProfile) {
    super(); // fov 50, near 0.1, far 100, camera at z = 4 — override via options
    this.track(this.material);
    this.composer = createHeroComposer(renderer, this.scene, this.camera, {
      enableDither: quality.enableDither,
      multisampling: quality.msaaSamples,
    }).composer;
  }

  async preload() {
    const letters = await extrudedWord('HELLO', '/fonts/display.ttf', { targetCapHeight: 1 });
    for (const l of letters) {
      const mesh = new THREE.Mesh(this.track(l.geometry), this.material);
      mesh.position.copy(l.assembledPosition);
      mesh.scale.setScalar(l.assembledScale);
      this.scene.add(mesh);
    }
  }

  // The three abstract members. enterTransition is not awaited; see Disposal.
  async enterTransition() {}
  async exitTransition() {}

  tick(time: number, _deltaTime: number) {
    this.scene.rotation.y = Math.sin(time * 0.2) * 0.05;
  }

  // dispose() is inherited — it drains everything passed to this.track().
}
```

```ts
// A live tweaks panel, mounted only when the URL carries ?tweak
const { Tweaks } = await import('ether/dev');

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

### Routing and scene lifecycle

Routes are pathnames, trailing slash ignored (`/work/` and `/work` are
one route). The initial route comes from the address bar on attach;
after that the adapter turns each navigation into `transitionTo(pathname)`
— `astro:before-swap` with its destination URL, or `popstate` and
`router.navigate()` in plain Vite. A pathname resolves to its own
factory, else `'*'`; with neither, the live scene stays.

A hop runs in this order:

1. The outgoing scene's `exitTransition()`, awaited. Under `ether/astro`,
   when no hop is in flight, it is called inside the `astro:before-swap`
   dispatch, so everything before its first `await` runs before Astro
   replaces the DOM. A navigation queued behind a running hop exits
   after the swap.
2. The outgoing scene's `dispose()`.
3. The factory builds the next scene, sized to the canvas, and its
   `preload()` is awaited.
4. The scene goes live and its `enterTransition()` starts. It is not
   awaited; a navigation mid-intro exits and disposes the scene anyway.
5. From the next frame, `tick(time, deltaTime)` runs every frame, in
   seconds. `onResize(width, height)` runs whenever the canvas box
   settles on a new size, including once before `preload()`.

Navigations that land during a hop are latest-wins: the queue settles on
the last one. A same-route navigation is a no-op unless forced, and
`ether/astro` forces every swap, because Astro replaces the body even on
a same-path click and the live scene's triggers would hold dead nodes.
A scene that implements `retarget(route)` is kept alive, not rebuilt,
across routes whose factory is the same function. `renders = false`
keeps a scene ticking without drawing, for routes where opaque DOM
covers the canvas. A hop that throws disposes whichever scene it holds and
forgets the route, so navigating back to one that worked still works; the
failure is counted in the diagnostics.

### Disposal

On a hop the manager calls the outgoing scene's `dispose()` and nothing
else; it never walks your scene graph. `BaseScene.dispose()` disposes
everything passed to `this.track()` (geometries, materials, textures,
render targets, anything with a `dispose()`), then `this.composer`.
Everything else the scene started is yours to stop. Override
`dispose()`, release it, and call `super.dispose()`:

- DOM and window listeners;
- GSAP tweens and timelines, the intro included: enter is not awaited,
  so its timeline can outlive the scene;
- ScrollTriggers. Kill them in `exitTransition()`, before its first
  `await`, so they let go before the DOM swap;
- the `ScrollBridge`. `destroy()` it in exit or dispose, and build it at
  the start of `enterTransition()`, never in the constructor: Lenis takes
  wheel input from construction but only moves the page once `tick`
  pumps its `raf`, so a constructor-built bridge swallows scrolling for
  the whole of `preload()`.

The renderer and GL context outlive every scene. `attachment.detach()`
(the vanilla router's `destroy()`) disposes the live scene and the
renderer, unbinds navigation and frees the canvas. It does not force
context loss, so a later attach on the same canvas reuses the context.

### Quality

`detectQuality()` probes the GPU once with `detect-gpu` and maps its
tier: 0 → LOW; 1 → LOW when the primary input cannot hover, else MID;
2 → MID; 3 → HIGH. A probe that throws reads LOW; one that outlasts
`timeoutMs` (default 1500) counts as tier 1. Reduced motion leaves the
tier alone. The probe is cached in flight, so concurrent and later
callers share one probe and one profile: `configureQuality()` only
counts before the first call, and `getQuality()` reads the result
synchronously (null until it resolves). Attaching awaits the profile
before the renderer exists, since MSAA cannot change on a live context,
and writes the tier to `<body data-gpu-tier>` for CSS. Pass `quality` to
`initSceneRouter` or `attachSceneManager` to skip the probe in tests or
force a tier for QA.

| Knob | LOW | MID | HIGH | Applied by |
|---|---|---|---|---|
| `dprCap` | 1.5 | 1.5 | 2 | the manager: `min(devicePixelRatio, dprCap)` |
| `msaaSamples` | 0 | 2 | 4 | your scene, as the composer's `multisampling` |
| `enableSmoothScroll` | false | true (false under reduced motion) | true (false under reduced motion) | your scene: build a `ScrollBridge` only when true |
| `enablePostFX`, `enableDither` | true | true | true | your scene: build the composer, pass `enableDither` |
| `antialias` | false | false | false | the manager: context MSAA, dead under a composer |

`reducedMotion` mirrors the media query for your scene to honor; the
engine uses it only to turn smooth scroll off. LOW also asks the browser for a
`low-power` GL context.

### Runtime diagnostics

`manager.getDiagnostics()` reports what the runtime is actually doing
(the live scene and hop phase, the DPR applied, the composer actually
running, whole-frame draw counts), separately from what the quality
profile asked for. It is pull-only and JSON-safe: the same snapshot for
a person in devtools, a CI job or a Playwright test. Field meanings are
documented on the `RuntimeDiagnostics` type.

In app code, reach the manager through what booted it: `ether/astro`'s
`initSceneRouter` resolves to it, `ether/vanilla`'s router carries it as
`router.manager`, and `attachSceneManager` as `attachment.manager`. From
a test or the console, use the canvas tag. It appears only once the
engine has booted, so poll for it:

```js
// Playwright: wait until /work is live and its intro has settled
await page.waitForFunction((route) => {
  const d = document.querySelector('#scene')?.__sceneManager?.getDiagnostics();
  return d?.scene.phase === 'active' && d.scene.entered && d.scene.route === route;
}, '/work');
const d = await page.evaluate(() => document.querySelector('#scene').__sceneManager.getDiagnostics());
```

Poll rather than awaiting navigation. A `transitionTo` queued behind a
hop resolves before its scene is live, and so does `attachSceneManager`
itself.

- `quality` is intent; `scene`, `rendering` and `postFX` are observed.
  `quality.enablePostFX` is true on every tier, while `postFX.enabled`
  says whether the live scene has a composer.
- `renderCalls` counts `renderer.render()` calls in the last tick (one
  per composer pass, bloom mip passes included, plus any renders in your
  scene's `tick`); `drawCalls`/`triangles` total the GL draws across all
  of them, shadow maps included. `textures` include composer render
  targets, so baseline leak checks per scene across repeated hops, not
  against zero.
- Under software GL (headless CI), assert bounds, never thresholds:
  `fps` finite and > 0, `cpuMs` finite and >= 0 (it is coarse and can
  read 0). Read them at least 600 ms after settling: both are null until
  a 500 ms window closes, and again after any stall over 1 s, such as a
  shader compile.

After each manager frame, `renderer.info.render.calls`/`triangles` hold
the whole frame's totals. If you set `info.autoReset = false` yourself,
the manager never resets it.

## What stays in your site

The line: ether owns what is the same on every site and reports what it
is doing. Your site owns what makes it yours, and decides what those
reports mean.

Ether owns:

- the renderer, the GL context and the one rAF loop;
- the route → scene lifecycle (exit → dispose → construct → preload →
  activate → enter) and its latest-wins queue;
- the quality reading taken at boot, and the DPR it applies;
- resize, context loss and teardown;
- the runtime snapshot (`manager.getDiagnostics()`): what is live, what
  was drawn, what is allocated.

These belong to each site:

- `constants.ts` — palette, hero word, timings.
- Hero shaders — the material identity.
- Per-scene choreography and DOM-bound scroll triggers.
- The hero scene class itself — it composes kit pieces.
- Budgets and thresholds. An acceptable frame rate, draw-call count or
  texture count depends on your art direction and your target devices,
  not on the engine.
- Scene identity beyond the route: names and modes. The snapshot
  identifies scenes by route, `'*'` fallback and a serial id.
- Scroll state and the choice of postprocessing preset. Both live in
  your scene, so the snapshot does not report them.
- A page-level handle to the manager, if your app code needs one. The
  canvas tag is for tests and devtools.

## What the kit deliberately does not do

- **No wrapper around three.js.** three.js is the renderer; the kit is
  connective tissue.
- **No reimplementation of libraries.** `postprocessing`, `lenis`,
  `detect-gpu`, `three/examples/jsm/loaders/*` are consumed as peers.
- **No React Three Fiber.** The renderer is imperative three.
- **No scene-graph editor.** The tweaks panel binds parameters you
  declare; it is not an authoring tool.
- **No verdicts.** The snapshot has no budgets, no warnings and no
  overlay. Judge the numbers in your tests or your own tooling.

## Stability

1.0 means the sub-path exports in the module map are the public API and
follow semver: a breaking change to any of them is a major.
`getDiagnostics()` and `RuntimeDiagnostics` are public API under semver:
fields are added in minors; a removal, rename or change of meaning is a
major. Not the API: file paths under `src/`, the chunk layout of the npm
build, and the `__sceneManager` tag on the canvas (read it in tests and
devtools, e.g. `getDiagnostics()`; don't build app code on it).
Deprecations ship with a console warning for at least one minor
before removal. Peer ranges widen in minors when the peer's release is
non-breaking for how the kit uses it. See [CHANGELOG](./CHANGELOG.md).

## Development

```bash
npm install
npx playwright install chromium   # once: the browser the e2e suite drives
npm run typecheck      # tsc over src + tests
npm test               # vitest over the pure modules
npm run test:e2e       # Playwright over a plain-Vite fixture: the persistent-canvas guarantees
npm run build          # dist/: Vite ESM per module + tsc declarations + the npm package.json
npm run test:dist      # consume the built .d.ts under skipLibCheck: false; import every entry in plain Node; npm pack --dry-run
npm run test:e2e:dist  # the e2e suite again, fixture aliased to dist/
```

Publishing is `npm publish ./dist --access public` from a logged-in
account, after the build and both dist checks are green.

The e2e suite (`tests/e2e`) is the engine's contract in executable form:
one manager per canvas across boots, one render loop, scene swaps that
dispose the outgoing scene and reuse the GL context, History-API
navigation, the `'*'` fallback, resize propagation, the runtime
snapshot's phases and counts under real hops, a clean detach, and an
engine that keeps rendering through a `beforeunload` the page outlives
(a `mailto:` link, a cancelled leave prompt). It runs on every CI push,
against the sources and again against the built package.

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

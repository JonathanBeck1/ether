# Changelog

Notable changes to ether. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-09-15

The first release after the engine went through four adversarial reviews
of every module, with a test pinning each fix.

### Fixed

- `ether/core`: a transition that throws no longer kills navigation for
  the tab. A rejected `exitTransition()` disposes the outgoing scene
  instead of leaving it live and ticking, and a factory or `preload()`
  that throws clears the current route, so the consumer can navigate
  straight back to the one that worked.
- `ether/core`: a resize that lands while the incoming scene is inside
  `preload()` now reaches that scene once it goes live. No scene was
  active to take it, and the resize handler's same-size short-circuit
  then suppressed every later correction.
- `ether/core`: a failed `attachSceneManager` no longer poisons the
  canvas — the cached init is cleared when it rejects, so a boot that
  lost its WebGL context or its quality detection can be retried.
- `ether/core`: a re-attach honors the documented contract. Only an
  in-flight init is shared; an attach that lands after one tears the
  previous attachment down and replaces it, so HMR and double boots pick
  up the new route table and the displaced attachment reports
  `isCurrent()` false. A canvas whose manager was destroyed on its own
  (`SceneManager.destroy()` — all the Astro adapter hands back) attaches
  fresh instead of returning the destroyed one.
- `ether/core`: the composer is resized with `updateStyle` false, like the
  renderer already was. postprocessing forwards `setSize` to
  `renderer.setSize`, which defaults that flag on and wrote inline width /
  height styles onto a canvas the engine promises to leave to CSS.
- `ether/vanilla`: `interceptLinks` leaves same-page `#hash` links to the
  browser so they still scroll to the fragment, and skips anchors marked
  `rel="external"`.
- `DitherEffect` no longer injects an uncalled Bayer chunk into every
  fused pass; the composed shader is otherwise unchanged.
- `ether/loaders`: `loadHDR().dispose()` disposes the PMREM render target
  and the generator. Disposing only the target's texture freed nothing, so
  the half-float cubeUV target leaked on every route change.
- `ether/loaders`: `createProgress().value` reaches exactly 1 by counting
  what is outstanding. Fractional weights left it at 0.9999999999999998.
- `ether/loaders`: `loadGLTF` caches its KTX2 decoder per renderer, not per
  transcoder path. After a detach and re-attach, later loads transcoded
  against the previous GL context's format support.
- `ether/text`: `extrudedWord` flips glyphs with a rotation instead of a
  mirror, so triangle winding — and the normals computed from it — stay
  outward. A lit `FrontSide` material showed the letter's interior.
- `ether/text/msdf`: `msdfText` preflights the font URL and rejects with a
  clear error. troika's loader only logs a failed fetch, so an unreachable
  font left the promise pending forever.
- `ether/text/msdf`: new `unicodeFontsURL` option — characters your font
  does not cover route to unicode-font-resolver, which reaches for jsDelivr
  by default. The "no CDN fallback" claim now holds only if you set this.
- `ether/interactions`: `initCardTilt` returns its teardown, so a consumer
  has an unmount path.
- `ether/scroll`: `ScrollBridge.scrollTo` takes Lenis's own options type
  rather than a hand-written `{ immediate }`.
- The GPU probe no longer hangs boot on an untimed unpkg fetch whose
  failure detect-gpu swallowed as tier 1, making `HIGH` unreachable.
- `detectQuality()` caches the in-flight probe, not just its result, so
  concurrent callers share one GPU probe.
- `ether/dev` type-checks in a raw-`.ts` consumer — `ColorControl`
  references the `EyeDropper` shim instead of relying on a tsconfig sweep.
- A control's `reset()` opens a gesture, so it is undoable and the next
  undo no longer consumes the edit before it.
- Docs: the `default` descriptor field describes the baseline the code
  captures, `Stats` takes a routes map, and the Tweaks sample imports
  dynamically as the claim above it says.

- `ether/postfx`: `DitherEffect` applies its noise through the sRGB
  transfer, one output step peak to peak at every luminance. Added in
  linear light, the same amount was several steps once encoded in the
  darks, which read as a shimmering grain over a dark field.
- `ether/core`: a transition that throws no longer drops the navigation
  queued behind it; the loop drains, a scene built before `preload()`
  threw is disposed, and a throwing `dispose()` runs once.
- `ether/core`: an attach that displaces a previous attachment runs the
  previous adapter's unbind before destroying its manager.
- `ether/text/msdf`: the font preflight falls back on any non-ok HEAD
  through a plain GET aborted at the response head, so strict hosts and
  cross-origin fonts are not rejected by a preflighted Range request.
- `ether/text`: `extrudedWord` skips characters the font does not cover
  instead of extruding the notdef box.
- `ether/dev`: a cancelled gesture no longer poisons the undo stack; a
  `?tweak` link carrying no registered keys falls through to stored
  state; restored values must match their default's shape; shorthand hex
  expands instead of becoming black; every pointer-capture path handles
  `pointercancel`; a held arrow key produces one undo entry; pointer-lock
  exit is scoped to the control; Escape closes an open select from its
  list, with the ARIA state kept; preset-row listeners and the copy-flash
  timer no longer leak.

### Changed

- `detect-gpu` is a required peer dependency: attaching a manager
  resolves the tier, so every `ether/core` consumer needs it.
- `configureQuality({ benchmarksURL, timeoutMs })` points the probe at
  benchmark tables you serve and bounds how long it may take.
- `ShaderQuad` seeds `uAspect` from an `aspect` option (default 1)
  instead of `window.inner*`; `resize()` owns it from the first frame.
- The constants-block export takes its banners from `TweaksConfig`
  (`exportSections`, `exportPromotionBanner`); with none, one sorted block.
- The panel injects no `@font-face` unless `monoFontSources` names URLs.

### Added

- `ether/dev`: the vector pad is reachable and adjustable by keyboard.
- Tests: unit coverage for quality detection, the constants exporter,
  panel theming, the transition state machine, attach, MSDF preflight and
  extrusion orientation; the e2e suite covers every README guarantee for
  core, vanilla and loaders, indexes scenes relative to captured counts,
  and asserts which build it is testing.

## [1.0.0] — 2026-09-06

The first release a second consumer can install and build a site with,
without reading the monorepo the engine was extracted from.

### Added

- `ether/core`: `attachSceneManager` — the framework-agnostic
  persistent-canvas pattern (single-flight guard, defensive teardown,
  quality resolution, one wrapper per factory, a `bind` hook for
  navigation events). `normalizeRoute` lives here now.
- `ether/vanilla`: History-API router for plain Vite sites — `popstate`,
  `navigate()`, opt-in `interceptLinks`, `destroy()`.
- `ether/postfx`: `createComposer`, the building block every preset is a
  tuning of; `createLightComposer` for pale grounds; `loadLUT` for
  `.cube` / `.3dl` grades.
- `ether/loaders`: `createProgress` weighted progress bus; `loadGLTF`
  (Draco / KTX2 with consumer-served decoders), `loadTexture`, `loadHDR`
  (PMREM environment).
- `ether/text/msdf`: `msdfText` via the optional peer `troika-three-text`
  — its own entry, so `ether/text` never pulls the peer into a site that
  only extrudes.
- Distribution: built ESM + `.d.ts` for npm as `@jonathanbeck1/ether`. The
  git / `file:` install keeps shipping raw `.ts` for Vite consumers.
- Tests: a Playwright suite over a plain-Vite fixture asserts the
  engine's guarantees — one manager per canvas across boots, one render
  loop, dispose-on-swap with the GL context reused, popstate, the `'*'`
  fallback, resize propagation, detach + re-attach, loaders, MSDF — and
  runs against both the sources and the built package.

### Changed

- `HeroComposer` → `BloomComposer`; `HeroComposerOptions` →
  `PresetOptions`, plus `NightComposerOptions` for the one preset that
  takes `hdr`. `createHeroComposer` / `createNightComposer` behave
  exactly as before.
- `ether/astro` `initSceneRouter` is a thin adapter over
  `attachSceneManager`; behavior unchanged.

## [0.1.0] — 2026-09-05

Extracted from the TakeTwo Media monorepo as `ether`: `core`, `astro`,
`quality`, `postfx`, `scroll`, `text`, `primitives`, `interactions`,
`shaders`, `dev`.

# Changelog

Notable changes to ether. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-09-06

The first release a second consumer can install from npm and build a
site with, without reading the monorepo the engine was extracted from.

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
- Distribution: built ESM + `.d.ts` on npm as `@jonathanbeck1/ether`. The
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

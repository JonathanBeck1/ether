# Design notes

Why the engine is shaped the way it is. Each note names the file where
the decision lives; the comments there carry the detail and, often, the
bug that taught it.

**One canvas, one manager, for the life of the tab.**
[`src/core/attach.ts`](../src/core/attach.ts), [`src/core/SceneManager.ts`](../src/core/SceneManager.ts).
Navigation is a scene transition, never a manager teardown; the
`WebGLRenderer` and its GL context are created once. Two render loops on
one canvas present as ghost-doubled geometry and frame-to-frame jitter,
which is why attaching tears down any prior manager first and why boots
are single-flight: quality detection is async, so two overlapping boot
calls would both pass the teardown check. The manager is tagged on the
canvas element rather than module state so it survives HMR module churn.

**Quality is decided before the renderer exists.**
[`src/quality/quality.ts`](../src/quality/quality.ts).
You cannot change MSAA on a live WebGL context, so the GPU tier is
resolved once and the renderer is built from it. Three tiers, chosen for
what the engine can toggle cheaply: DPR cap, composer MSAA, dither,
smooth scroll. Reduced motion downgrades exactly one tier; the else-if
matters, because two sequential ifs once took HIGH to LOW in one pass.

**Edge anti-aliasing comes from the composer, not the context.**
[`src/quality/quality.ts`](../src/quality/quality.ts), [`src/postfx/composer.ts`](../src/postfx/composer.ts).
Post-processing renders into textures that bypass the canvas framebuffer,
so the context `antialias` flag is visually dead the moment a composer
runs. Real edge AA is `multisampling` on the composer's targets, which
tile-based mobile GPUs resolve nearly for free.

**Dither runs on every tier.**
[`src/postfx/DitherEffect.ts`](../src/postfx/DitherEffect.ts), [`src/shaders/dither.glsl`](../src/shaders/dither.glsl).
It merges into the same fullscreen pass as everything else: a few ALU
ops. Without it, dark gradients band, and on mobile OLED the
posterization reads as wrong colors. An earlier note called it the most
expensive pass after bloom; that was measured wrong and retired.

**The hero preset is LDR on purpose. The night preset can be HDR.**
[`src/postfx/heroComposer.ts`](../src/postfx/heroComposer.ts), [`src/postfx/composer.ts`](../src/postfx/composer.ts).
Values clipping at 1.0 is bloom containment without a tone-mapping pass,
and 0.06 is the hero intensity ceiling: bloom should be sensed, not
seen. Scenes whose light is emissive geometry need the halo, so the
night preset runs hotter and can switch to half-float buffers plus ACES,
which also turns `toneMappingExposure` into a live knob. Bloom on a pale
ground blooms the ground, so the light preset is dither alone.

**Exit runs before the DOM swaps.**
[`src/astro/router.ts`](../src/astro/router.ts), [`src/core/types.ts`](../src/core/types.ts).
The Astro adapter listens to `astro:before-swap`, not after: the
outgoing scene's `exitTransition` runs synchronously up to its first
`await`, so ScrollTriggers and the Lenis bridge detach before Astro
mutates the DOM and resets scroll. Same-route navigations are forced
through a real exit and enter, because Astro full-swaps the body even
for a same-path click and the live scene would otherwise hold triggers
on detached nodes.

**Hop order is exit, dispose, construct, preload, enter. Latest wins.**
[`src/core/SceneManager.ts`](../src/core/SceneManager.ts).
Exit runs first so scene resource lifetimes are strictly disjoint. Enter
is not awaited, so a navigation during a long intro interrupts it
through `dispose`. Rapid A to B to A converges on the last route. A scene
that implements `retarget` and resolves to the same factory stays alive
across a route change and plays its own continuous transition; that is
why the attach layer registers one wrapper per unique factory, so the
same-factory comparison can ever match.

**The canvas box is the truth. Never write inline sizes.**
[`src/core/SceneManager.ts`](../src/core/SceneManager.ts).
`setSize(w, h, false)` because the stylesheet owns the box. The default
pinned an inline pixel height, so the iOS URL bar collapsing grew the
viewport while the canvas stayed boot-sized, leaving a permanent black
band and a resize observer watching a box that could no longer change.
Resizes are debounced 150 ms to coalesce the bar's bounce, and a scene
constructed mid-session seeds its aspect from the canvas box, not from
`window.inner*`.

**Context loss is a state, not a crash.**
[`src/core/SceneManager.ts`](../src/core/SceneManager.ts).
iOS Safari drops WebGL contexts under memory pressure. The loss handler
calls `preventDefault` so restore can fire, flags `data-webgl-lost` on
the body for a CSS fallback, and keeps ticking scenes while skipping GPU
calls, because the scene tick also pumps the scroll bridge and skipping
it turned a blank canvas into an unscrollable page.

**Optional peers get their own entries.**
[`package.json`](../package.json), [`src/text/msdf/`](../src/text/msdf/index.ts).
A barrel that re-exports a module importing an optional peer drags that
peer into every consumer of the barrel. `ether/text` extrudes;
`ether/text/msdf` needs troika. `ether/scroll` holds the Lenis and GSAP
dependency for the same reason.

**No CDN defaults.**
[`src/loaders/gltf.ts`](../src/loaders/gltf.ts), [`src/text/msdf/index.ts`](../src/text/msdf/index.ts).
Draco and KTX2 decoders are served by the site and passed as paths.
MSDF text takes a font URL rather than falling back to a hosted one. A
premium site does not fetch its rendering from someone else's origin.

**Raw TypeScript for the inner loop, built ESM for everyone else.**
[`package.json`](../package.json), [`vite.config.ts`](../vite.config.ts), [`scripts/prepare-publish.mjs`](../scripts/prepare-publish.mjs).
The `file:` install ships `src/` so a Vite site hot-reloads engine edits
like first-party code. The npm build is one ESM entry per module plus a
`tsc` declaration tree, checked by consuming every built `.d.ts` under
`skipLibCheck: false`, because declaration emit lies in small ways:
directory imports resolve to the wrong file once a `core.js` sits beside
`core/`, and reference directives are dropped.

**The engine never learns the brand.**
[`src/dev/tweaks/`](../src/dev/tweaks/Tweaks.ts).
Palette, fonts, hero word and choreography live in the site. Even the
tweaks panel takes its theme through options. The engine is the plumbing.

**The tests are the contract.**
[`tests/e2e/core.mjs`](../tests/e2e/core.mjs), [`tests/fixture/main.ts`](../tests/fixture/main.ts).
A plain-Vite fixture with instrumented scenes, driven by Playwright,
asserts the guarantees above through counters rather than pixels, and
runs twice: against the sources and against the built package.

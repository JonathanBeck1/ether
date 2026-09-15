// The engine's core guarantees, asserted against the plain-Vite fixture
// in tests/fixture: one manager per canvas for the life of the tab, one
// render loop, scene swaps that dispose the outgoing scene and keep the
// GL context, History-API navigation, which clicks interceptLinks takes
// and which it leaves to the browser, latest-wins under rapid
// navigation, the '*' fallback, retarget, resize propagation, recovery
// from a scene that fails to build, the bind hook, and a clean detach.
// Reads instrumented counters the fixture exposes on `window.__fixture`
// — never pixels.
import { chromium } from 'playwright';

const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 100;

// Headless / software-GL noise that is not an engine problem. Errors
// have NO allowlist.
const WARNING_ALLOWLIST = [/software WebGL|SwiftShader|GPU stall/i];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runCoreSuite(baseUrl) {
  const failures = [];
  const pass = (msg) => console.log(`  PASS  ${msg}`);
  const fail = (msg) => {
    failures.push(msg);
    console.error(`  FAIL  ${msg}`);
  };
  const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // Snapshot of everything the suite reasons about, read in one hop.
  const state = () =>
    page.evaluate(() => {
      const canvas = document.getElementById('scene-canvas');
      const m = canvas?.__sceneManager;
      return {
        path: location.pathname,
        tier: document.body.dataset.gpuTier ?? null,
        hasManager: !!m,
        active: m?.activeScene?.name ?? null,
        route: m?.currentRoute ?? null,
        aspect: m?.activeScene?.camera.aspect ?? null,
        canvases: document.querySelectorAll('canvas').length,
        tags: {
          canvas: canvas?.__tag ?? null,
          manager: m?.__tag ?? null,
          renderer: m?.renderer?.__tag ?? null,
        },
        scenes: window.__fixture.scenes.map((s) => ({
          name: s.name,
          composed: !!s.composer,
          ...s.counters,
        })),
      };
    });
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let last = await state();
    while (Date.now() < deadline) {
      if (predicate(last)) return last;
      await sleep(POLL_MS);
      last = await state();
    }
    fail(`${label} — timed out (state: ${JSON.stringify(last)})`);
    return null;
  };
  // Ticks a scene records across N of the page's own animation frames.
  const ticksOver = (sceneIndex, frames) =>
    page.evaluate(
      async ({ sceneIndex, frames }) => {
        const raf = () => new Promise((r) => requestAnimationFrame(r));
        const s = window.__fixture.scenes[sceneIndex];
        await raf();
        const t0 = s.counters.ticks;
        for (let i = 0; i < frames; i++) await raf();
        return s.counters.ticks - t0;
      },
      { sceneIndex, frames },
    );
  // three's per-render frame counter — proves draw calls reach the GPU.
  const framesOver = (rafs) =>
    page.evaluate(async (rafs) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const r = document.getElementById('scene-canvas').__sceneManager.renderer;
      const f0 = r.info.render.frame;
      for (let i = 0; i < rafs; i++) await raf();
      return r.info.render.frame - f0;
    }, rafs);

  try {
    // 1. Boot — forced quality, initial route from the address bar.
    let loaded = false;
    for (let i = 0; i < 15 && !loaded; i++) {
      try {
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 5_000 });
        loaded = true;
      } catch {
        await sleep(1_000);
      }
    }
    if (!loaded) throw new Error(`could not load ${baseUrl}`);
    pass(`fixture loads (${baseUrl})`);

    const booted = await waitFor((s) => s.active === 'A', 'boot: scene A active on /');
    if (!booted) throw new Error('boot failed — skipping behavioral checks');
    pass('boot: scene A mounted for /');
    check(booted.tier === 'MID', `boot: forced quality applied (data-gpu-tier=${booted.tier})`);
    check(
      booted.scenes.length === 1 && booted.scenes[0].entered === 1,
      `boot: one scene constructed, entered once (${booted.scenes.length} built, entered ${booted.scenes[0]?.entered})`,
    );
    check(booted.scenes[0].composed, 'boot: scene A renders through a composer');

    // 2. Exactly one render loop: ticks track the page's own frames 1:1.
    //    A duplicate manager would double the count.
    const ticksA = await ticksOver(0, 30);
    check(ticksA >= 28 && ticksA <= 32, `loop: one tick per frame (${ticksA} ticks over 30 frames)`);
    const drawnA = await framesOver(10);
    check(drawnA > 0, `loop: composer path issues draws (${drawnA} renders over 10 frames)`);

    // 3. One manager per canvas across boots: a second boot() tears the
    //    first down and takes its place, leaving exactly one alive.
    const reboot = await page.evaluate(async () => {
      const canvas = document.getElementById('scene-canvas');
      const before = canvas.__sceneManager;
      window.__fixture.router = await window.__fixture.boot();
      const live = window.__fixture.router.manager;
      return {
        displaced: live !== before && canvas.__sceneManager === live && before.activeScene === null,
        built: window.__fixture.scenes.length,
      };
    });
    check(
      reboot.displaced && reboot.built === 2,
      `boots: a second boot() displaces the first, one manager left (${reboot.built} scenes built)`,
    );

    // 4. Navigation: link click → pushState → scene swap on the same
    //    canvas, same manager, same renderer (GL context reused).
    await page.evaluate(() => {
      const canvas = document.getElementById('scene-canvas');
      canvas.__tag = 'persist';
      canvas.__sceneManager.__tag = 'persist';
      canvas.__sceneManager.renderer.__tag = 'persist';
      (canvas.getContext('webgl2') ?? canvas.getContext('webgl')).__tag = 'persist';
    });
    await page.click('a[href="/b"]');
    const onB = await waitFor((s) => s.active === 'B' && s.path === '/b', 'nav: /b active');
    if (onB) {
      pass('nav: link click swaps to scene B at /b');
      const [, a, b] = onB.scenes;
      check(
        a.exited === 1 && a.disposed === 1,
        `nav: outgoing scene exited + disposed once (exited ${a.exited}, disposed ${a.disposed})`,
      );
      check(b?.entered === 1 && !b.composed, 'nav: scene B entered once, renders without a composer');
      check(
        onB.tags.canvas === 'persist' && onB.tags.manager === 'persist' && onB.tags.renderer === 'persist',
        'nav: canvas, manager and renderer identity survive the swap',
      );
      check(onB.canvases === 1, `nav: single canvas (${onB.canvases})`);
      const drawnB = await framesOver(10);
      check(drawnB > 0, `nav: direct render path issues draws (${drawnB} renders over 10 frames)`);
      const ticksDead = await ticksOver(1, 20);
      check(ticksDead === 0, `nav: disposed scene A is inert (${ticksDead} ticks over 20 frames)`);
    }

    // 5. popstate: back rebuilds A fresh (new instance, counters reset).
    await page.goBack();
    const back = await waitFor(
      (s) => s.active === 'A' && s.path === '/' && s.scenes.length === 4,
      'nav: back to /',
    );
    if (back) {
      const [, , b, a2] = back.scenes;
      check(
        a2.name === 'A' && a2.entered === 1 && a2.disposed === 0,
        'popstate: fresh scene A mounted on back navigation',
      );
      check(b.exited === 1 && b.disposed === 1, 'popstate: scene B exited + disposed once');
      const ticksA2 = await ticksOver(3, 20);
      check(ticksA2 > 0, `popstate: fresh scene A ticking (${ticksA2} ticks over 20 frames)`);
    }

    // 6. '*' fallback via programmatic navigate().
    await page.evaluate(() => window.__fixture.router.navigate('/nope'));
    const nope = await waitFor((s) => s.route === '/nope' && s.path === '/nope', 'nav: /nope');
    if (nope) {
      check(nope.active === 'B', `fallback: unregistered /nope mounts the '*' scene (${nope.active})`);
    }

    // 7. Resize propagates to the active scene after the debounce.
    await page.setViewportSize({ width: 900, height: 600 });
    const resized = await waitFor(
      (s) => s.aspect !== null && Math.abs(s.aspect - 1.5) < 0.01 && s.scenes.at(-1).resized >= 1,
      'resize: camera aspect + onResize',
    );
    if (resized) {
      pass(`resize: camera aspect ${resized.aspect.toFixed(3)}, onResize fired ${resized.scenes.at(-1).resized}x`);
      const buffer = await page.evaluate(() => {
        const canvas = document.getElementById('scene-canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        const dpr = Math.min(window.devicePixelRatio, canvas.__sceneManager.quality.dprCap);
        return {
          width: gl.drawingBufferWidth,
          expected: Math.round(canvas.clientWidth * dpr),
          inline: canvas.style.width || '(none)',
        };
      });
      check(
        Math.abs(buffer.width - buffer.expected) <= 2 && buffer.inline === '(none)',
        `resize: drawing buffer tracks the CSS box (${buffer.width}px vs ${buffer.expected}px, inline style ${buffer.inline})`,
      );
    }

    // 8. Loaders: a GLB exported in-browser comes back through loadGLTF
    //    under a weighted progress bus; a texture takes its color space.
    const assets = await page.evaluate(() => window.__fixture.loaderProbe());
    check(assets.meshes === 1, `loaders: loadGLTF yields the exported mesh (${assets.meshes})`);
    check(
      assets.value === 1 && assets.steps.includes(0.75),
      `loaders: weighted progress steps ${JSON.stringify(assets.steps)}`,
    );
    check(
      assets.colorSpace === 'srgb' && assets.width === 1,
      `loaders: loadTexture applies the color space (${assets.colorSpace}, ${assets.width}px)`,
    );

    // 9. MSDF text resolves with a laid-out glyph run.
    const text = await page.evaluate(() => window.__fixture.textProbe());
    check(
      text.glyphs === 5 && text.width > 0,
      `text: msdfText lays out ETHER (${text.glyphs} glyphs, width ${text.width.toFixed(2)})`,
    );

    // 10. destroy() frees the canvas; a fresh boot re-attaches on the same
    //     GL context.
    const destroyed = await page.evaluate(async () => {
      const canvas = document.getElementById('scene-canvas');
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const last = window.__fixture.scenes.at(-1);
      window.__fixture.router.destroy();
      const released = canvas.__sceneManager === undefined;
      await raf();
      const t0 = last.counters.ticks;
      for (let i = 0; i < 10; i++) await raf();
      return { released, disposed: last.counters.disposed, ticksAfter: last.counters.ticks - t0 };
    });
    check(
      destroyed.released && destroyed.disposed === 1 && destroyed.ticksAfter === 0,
      `detach: destroy() releases the canvas, disposes the scene, stops the loop (released ${destroyed.released}, disposed ${destroyed.disposed}, ticks after ${destroyed.ticksAfter})`,
    );
    // The unbind returned by `bind` ran too: navigation events are dead
    // between destroy() and the next boot. The listener below is added
    // after the router's, so it reads whether the router intercepted and
    // then keeps the browser from following the link either way.
    const deaf = await page.evaluate(async () => {
      const built = window.__fixture.scenes.length;
      let prevented = false;
      const probe = (e) => {
        prevented = e.defaultPrevented;
        e.preventDefault();
      };
      document.addEventListener('click', probe);
      document
        .querySelector('a[href="/b"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      document.removeEventListener('click', probe);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await new Promise((r) => requestAnimationFrame(r));
      return { prevented, built: window.__fixture.scenes.length - built, path: location.pathname };
    });
    check(
      !deaf.prevented && deaf.built === 0 && deaf.path === '/nope',
      `detach: after destroy() clicks and popstate are ignored (intercepted ${deaf.prevented}, ${deaf.built} scenes built)`,
    );
    await page.evaluate(async () => {
      window.__fixture.router = await window.__fixture.boot();
    });
    const rebooted = await waitFor(
      (s) => s.hasManager && s.active === 'B' && s.scenes.length === 6,
      'detach: fresh boot after destroy',
    );
    if (rebooted) {
      check(
        rebooted.tags.manager === null && rebooted.canvases === 1,
        'detach: fresh boot builds a new manager on the same canvas',
      );
      const glTag = await page.evaluate(
        () => document.getElementById('scene-canvas').__sceneManager.renderer.getContext().__tag,
      );
      check(glTag === 'persist', `detach: the re-attached renderer keeps the GL context (${glTag})`);
      const ticksNew = await ticksOver(5, 20);
      check(ticksNew > 0, `detach: rebooted scene ticking (${ticksNew} ticks over 20 frames)`);
    }

    // 11. interceptLinks takes same-origin left clicks and nothing else:
    //     anything that means "open this yourself" stays the browser's.
    const beforeGuards = await state();
    const guards = await page.evaluate(() => {
      const results = [];
      let prevented = false;
      const probe = (e) => {
        prevented = e.defaultPrevented;
        e.preventDefault();
      };
      document.addEventListener('click', probe);
      const fire = (label, selector, init) => {
        prevented = false;
        document
          .querySelector(selector)
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
        results.push({ label, prevented });
      };
      fire('middle click', 'a[href="/b"]', { button: 1 });
      fire('meta click', 'a[href="/b"]', { metaKey: true });
      fire('ctrl click', 'a[href="/b"]', { ctrlKey: true });
      fire('shift click', 'a[href="/b"]', { shiftKey: true });
      fire('alt click', 'a[href="/b"]', { altKey: true });
      fire('target=_blank', '#link-blank', {});
      fire('download', '#link-download', {});
      fire('cross-origin', '#link-external', {});
      document.removeEventListener('click', probe);
      return results;
    });
    const stolen = guards.filter((g) => g.prevented).map((g) => g.label);
    const guarded = await state();
    check(
      stolen.length === 0 &&
        guarded.path === beforeGuards.path &&
        guarded.scenes.length === beforeGuards.scenes.length,
      stolen.length
        ? `intercept: router took clicks the browser owns — ${stolen.join(', ')}`
        : `intercept: ${guards.length} browser-owned clicks left alone, no scene built`,
    );

    // 12. A link to the live route pushes state without swapping the
    //     scene. A same-page hash link is not the router's at all: it is
    //     left to the browser, which applies the fragment (the scroll
    //     itself is pinned in tests/e2e/recovery.mjs).
    const sameRoute = await page.evaluate(async () => {
      const canvas = document.getElementById('scene-canvas');
      const live = canvas.__sceneManager.activeScene;
      const built = window.__fixture.scenes.length;
      let prevented = false;
      const probe = (e) => {
        prevented = e.defaultPrevented;
        e.preventDefault();
      };
      document.addEventListener('click', probe);
      const click = (selector) => {
        prevented = false;
        document
          .querySelector(selector)
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return prevented;
      };
      const route = click('a[href="/nope"]');
      const path = location.pathname;
      const entries = history.length;
      const hash = click('#link-hash');
      const pushed = history.length - entries;
      const hashPath = location.pathname;
      document.removeEventListener('click', probe);
      await window.__fixture.router.navigate(location.pathname);
      return {
        route,
        hash,
        pushed,
        hashPath,
        path,
        same: canvas.__sceneManager.activeScene === live,
        disposed: live.counters.disposed,
        built: window.__fixture.scenes.length - built,
      };
    });
    check(sameRoute.route, 'intercept: a link to the live route goes through the router');
    check(
      !sameRoute.hash && sameRoute.pushed === 0 && sameRoute.hashPath === sameRoute.path,
      `intercept: a same-page hash link is left to the browser (intercepted ${sameRoute.hash}, +${sameRoute.pushed} history entries, path ${sameRoute.hashPath})`,
    );
    check(
      sameRoute.same && sameRoute.disposed === 0 && sameRoute.built === 0,
      `same route: link and navigate() keep the live scene (${sameRoute.built} built, disposed ${sameRoute.disposed})`,
    );

    // 13. Latest wins: five rapid navigate() calls settle on the last
    //     route, with one live scene, one loop, and every scene built on
    //     the way there disposed.
    const rapidBase = guarded.scenes.length;
    await page.evaluate(() => {
      const { router } = window.__fixture;
      router.navigate('/');
      router.navigate('/b');
      router.navigate('/');
      router.navigate('/nope');
      router.navigate('/b');
    });
    const rapid = await waitFor(
      (s) => s.path === '/b' && s.route === '/b' && s.active === 'B',
      'rapid: converged on /b',
    );
    if (rapid) {
      const built = rapid.scenes.slice(rapidBase);
      const live = rapid.scenes.at(-1);
      check(
        built.length === 2 && built[0].exited === 1 && built[0].disposed === 1,
        `rapid: intermediate routes skipped, the scene built on the way disposed (built ${built.map((b) => b.name).join(',')})`,
      );
      check(
        live.name === 'B' && live.entered === 1 && live.disposed === 0,
        `rapid: exactly one live scene on the last route (${live.name}, entered ${live.entered})`,
      );
      const ticksRapid = await ticksOver(rapid.scenes.length - 1, 30);
      check(
        ticksRapid >= 28 && ticksRapid <= 32,
        `rapid: still one render loop (${ticksRapid} ticks over 30 frames)`,
      );
      const ticksStale = await ticksOver(rapidBase, 20);
      check(ticksStale === 0, `rapid: the skipped-past scene is inert (${ticksStale} ticks over 20 frames)`);
    }

    // 14. navigate({ replace: true }) swaps the scene in place of the
    //     current history entry.
    const replaced = await page.evaluate(async () => {
      const before = history.length;
      await window.__fixture.router.navigate('/', { replace: true });
      return { grew: history.length - before, path: location.pathname };
    });
    const onReplace = await waitFor((s) => s.active === 'A' && s.path === '/', 'replace: A on /');
    check(
      replaced.grew === 0 && !!onReplace,
      `navigate: replace swaps the scene without a new history entry (+${replaced.grew})`,
    );

    // 15. popstate drives forward as well as back.
    await page.goBack();
    const backAgain = await waitFor(
      (s) => s.path === '/nope' && s.active === 'B',
      'popstate: back to /nope',
    );
    await page.goForward();
    const forward = await waitFor((s) => s.path === '/' && s.active === 'A', 'popstate: forward to /');
    if (backAgain && forward) {
      const live = forward.scenes.at(-1);
      const previous = forward.scenes.at(-2);
      check(
        live.name === 'A' && live.entered === 1 && live.disposed === 0,
        'popstate: forward mounts a fresh scene for the route',
      );
      check(
        previous.exited === 1 && previous.disposed === 1,
        `popstate: forward exits + disposes the outgoing scene (exited ${previous.exited}, disposed ${previous.disposed})`,
      );
    }

    // 16. A resize that lands mid-transition reaches the scene that ends
    //     up live — it seeds from the canvas box, not from the box the
    //     transition started on. The fixture holds the outgoing scene
    //     inside exitTransition so the two overlap deterministically.
    const outgoing = forward ? forward.scenes.length - 1 : 0;
    await page.evaluate(() => {
      window.__fixture.hold('exit');
      window.__fixture.router.navigate('/b');
    });
    const exiting = await waitFor(
      (s) => s.scenes[outgoing].exited === 1,
      'transition: outgoing scene held in exit',
    );
    if (exiting) {
      await page.setViewportSize({ width: 1000, height: 500 });
      await waitFor((s) => s.scenes[outgoing].resized >= 2, 'transition: resize lands mid-exit');
    }
    await page.evaluate(() => window.__fixture.release('exit'));
    const midResize = await waitFor(
      (s) => s.active === 'B' && s.path === '/b',
      'transition: /b live after the hold',
    );
    if (midResize) {
      check(
        Math.abs(midResize.aspect - 2) < 0.01 && midResize.scenes.at(-1).resized >= 1,
        `transition: the scene that ends up live takes the mid-transition size (aspect ${midResize.aspect.toFixed(3)})`,
      );
    }
    // Preload finishes before the scene goes live: nothing half-mounted
    // ticks, and the loop is still running when it does.
    await page.evaluate(() => {
      window.__fixture.hold('preload');
      window.__fixture.router.navigate('/');
    });
    const preloading = await waitFor(
      (s) => s.route === '/b' && s.active === null,
      'transition: incoming scene held in preload',
    );
    if (preloading) {
      const ticksHeld = await ticksOver(preloading.scenes.length - 1, 20);
      check(
        ticksHeld === 0 && preloading.scenes.at(-1).entered === 0,
        `transition: a scene held in preload is built but not live (${ticksHeld} ticks, entered ${preloading.scenes.at(-1).entered})`,
      );
    }
    await page.evaluate(() => window.__fixture.release('preload'));
    const preloaded = await waitFor(
      (s) => s.active === 'A' && s.path === '/',
      'transition: / live after preload',
    );
    if (preloaded) {
      const ticksPreloaded = await ticksOver(preloaded.scenes.length - 1, 20);
      check(
        ticksPreloaded > 0 && preloaded.scenes.at(-1).entered === 1,
        `transition: it enters and ticks once preload resolves (${ticksPreloaded} ticks over 20 frames)`,
      );
    }

    // 17. A scene factory that throws is surfaced, not swallowed, and
    //     leaves the manager able to take the next navigation.
    const errorsBefore = consoleErrors.length;
    await page.evaluate(() => window.__fixture.router.navigate('/boom'));
    const errorDeadline = Date.now() + 5_000;
    while (consoleErrors.length === errorsBefore && Date.now() < errorDeadline) await sleep(POLL_MS);
    // Spliced out so the console policy below stays strict about the rest.
    const surfaced = consoleErrors.splice(errorsBefore);
    check(
      surfaced.length === 1 && /transitionTo failed/.test(surfaced[0]),
      `failure: a throwing factory surfaces once through console.error (${surfaced.length} logged)`,
    );
    const threw = await state();
    check(
      threw.active === null && threw.scenes.at(-1).disposed === 1,
      `failure: the outgoing scene still exited + disposed, nothing half-mounted (active ${threw.active})`,
    );
    await page.evaluate(() => window.__fixture.router.navigate('/b'));
    const recovered = await waitFor(
      (s) => s.active === 'B' && s.path === '/b',
      'failure: navigation after a throwing factory',
    );
    if (recovered) {
      const ticksRecovered = await ticksOver(recovered.scenes.length - 1, 20);
      check(
        ticksRecovered > 0,
        `failure: manager not wedged — the next route mounts and ticks (${ticksRecovered} ticks over 20 frames)`,
      );
    }

    // 18. Two routes on one factory, with retarget(): the scene stays
    //     alive across the route change instead of exit → dispose →
    //     rebuild.
    await page.evaluate(() => window.__fixture.router.navigate('/c1'));
    const c1 = await waitFor((s) => s.active === 'C' && s.route === '/c1', 'retarget: /c1 mounted');
    if (c1) {
      await page.evaluate(() => window.__fixture.router.navigate('/c2'));
      const c2 = await waitFor((s) => s.route === '/c2', 'retarget: /c2');
      if (c2) {
        const live = c2.scenes.at(-1);
        check(
          c2.scenes.length === c1.scenes.length &&
            live.retargeted === 1 &&
            live.exited === 0 &&
            live.disposed === 0,
          `retarget: a same-factory route change keeps the scene (${c2.scenes.length - c1.scenes.length} built, retargeted ${live.retargeted})`,
        );
        const ticksKept = await ticksOver(c2.scenes.length - 1, 20);
        check(ticksKept > 0, `retarget: the kept scene keeps ticking (${ticksKept} ticks over 20 frames)`);
      }
    }

    // 19. The bind hook every framework adapter is built on, exercised
    //     through attachSceneManager on a canvas of its own.
    const bound = await page.evaluate(() => window.__fixture.attachProbe());
    check(
      bound.binds.length === 1 && bound.binds[0].current && bound.binds[0].tagged,
      `bind: called once, with the attachment already live on the canvas (${bound.binds.length} calls)`,
    );
    check(
      bound.overrode && bound.tierDuring === 'LOW' && bound.pixelRatio === bound.expectedPixelRatio,
      `bind: attach options override quality detection (tier ${bound.tierDuring}, dpr ${bound.pixelRatio})`,
    );
    check(
      bound.unbinds === 1 && bound.released && bound.idle && bound.disposed === 1,
      `bind: detach unbinds once, frees the canvas, disposes the in-flight scene (unbinds ${bound.unbinds}, disposed ${bound.disposed})`,
    );

    // 20. A load that fails rejects to the caller, still settles the
    //     progress bus, and does not touch the loop.
    const loadFailure = await page.evaluate(() => window.__fixture.failProbe());
    check(
      loadFailure.rejected && loadFailure.value === 1,
      `loaders: a failed load rejects and still settles progress (rejected ${loadFailure.rejected}, value ${loadFailure.value})`,
    );
    const afterFailure = await state();
    const ticksAfterFailure = await ticksOver(afterFailure.scenes.length - 1, 20);
    check(
      ticksAfterFailure > 0,
      `loaders: the render loop survives a failed load (${ticksAfterFailure} ticks over 20 frames)`,
    );

    // 21. Console policy.
    const unexpectedWarnings = consoleWarnings.filter(
      (w) => !WARNING_ALLOWLIST.some((re) => re.test(w)),
    );
    check(consoleErrors.length === 0, consoleErrors.length ? `console errors:\n    ${consoleErrors.join('\n    ')}` : 'no console errors');
    check(
      unexpectedWarnings.length === 0,
      unexpectedWarnings.length ? `unexpected warnings:\n    ${unexpectedWarnings.join('\n    ')}` : 'no unexpected console warnings',
    );
  } catch (err) {
    fail(String(err?.message ?? err));
  } finally {
    await browser.close();
  }

  return failures;
}

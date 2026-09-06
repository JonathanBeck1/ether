// The engine's core guarantees, asserted against the plain-Vite fixture
// in tests/fixture: one manager per canvas for the life of the tab, one
// render loop, scene swaps that dispose the outgoing scene and keep the
// GL context, History-API navigation, the '*' fallback, resize
// propagation, and a clean detach. Reads instrumented counters the
// fixture exposes on `window.__fixture` — never pixels.
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

    // 3. Single-flight: a second boot() hands back the live manager.
    const reboot = await page.evaluate(async () => {
      const canvas = document.getElementById('scene-canvas');
      const before = canvas.__sceneManager;
      const router = await window.__fixture.boot();
      return {
        same: router.manager === before && canvas.__sceneManager === before,
        built: window.__fixture.scenes.length,
      };
    });
    check(
      reboot.same && reboot.built === 1,
      `single-flight: second boot() returns the live manager, no new scene (${reboot.built} built)`,
    );

    // 4. Navigation: link click → pushState → scene swap on the same
    //    canvas, same manager, same renderer (GL context reused).
    await page.evaluate(() => {
      const canvas = document.getElementById('scene-canvas');
      canvas.__tag = 'persist';
      canvas.__sceneManager.__tag = 'persist';
      canvas.__sceneManager.renderer.__tag = 'persist';
    });
    await page.click('a[href="/b"]');
    const onB = await waitFor((s) => s.active === 'B' && s.path === '/b', 'nav: /b active');
    if (onB) {
      pass('nav: link click swaps to scene B at /b');
      const [a, b] = onB.scenes;
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
      const ticksDead = await ticksOver(0, 20);
      check(ticksDead === 0, `nav: disposed scene A is inert (${ticksDead} ticks over 20 frames)`);
    }

    // 5. popstate: back rebuilds A fresh (new instance, counters reset).
    await page.goBack();
    const back = await waitFor(
      (s) => s.active === 'A' && s.path === '/' && s.scenes.length === 3,
      'nav: back to /',
    );
    if (back) {
      const [, b, a2] = back.scenes;
      check(
        a2.name === 'A' && a2.entered === 1 && a2.disposed === 0,
        'popstate: fresh scene A mounted on back navigation',
      );
      check(b.exited === 1 && b.disposed === 1, 'popstate: scene B exited + disposed once');
      const ticksA2 = await ticksOver(2, 20);
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
    await page.evaluate(async () => {
      window.__fixture.router = await window.__fixture.boot();
    });
    const rebooted = await waitFor(
      (s) => s.hasManager && s.active === 'B' && s.scenes.length === 5,
      'detach: fresh boot after destroy',
    );
    if (rebooted) {
      check(
        rebooted.tags.manager === null && rebooted.canvases === 1,
        'detach: fresh boot builds a new manager on the same canvas',
      );
      const ticksNew = await ticksOver(4, 20);
      check(ticksNew > 0, `detach: rebooted scene ticking (${ticksNew} ticks over 20 frames)`);
    }

    // 11. Console policy.
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

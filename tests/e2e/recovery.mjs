// What the engine owes a consumer after something goes wrong: a boot that
// failed can be retried, a canvas whose manager was destroyed can be
// re-attached, a second boot displaces the first instead of handing back a
// stale one, an in-page #hash link still belongs to the browser, and a
// scene that throws mid-frame halts itself, not the loop. Same fixture as
// core.mjs, read through `window.__fixture` counters.
import { chromium } from 'playwright';

const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runRecoverySuite(baseUrl, launchOptions = {}) {
  const failures = [];
  const pass = (msg) => console.log(`  PASS  ${msg}`);
  const fail = (msg) => {
    failures.push(msg);
    console.error(`  FAIL  ${msg}`);
  };
  const check = (ok, msg) => (ok ? pass(msg) : fail(msg));

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const state = () =>
    page.evaluate(() => {
      const canvas = document.getElementById('scene-canvas');
      const m = canvas?.__sceneManager;
      return {
        attached: !!m,
        active: m?.activeScene?.name ?? null,
        built: window.__fixture.scenes.length,
        canvases: document.querySelectorAll('canvas').length,
        scrollY: window.scrollY,
        hash: location.hash,
        path: location.pathname,
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
  const goto = async (path) => {
    let loaded = false;
    for (let i = 0; i < 15 && !loaded; i++) {
      try {
        await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 5_000 });
        loaded = true;
      } catch {
        await sleep(1_000);
      }
    }
    if (!loaded) throw new Error(`could not load ${baseUrl}${path}`);
    // DOMContentLoaded does not wait for main.ts's top-level await, so the
    // fixture can still be undefined on the first read.
    await page.waitForFunction(() => !!window.__fixture, null, { timeout: READY_TIMEOUT_MS });
  };
  // Ticks the live scene records over N frames, against ticks from every
  // other scene ever built — a leftover manager shows up as the latter.
  const tickAudit = (frames) =>
    page.evaluate(async (frames) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const live = document.getElementById('scene-canvas').__sceneManager.activeScene;
      const scenes = window.__fixture.scenes;
      await raf();
      const before = scenes.map((s) => s.counters.ticks);
      for (let i = 0; i < frames; i++) await raf();
      const delta = scenes.map((s, i) => s.counters.ticks - before[i]);
      const liveIndex = scenes.indexOf(live);
      return {
        live: delta[liveIndex] ?? 0,
        others: delta.reduce((sum, d, i) => (i === liveIndex ? sum : sum + d), 0),
      };
    }, frames);

  try {
    // 1. A boot the browser refused a WebGL context to is retryable: the
    //    failed init must not be cached against the canvas.
    await goto('/?failinit=1');
    await page.waitForFunction(() => window.__fixture.settled, null, { timeout: READY_TIMEOUT_MS });
    const refused = await page.evaluate(() => ({
      router: window.__fixture.router,
      attached: document.getElementById('scene-canvas').__sceneManager !== undefined,
    }));
    check(
      refused.router === null && !refused.attached,
      `retry: the refused boot left the canvas unattached (router ${refused.router}, attached ${refused.attached})`,
    );
    const retried = await page.evaluate(async () => {
      try {
        window.__fixture.router = await window.__fixture.boot();
        return 'ok';
      } catch (err) {
        return String(err?.message ?? err);
      }
    });
    check(retried === 'ok', `retry: a second boot() after a failed one resolves (${retried})`);
    const back = await waitFor((s) => s.attached && s.active === 'A', 'retry: scene A active after retry');
    if (back) pass(`retry: the retried boot mounts scene A (${back.built} scene built)`);

    // 2. SceneManager.destroy() called straight on the manager (the
    //    documented teardown) leaves the canvas re-attachable.
    await goto('/');
    if (await waitFor((s) => s.active === 'A', 'destroyed: boot')) {
      const reattached = await page.evaluate(async () => {
        const canvas = document.getElementById('scene-canvas');
        const first = canvas.__sceneManager;
        first.destroy();
        const stillTagged = canvas.__sceneManager === first;
        window.__fixture.router = await window.__fixture.boot();
        return {
          stillTagged,
          replaced: !!canvas.__sceneManager && canvas.__sceneManager !== first,
          firstActive: first.activeScene,
        };
      });
      check(
        reattached.stillTagged && reattached.replaced && reattached.firstActive === null,
        `destroyed: a destroyed manager's canvas takes a fresh one (was tagged ${reattached.stillTagged}, replaced ${reattached.replaced})`,
      );
      const live = await waitFor((s) => s.attached && s.active === 'A', 'destroyed: fresh scene active');
      if (live) {
        const ticks = await tickAudit(20);
        check(
          ticks.live > 0 && ticks.others === 0,
          `destroyed: only the fresh scene ticks (${ticks.live} live, ${ticks.others} elsewhere)`,
        );
      }
    }

    // 3. A second boot displaces the first: one live manager, and the NEW
    //    route table is the one in effect.
    await goto('/');
    if (await waitFor((s) => s.active === 'A', 'double boot: first boot')) {
      const doubled = await page.evaluate(async () => {
        const canvas = document.getElementById('scene-canvas');
        const first = canvas.__sceneManager;
        const router = await window.__fixture.boot({ '/': window.__fixture.flat('C', '#22cc88', false) });
        window.__fixture.router = router;
        return {
          displaced: canvas.__sceneManager === router.manager && router.manager !== first,
          firstActive: first.activeScene,
        };
      });
      check(
        doubled.displaced && doubled.firstActive === null,
        `double boot: the second boot displaces and destroys the first (displaced ${doubled.displaced})`,
      );
      const onC = await waitFor((s) => s.active === 'C', 'double boot: new route table in effect');
      if (onC) {
        check(onC.canvases === 1, `double boot: single canvas (${onC.canvases})`);
        const ticks = await tickAudit(20);
        check(
          ticks.live > 0 && ticks.others === 0,
          `double boot: exactly one render loop (${ticks.live} ticks live, ${ticks.others} elsewhere)`,
        );
      }
    }

    // 4. interceptLinks leaves same-page fragments to the browser.
    await goto('/');
    const beforeHash = await waitFor((s) => s.active === 'A', 'hash: boot');
    if (beforeHash) {
      await page.click('a[href="#tail"]');
      const hashed = await waitFor(
        (s) => s.hash === '#tail' && s.scrollY > 0,
        'hash: #tail applied',
      );
      if (hashed) {
        pass(`hash: #tail scrolls the page (scrollY ${hashed.scrollY}, hash ${hashed.hash})`);
        check(
          hashed.active === 'A' && hashed.built === beforeHash.built,
          `hash: the scene is left alone (${hashed.built} built, active ${hashed.active})`,
        );
      }
    }

    // 5. rel="external" opts an anchor out of the router entirely — the
    //    browser does a real document load, which drops the marker. Each
    //    block above re-navigates, so the reset this leaves behind is
    //    nobody's dependency.
    await goto('/');
    if (await waitFor((s) => s.active === 'A', 'external: boot')) {
      await page.evaluate(() => {
        window.__marker = 'pre-click';
      });
      await page.click('#external-link');
      const navigated = await page
        .waitForFunction(() => window.__marker === undefined, null, { timeout: READY_TIMEOUT_MS })
        .then(
          () => true,
          () => false,
        );
      check(navigated, `external: rel="external" does a real navigation (marker dropped ${navigated})`);
    }

    // 6. A scene whose tick throws halts that scene, not the render loop:
    //    the failure is counted and logged once, and the next route renders.
    await goto('/');
    if (await waitFor((s) => s.active === 'A', 'fault: boot')) {
      const logged = [];
      const onConsole = (msg) => {
        if (msg.type() === 'error' && /tick failed for \/fault/.test(msg.text())) logged.push(msg.text());
      };
      page.on('console', onConsole);
      await page.evaluate(() => window.__fixture.router.navigate('/fault'));
      if (await waitFor((s) => s.active === 'F', 'fault: /fault live')) {
        // Rendered frames and loop ticks over N frames, with the snapshot after.
        const loopOver = (frames) =>
          page.evaluate(async (frames) => {
            const raf = () => new Promise((r) => requestAnimationFrame(r));
            const m = document.getElementById('scene-canvas').__sceneManager;
            await raf();
            const loop0 = m.getDiagnostics().performance.frames;
            const render0 = m.renderer.info.render.frame;
            for (let i = 0; i < frames; i++) await raf();
            const d = m.getDiagnostics();
            return {
              loop: d.performance.frames - loop0,
              rendered: m.renderer.info.render.frame - render0,
              skipped: d.rendering.skipped,
              failures: d.scene.failures,
              lastError: d.scene.lastError,
              autoReset: m.renderer.info.autoReset,
              faultTicks: window.__fixture.scenes.find((s) => s.name === 'F').counters.ticks,
            };
          }, frames);
        const halted = await loopOver(20);
        check(
          halted.loop > 0 && halted.rendered === 0 && halted.skipped === 'faulted' && halted.faultTicks === 1,
          `fault: the loop runs on with the scene halted (${halted.loop} loop ticks, ${halted.rendered} renders, skipped ${halted.skipped}, scene ticked ${halted.faultTicks})`,
        );
        check(
          halted.failures === 1 && halted.lastError === '/fault: tick: fixture: scene tick failed' && halted.autoReset,
          `fault: counted once with its stage (failures ${halted.failures}, lastError ${halted.lastError}, autoReset ${halted.autoReset})`,
        );
        check(logged.length === 1, `fault: logged once, not per frame (${logged.length} logged)`);
        await page.evaluate(() => window.__fixture.router.navigate('/b'));
        const onB = await waitFor((s) => s.active === 'B' && s.path === '/b', 'fault: navigation away');
        if (onB) {
          const next = await loopOver(20);
          check(
            next.rendered > 0 && next.skipped === null && next.failures === 1,
            `fault: the next route renders (${next.rendered} renders over 20 frames, skipped ${next.skipped})`,
          );
        }
      }
      page.off('console', onConsole);
    }
  } catch (err) {
    fail(String(err?.message ?? err));
  } finally {
    await browser.close();
  }

  return failures;
}

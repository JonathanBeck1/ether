// The engine lives as long as the document does. `beforeunload` is not an
// unload: a mailto: link and a cancelled leave prompt both fire it and the
// page stays, so the manager has to keep rendering through both. Same
// fixture as core.mjs; a marker on `window` proves the document survived.
import { chromium } from 'playwright';

const READY_TIMEOUT_MS = 60_000;
// Long enough for a teardown on beforeunload to have run and stopped the loop.
const SETTLE_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runLifecycleSuite(baseUrl, launchOptions = {}) {
  const failures = [];
  const check = (ok, msg) => {
    if (ok) console.log(`  PASS  ${msg}`);
    else {
      failures.push(msg);
      console.error(`  FAIL  ${msg}`);
    }
  };

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  console.log('\nlifecycle suite');

  const boot = async (path, scene) => {
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
    await page.waitForFunction(
      (name) => document.getElementById('scene-canvas').__sceneManager?.activeScene?.name === name,
      scene,
      { timeout: READY_TIMEOUT_MS },
    );
    await page.evaluate(() => {
      window.__marker = 'same-document';
      window.__beforeunloads = 0;
      window.addEventListener('beforeunload', () => window.__beforeunloads++);
    });
  };
  // Same document, manager still on the canvas, and three's per-render
  // frame counter still advancing.
  const alive = () =>
    page.evaluate(async () => {
      const m = document.getElementById('scene-canvas').__sceneManager;
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      const f0 = m?.renderer.info.render.frame ?? 0;
      for (let i = 0; i < 20; i++) await raf();
      return {
        marker: window.__marker ?? null,
        beforeunloads: window.__beforeunloads ?? null,
        path: location.pathname,
        attached: !!m,
        frames: m ? m.renderer.info.render.frame - f0 : 0,
      };
    });

  try {
    // 1. A mailto: link fires beforeunload and hands off to the mail
    //    client; the page never unloads.
    await boot('/', 'A');
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.id = 'link-mailto';
      a.href = 'mailto:hello@example.com';
      a.textContent = 'mail';
      document.querySelector('nav').append(a);
    });
    await page.click('#link-mailto');
    await sleep(SETTLE_MS);
    const mailed = await alive();
    check(
      mailed.marker === 'same-document' && mailed.beforeunloads === 1,
      `mailto: beforeunload fired and the document stayed (beforeunload x${mailed.beforeunloads}, marker ${mailed.marker})`,
    );
    check(
      mailed.attached && mailed.frames > 0,
      `mailto: the manager survives and keeps rendering (attached ${mailed.attached}, ${mailed.frames} renders over 20 frames)`,
    );

    // 2. A leave prompt the visitor cancels: the navigation is called off
    //    after beforeunload already fired. rel="external" makes the click a
    //    real document navigation, and the prompt needs user activation.
    await boot('/b', 'B');
    const prompts = [];
    page.on('dialog', (dialog) => {
      prompts.push(dialog.type());
      dialog.dismiss();
    });
    await page.evaluate(() =>
      window.addEventListener('beforeunload', (e) => {
        e.preventDefault();
        e.returnValue = '';
      }),
    );
    await page.mouse.click(640, 400);
    await page.click('#external-link');
    await sleep(SETTLE_MS);
    const stayed = await alive();
    check(
      prompts.join() === 'beforeunload' &&
        stayed.marker === 'same-document' &&
        stayed.path === '/b' &&
        stayed.beforeunloads === 1,
      `leave prompt: dismissing it keeps the page on /b (prompts ${prompts.join() || 'none'}, path ${stayed.path}, marker ${stayed.marker})`,
    );
    check(
      stayed.attached && stayed.frames > 0,
      `leave prompt: the manager survives and keeps rendering (attached ${stayed.attached}, ${stayed.frames} renders over 20 frames)`,
    );
  } catch (err) {
    check(false, String(err?.message ?? err));
  } finally {
    await browser.close();
  }

  return failures;
}

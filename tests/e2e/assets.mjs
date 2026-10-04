// Failure and teardown paths that only exist in a real page: an unusable
// MSDF font or LUT must reject instead of hanging, and initCardTilt's
// returned teardown must actually unbind. Run alongside the core suite by
// run.mjs.
import { chromium } from 'playwright';

const READY_TIMEOUT_MS = 60_000;
const REJECT_BUDGET_MS = 10_000;
// Under msdfText's default 10 s timeout, so these pass only when the
// preflight itself rejects.
const FAST_BUDGET_MS = 5_000;
const GLYPH_TIMEOUT_MS = 2_000;

// What an SPA host serves for a path it does not have. The blank line of
// spaces matters: postprocessing's .3dl parser reads it as a grid.
const FALLBACK_PAGE =
  '<!doctype html>\n<html>\n  <head><title>app</title></head>\n  <body>\n    \n    <div id="app"></div>\n  </body>\n</html>\n';
const IDENTITY_CUBE = `LUT_3D_SIZE 2\n${[
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1',
].join('\n')}\n`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runAssetsSuite(baseUrl, launchOptions = {}) {
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

  // The 404 font makes troika console.error by design, so only uncaught
  // exceptions are worth collecting here.
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  console.log('\nassets suite');

  try {
    // The preview server answers every path with the SPA fallback, so the 404
    // has to come from here.
    await page.route('**/no-such-font.ttf', (route) => route.fulfill({ status: 404 }));
    await page.route('**/grades/missing.cube', (route) => route.fulfill({ status: 404 }));
    const html = (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: FALLBACK_PAGE });
    await page.route('**/grades/fallback.cube', html);
    await page.route('**/grades/fallback.3dl', html);
    await page.route('**/fonts/fallback.ttf', html);
    await page.route('**/grades/identity.cube', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: IDENTITY_CUBE }),
    );
    await page.route('**/fonts/display.woff2', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'font/woff2',
        body: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64)]),
      }),
    );
    // Stands in for a CSP, firewall or offline page. Context-wide so the
    // troika worker's requests are caught too.
    let cdnBlocked = 0;
    await context.route('https://cdn.jsdelivr.net/**', (route) => {
      cdnBlocked++;
      return route.abort();
    });
    let loaded = false;
    for (let i = 0; i < 15 && !loaded; i++) {
      try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 5_000 });
        loaded = true;
      } catch {
        await sleep(1_000);
      }
    }
    if (!loaded) throw new Error(`could not load ${baseUrl}`);
    // DOMContentLoaded does not wait for main.ts's top-level await, so the
    // fixture can still be undefined on the first read.
    await page.waitForFunction(() => !!window.__fixture, null, { timeout: READY_TIMEOUT_MS });

    const missing = await page.evaluate(
      (budget) =>
        Promise.race([
          window.__fixture.missingFontProbe('/no-such-font.ttf'),
          new Promise((resolve) =>
            setTimeout(() => resolve({ rejected: false, timedOut: true }), budget),
          ),
        ]),
      REJECT_BUDGET_MS,
    );
    check(
      missing.rejected && !missing.timedOut,
      `text: msdfText rejects on a 404 font in ${Math.round(missing.ms ?? REJECT_BUDGET_MS)}ms (budget ${REJECT_BUDGET_MS}ms)`,
    );
    check(
      /msdfText/.test(missing.message ?? '') && /no-such-font\.ttf/.test(missing.message ?? ''),
      `text: the rejection names the module and the URL — "${missing.message ?? ''}"`,
    );

    // Races a fixture probe against a budget in the page, so a promise that
    // never settles reads as timedOut instead of stalling the suite.
    const within = (probe, args, budget) =>
      page.evaluate(
        ([probe, args, budget]) =>
          Promise.race([
            window.__fixture[probe](...args),
            new Promise((resolve) =>
              setTimeout(() => resolve({ rejected: false, timedOut: true, message: '' }), budget),
            ),
          ]),
        [probe, args, budget],
      );

    const woff2 = await within('missingFontProbe', ['/fonts/display.woff2'], FAST_BUDGET_MS);
    check(
      woff2.rejected && !woff2.timedOut && /woff2/.test(woff2.message),
      `text: msdfText rejects a woff2 font at the preflight in ${Math.round(woff2.ms ?? FAST_BUDGET_MS)}ms (budget ${FAST_BUDGET_MS}ms) — "${woff2.message}"`,
    );
    const page200 = await within('missingFontProbe', ['/fonts/fallback.ttf'], FAST_BUDGET_MS);
    check(
      page200.rejected &&
        !page200.timedOut &&
        /not a font/.test(page200.message) &&
        /text\/html/.test(page200.message),
      `text: msdfText rejects an HTML page served as the font in ${Math.round(page200.ms ?? FAST_BUDGET_MS)}ms (budget ${FAST_BUDGET_MS}ms) — "${page200.message}"`,
    );
    const fontUrl = await page.evaluate(() => window.__fixture.fontUrl);
    // kenpixel has no euro sign, so troika asks the blocked CDN for one.
    const errorsBefore = pageErrors.length;
    const uncovered = await within(
      'missingFontProbe',
      [fontUrl, 'CAFE €20', GLYPH_TIMEOUT_MS],
      FAST_BUDGET_MS,
    );
    // troika's worker leaves that failed fetch uncaught; it is troika's
    // error, not the kit's, so it is set aside rather than counted.
    pageErrors.push(...pageErrors.splice(errorsBefore).filter((m) => m !== 'Failed to fetch'));
    check(
      uncovered.rejected && !uncovered.timedOut && uncovered.ms < GLYPH_TIMEOUT_MS + 1_000,
      `text: msdfText rejects at timeoutMs ${GLYPH_TIMEOUT_MS} when the unicode fallback CDN is unreachable, in ${Math.round(uncovered.ms ?? FAST_BUDGET_MS)}ms (budget ${GLYPH_TIMEOUT_MS + 1_000}ms)`,
    );
    check(
      cdnBlocked > 0 &&
        uncovered.message.includes(fontUrl) &&
        /cdn\.jsdelivr\.net/.test(uncovered.message) &&
        /unicodeFontsURL/.test(uncovered.message),
      `text: the timeout names the font and the fallback CDN (${cdnBlocked} CDN requests blocked) — "${uncovered.message}"`,
    );

    const lut404 = await within('lutProbe', ['/grades/missing.cube'], FAST_BUDGET_MS);
    check(
      lut404.rejected &&
        !lut404.timedOut &&
        /loadLUT/.test(lut404.message) &&
        /404/.test(lut404.message) &&
        /missing\.cube/.test(lut404.message),
      `postfx: loadLUT rejects on a 404 in ${Math.round(lut404.ms ?? FAST_BUDGET_MS)}ms (budget ${FAST_BUDGET_MS}ms) — "${lut404.message}"`,
    );
    for (const name of ['fallback.cube', 'fallback.3dl']) {
      const bad = await within('lutProbe', [`/grades/${name}`], FAST_BUDGET_MS);
      check(
        bad.rejected && !bad.timedOut && /loadLUT/.test(bad.message) && bad.message.includes(name),
        `postfx: loadLUT rejects an HTML page served as ${name} in ${Math.round(bad.ms ?? FAST_BUDGET_MS)}ms (budget ${FAST_BUDGET_MS}ms) — "${bad.message}"`,
      );
    }
    const identity = await within('lutProbe', ['/grades/identity.cube'], FAST_BUDGET_MS);
    check(
      !identity.rejected && !identity.timedOut && identity.size === 2,
      `postfx: loadLUT resolves a valid .cube (size ${identity.size ?? 'none'}${identity.message ? `, "${identity.message}"` : ''})`,
    );

    const tilt = await page.evaluate(() => window.__fixture.tiltProbe());
    check(tilt.returnsFunction, 'interactions: initCardTilt returns a teardown function');
    check(
      tilt.bound !== '',
      `interactions: pointermove writes --tilt-x while bound (${tilt.bound || 'unset'})`,
    );
    // Gated on the bound value: the probe clears --tilt-x before the second
    // move, so a tilt that never bound would leave it unset either way.
    check(
      tilt.bound !== '' && tilt.afterTeardown === '',
      `interactions: pointermove writes nothing after teardown (bound ${tilt.bound || 'unset'}, after ${tilt.afterTeardown || 'unset'})`,
    );

    check(
      pageErrors.length === 0,
      pageErrors.length
        ? `uncaught page errors:\n    ${pageErrors.join('\n    ')}`
        : 'no uncaught page errors',
    );
  } catch (err) {
    const detail = pageErrors.length ? `\n    ${pageErrors.join('\n    ')}` : '';
    check(false, `${String(err?.message ?? err)}${detail}`);
  } finally {
    await browser.close();
  }

  return failures;
}

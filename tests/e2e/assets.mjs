// Failure and teardown paths that only exist in a real page: an unreachable
// MSDF font must reject instead of hanging, and initCardTilt's returned
// teardown must actually unbind. Run alongside the core suite by run.mjs.
import { chromium } from 'playwright';

const READY_TIMEOUT_MS = 60_000;
const REJECT_BUDGET_MS = 10_000;

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

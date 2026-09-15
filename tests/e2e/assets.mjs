// Failure and teardown paths that only exist in a real page: an unreachable
// MSDF font must reject instead of hanging, and initCardTilt's returned
// teardown must actually unbind. Run alongside the core suite by run.mjs.
import { chromium } from 'playwright';

const REJECT_BUDGET_MS = 10_000;

export async function runAssetsSuite(baseUrl) {
  const failures = [];
  const check = (ok, msg) => {
    if (ok) console.log(`  PASS  ${msg}`);
    else {
      failures.push(msg);
      console.error(`  FAIL  ${msg}`);
    }
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  // The preview server answers every path with the SPA fallback, so the 404
  // has to come from here.
  await page.route('**/no-such-font.ttf', (route) => route.fulfill({ status: 404 }));
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__fixture);

  console.log('\nassets suite');

  const missing = await page.evaluate(
    (budget) =>
      Promise.race([
        window.__fixture.missingFontProbe('/no-such-font.ttf'),
        new Promise((resolve) => setTimeout(() => resolve({ rejected: false, timedOut: true }), budget)),
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
  check(tilt.bound !== '', `interactions: pointermove writes --tilt-x while bound (${tilt.bound})`);
  check(
    tilt.afterTeardown === '',
    `interactions: pointermove writes nothing after teardown (${tilt.afterTeardown || 'unset'})`,
  );

  await browser.close();
  return failures;
}

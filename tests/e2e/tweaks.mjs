// Keyboard paths through the tweaks panel that need real focus and layout:
// tabbing past a closed color row must neither stop inside its hidden picker
// nor write the color. Run alongside the core suite by run.mjs.
import { chromium } from 'playwright';

const READY_TIMEOUT_MS = 60_000;
const TABS = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runTweaksSuite(baseUrl, launchOptions = {}) {
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

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  console.log('\ntweaks suite');

  try {
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
    await page.waitForFunction(() => !!window.__fixture, null, { timeout: READY_TIMEOUT_MS });

    await page.evaluate(() => window.__fixture.tweaksMount());
    try {
      await page.focus('[data-kit-tweaks] .tw-group-header');
      const stops = [];
      for (let i = 0; i < TABS; i++) {
        await page.keyboard.press('Tab');
        stops.push(
          await page.evaluate(() => {
            const a = document.activeElement;
            return {
              inPanel: !!a?.closest('.tw-color-panel'),
              label: a ? `${a.tagName}.${a.className}` : 'none',
            };
          }),
        );
      }
      const hidden = stops.filter((s) => s.inPanel).map((s) => s.label);
      check(
        hidden.length === 0,
        `color: ${TABS} Tabs from the group header skip the closed picker (${hidden.length ? `stopped on ${hidden.join(', ')}` : 'no stops inside'})`,
      );

      const after = await page.evaluate(() => window.__fixture.tweaksRead());
      check(after.color === '#6e9fff', `color: tabbing through leaves the color at #6e9fff (got ${after.color})`);
      check(
        after.diff !== null && Object.keys(after.diff).length === 0,
        `color: tabbing through leaves the store diff empty (got ${JSON.stringify(after.diff)})`,
      );
    } finally {
      await page.evaluate(() => window.__fixture.tweaksUnmount());
    }

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
